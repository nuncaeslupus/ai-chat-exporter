#!/usr/bin/env bash
# queue_sync.sh
# Idempotently ports task rows (and payload files) present on the default branch
# but absent from the coordination branch.  Safe to run multiple times; never
# touches existing claim/release state.
#
# The footgun this closes: tasks added via /queue-add during a feature-branch
# session land on the host default branch (main), not on arsenal-queue.  Once
# the PR merges, queue_branch.sh's merge step pulls the code changes but may
# leave the tasks.jsonl rows absent or conflicted on the coordination branch.
# Running this script right after queue_branch.sh closes that gap.
#
# Usage (called by the orchestrator at session start):
#   export ARSENAL_QUEUE_DIR="$(claude-arsenal/bin/queue_branch.sh)"
#   ARSENAL_QUEUE_DIR="${ARSENAL_QUEUE_DIR}" claude-arsenal/bin/queue_sync.sh
#
# Branch name:  ARSENAL_QUEUE_BRANCH   (default: arsenal-queue)
# Remote:       ARSENAL_QUEUE_REMOTE   (default: origin)
# Default br:   ARSENAL_DEFAULT_BRANCH (default: main)
# Worktree dir: ARSENAL_QUEUE_DIR      (set by queue_branch.sh)
#
# Exit: 0 on success or nothing-to-sync, 1 on hard failure.

set -uo pipefail

QUEUE_BRANCH="${ARSENAL_QUEUE_BRANCH:-arsenal-queue}"
REMOTE="${ARSENAL_QUEUE_REMOTE:-origin}"
DEFAULT_BRANCH="${ARSENAL_DEFAULT_BRANCH:-main}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
REPO_NAME="$(basename "${REPO_ROOT}")"
# Mirror queue_branch.sh's precedence exactly: an explicit ARSENAL_QUEUE_DIR
# wins, then a caller-set ARSENAL_QUEUE_WORKTREE override, then the
# repo-name-scoped default. A bare, unscoped fallback here would let two
# different repos that happen to be sibling directories (e.g. ~/dev/repo-a,
# ~/dev/repo-b) both resolve to the identical path when neither is set —
# silently merging their queues. Skipping the WORKTREE override would instead
# desync queue_sync.sh from queue_branch.sh whenever a caller sets it.
QUEUE_WORKTREE="${ARSENAL_QUEUE_DIR:-${ARSENAL_QUEUE_WORKTREE:-${REPO_ROOT}/../${REPO_NAME}-arsenal-queue-wt}}"
QUEUE_REL="claude-arsenal/queue/tasks.jsonl"

# Nothing to do if the coordination branch has no queue file yet.
[[ ! -f "${QUEUE_WORKTREE}/${QUEUE_REL}" ]] && exit 0

# Fetch the latest default branch (queue_branch.sh may have done this already;
# re-fetching is cheap and ensures we see tasks merged since session start).
git fetch "${REMOTE}" "${DEFAULT_BRANCH}" >/dev/null 2>&1 || true

export _QS_WT="${QUEUE_WORKTREE}"
export _QS_REMOTE="${REMOTE}"
export _QS_DEFAULT="${DEFAULT_BRANCH}"
export _QS_BRANCH="${QUEUE_BRANCH}"
export _QS_REL="${QUEUE_REL}"

python3 << 'PYEOF'
import json, os, sys, pathlib, subprocess

wt      = os.environ["_QS_WT"]
remote  = os.environ["_QS_REMOTE"]
default = os.environ["_QS_DEFAULT"]
branch  = os.environ["_QS_BRANCH"]
rel     = os.environ["_QS_REL"]

queue_file = pathlib.Path(wt) / rel

# Get tasks.jsonl from origin/default.  If absent, nothing to port.
main_result = subprocess.run(
    ["git", "show", f"{remote}/{default}:{rel}"],
    capture_output=True, text=True,
)
if main_result.returncode != 0:
    sys.exit(0)

# IDs already on the coordination branch.
wt_ids: set[str] = set()
for line in queue_file.read_text().splitlines():
    line = line.strip()
    if line:
        wt_ids.add(json.loads(line)["id"])

# Rows on the default branch that are missing from the coordination branch.
missing: list[dict] = []
for line in main_result.stdout.splitlines():
    line = line.strip()
    if not line:
        continue
    row = json.loads(line)
    if row["id"] not in wt_ids:
        missing.append(row)

if not missing:
    sys.exit(0)

ids = ", ".join(r["id"] for r in missing)
print(f"queue_sync.sh: porting {len(missing)} task(s) from {remote}/{default}: {ids}", file=sys.stderr)

# Append missing rows.
with open(queue_file, "a") as f:
    for r in missing:
        f.write(json.dumps(r, separators=(",", ":")) + "\n")

# Copy payload files from origin/default.
staged = [rel]
for r in missing:
    payload = r.get("payload")
    if not payload:
        continue
    pl_rel = f"claude-arsenal/queue/{payload}"
    pl_dst = pathlib.Path(wt) / pl_rel
    if pl_dst.exists():
        staged.append(pl_rel)
        continue
    pl_result = subprocess.run(
        ["git", "show", f"{remote}/{default}:{pl_rel}"],
        capture_output=True,
    )
    if pl_result.returncode == 0:
        pl_dst.parent.mkdir(parents=True, exist_ok=True)
        pl_dst.write_bytes(pl_result.stdout)
        staged.append(pl_rel)
    else:
        print(
            f"queue_sync.sh: WARNING — payload {pl_rel} not found on {remote}/{default}; skipping",
            file=sys.stderr,
        )

# Commit.
subprocess.run(["git", "-C", wt, "add"] + staged, check=True)
msg = f"sync: port {len(missing)} task(s) from {remote}/{default} ({ids})"
subprocess.run(["git", "-C", wt, "commit", "-m", msg], check=True)

# Push; on non-fast-forward reset to remote and re-evaluate rather than
# merging — tasks.jsonl is append-only and concurrent appends always
# conflict at EOF, so merge is guaranteed to fail.
push = subprocess.run(
    ["git", "-C", wt, "push", remote, f"HEAD:refs/heads/{branch}"],
    capture_output=True, text=True,
)
if push.returncode != 0:
    subprocess.run(["git", "-C", wt, "fetch", remote, branch], check=True)
    subprocess.run(["git", "-C", wt, "reset", "--hard", f"{remote}/{branch}"], check=True)

    # Re-read coordination branch state — another session may have added some rows.
    wt_ids_now: set[str] = set()
    for line in queue_file.read_text().splitlines():
        line = line.strip()
        if line:
            wt_ids_now.add(json.loads(line)["id"])
    still_missing = [r for r in missing if r["id"] not in wt_ids_now]
    if not still_missing:
        sys.exit(0)

    with open(queue_file, "a") as f:
        for r in still_missing:
            f.write(json.dumps(r, separators=(",", ":")) + "\n")

    staged2 = [rel]
    for r in still_missing:
        payload = r.get("payload")
        if not payload:
            continue
        pl_rel = f"claude-arsenal/queue/{payload}"
        pl_dst = pathlib.Path(wt) / pl_rel
        if pl_dst.exists():
            staged2.append(pl_rel)
            continue
        pl_result = subprocess.run(
            ["git", "show", f"{remote}/{default}:{pl_rel}"],
            capture_output=True,
        )
        if pl_result.returncode == 0:
            pl_dst.parent.mkdir(parents=True, exist_ok=True)
            pl_dst.write_bytes(pl_result.stdout)
            staged2.append(pl_rel)

    ids2 = ", ".join(r["id"] for r in still_missing)
    subprocess.run(["git", "-C", wt, "add"] + staged2, check=True)
    subprocess.run(["git", "-C", wt, "commit", "-m",
                    f"sync: port {len(still_missing)} task(s) from {remote}/{default} ({ids2})"],
                   check=True)
    push2 = subprocess.run(
        ["git", "-C", wt, "push", remote, f"HEAD:refs/heads/{branch}"],
        capture_output=True, text=True,
    )
    if push2.returncode != 0:
        print(
            f"queue_sync.sh: WARNING — push failed: {push2.stderr.strip()}",
            file=sys.stderr,
        )
        sys.exit(1)
PYEOF
