#!/usr/bin/env bash
# release.sh <task_id> <status> [--pr <url>] [--reset-attempts]
# Updates a task's status in queue.jsonl, commits (the queue row AND the task
# payload, so any ## Failure notes / PR-URL edits land too), and pushes to the
# dedicated coordination branch (default: arsenal-queue, override
# ARSENAL_QUEUE_BRANCH). Must run on that branch — see claim.sh for why the
# shared ref is the lock.
# <status>: done | merged | open | blocked | in_progress | escalated
#   done       = PR opened + acceptance gate passed (the worker's terminal
#                state). `done` is enforced here, not by convention: it requires
#                an opened (non-closed) PR, the payload's mechanical gate to pass
#                (gate_run.sh), and — for a "laptop"-tagged task — a non-cloud
#                session. See the CA-11/CA-12/CA-13 guards below.
#   merged     = that PR later landed on the default branch; set by
#                reconcile_merged.sh after a `gh` merge-state check.
#   escalated  = task auto-set when attempts >= max_attempts (see update_task_row.py).
# --pr <url>: optional; records the per-task PR URL/number on the queue row.
# --reset-attempts: clear the attempts counter and return the task to open,
#                   bypassing the auto-escalation cap check. Only meaningful
#                   with status open; silently ignored for other statuses.
# Exit: 0 on success, 1 after 3 failed push attempts, 2 on misconfiguration
#       (wrong branch / protected branch / no upstream).

QUEUE_BRANCH="${ARSENAL_QUEUE_BRANCH:-arsenal-queue}"
REMOTE="${ARSENAL_QUEUE_REMOTE:-origin}"
QUEUE_FILE="claude-arsenal/queue/tasks.jsonl"
TASK_ID="${1:?release.sh requires <task_id>}"
NEW_STATUS="${2:?release.sh requires <status>: done|open|blocked|in_progress|escalated}"
shift 2 || true

# Resolve script dir to an absolute path now, before any cd, so UPDATE_PY
# stays valid even after we cd into the coordination worktree below.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATE_PY="${SCRIPT_DIR}/../scripts/update_task_row.py"
GATE_RUN="${SCRIPT_DIR}/gate_run.sh"

PR_URL=""
RESET_ATTEMPTS=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --pr) PR_URL="${2:-}"; shift 2 ;;
        --reset-attempts) RESET_ATTEMPTS="1"; shift ;;
        *) shift ;;
    esac
done

case "${NEW_STATUS}" in
    done|merged|open|blocked|in_progress|escalated) ;;
    *) echo "release.sh: invalid status '${NEW_STATUS}'" >&2; exit 1 ;;
esac

# Guard (CA-11): `done` means "PR opened + gate passed". Refuse to record it
# from a bare branch ref (never PR'd) or with no PR at all — that is the
# false-`done` vector: a pushed branch is not an opened PR. Open the PR first
# and pass its URL, or release the task as open/in_progress. `merged` is set by
# reconcile_merged.sh from a real merged PR, so it is exempt from this guard.
if [[ "${NEW_STATUS}" == "done" ]]; then
    if [[ -z "${PR_URL}" || "${PR_URL}" == branch:* ]]; then
        echo "release.sh: refusing to mark ${TASK_ID} done without an opened PR (pr='${PR_URL:-none}'); open the PR and record done with its URL, or release as open/in_progress" >&2
        exit 2
    fi
fi

# Guard (CA-13): refuse to record `done` for a PR that was closed without
# merging — a closed PR is an abandoned PR; the task must be re-opened or
# moved to a fresh PR. `merged` is exempt (reconcile_merged.sh sets it after
# a real merge). Skips silently when gh is not on PATH.
if [[ "${NEW_STATUS}" == "done" && "${PR_URL}" == http* ]] && command -v gh >/dev/null 2>&1; then
    _pr_state="$(gh pr view "${PR_URL}" --json state,mergedAt --jq '.state' 2>/dev/null || true)"
    if [[ "${_pr_state}" == "CLOSED" ]]; then
        echo "release.sh: refusing to mark ${TASK_ID} done — PR '${PR_URL}' is closed (never merged); open a new PR or release as open/in_progress" >&2
        exit 2
    fi
fi

# Guard (CA-11, venue): a [LAPTOP]-only gate (model training, CPCV Sharpe, soak,
# paper-trade) cannot be satisfied by a cloud session, so a cloud worker must not
# record `done` for a task tagged "laptop" — the honor-system false-`done` vector
# #68 calls out. Detect the cloud surface via CLAUDE_CODE_REMOTE (the same signal
# detect_surface.sh uses). Checked BEFORE the gate enforcement below so a cloud
# session never even runs a laptop-only gate's code. Read the canonical queue
# (the coordination worktree when ARSENAL_QUEUE_DIR is set, else the local one).
_TAGS_QUEUE="${QUEUE_FILE}"
if [[ -n "${ARSENAL_QUEUE_DIR:-}" && -f "${ARSENAL_QUEUE_DIR}/${QUEUE_FILE}" ]]; then
    _TAGS_QUEUE="${ARSENAL_QUEUE_DIR}/${QUEUE_FILE}"
fi
_task_has_tag() {
    python3 - "${_TAGS_QUEUE}" "${1}" "${2}" <<'PYEOF'
import json, sys
queue, task_id, tag = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(queue, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict) and row.get("id") == task_id:
                tags = row.get("tags")
                sys.exit(0 if isinstance(tags, list) and tag in tags else 1)
except OSError:
    pass
sys.exit(1)  # task not found / no such tag
PYEOF
}
if [[ "${NEW_STATUS}" == "done" && "${CLAUDE_CODE_REMOTE:-}" == "true" ]] \
    && _task_has_tag "${TASK_ID}" "laptop"; then
    echo "release.sh: refusing to mark ${TASK_ID} done — task is tagged [laptop] and this is a cloud session (CLAUDE_CODE_REMOTE=true) that cannot satisfy a laptop-only gate; run the gate on the laptop and record done there" >&2
    exit 2
fi

# Guard (CA-12): enforce the task's mechanical acceptance gate at the release
# choke point, not just by worker-loop convention. A session can call
# `release.sh <id> done` directly and bypass gate_run.sh in the worker loop;
# re-running the gate here is the backstop that makes a declared numeric/bash
# gate a hard precondition for `done`. Run it now, BEFORE the cd into the
# coordination worktree, so the worker's committed evidence files (referenced
# repo-root-relative by the gate block) are still reachable in this tree.
# Skipped when there is no payload (hence no gate); gate_run.sh itself exits 0
# for a payload with no gate. `merged` is exempt — the gate already ran at `done`
# and reconcile_merged.sh sets `merged` from a real merge.
if [[ "${NEW_STATUS}" == "done" && -f "claude-arsenal/queue/${TASK_ID}.md" && -f "${GATE_RUN}" ]]; then
    if ! bash "${GATE_RUN}" "${TASK_ID}"; then
        echo "release.sh: refusing to mark ${TASK_ID} done — acceptance gate failed (gate_run.sh); fix the gate / commit the evidence, or release as open/in_progress" >&2
        exit 2
    fi
fi

# Operate from the coordination worktree when ARSENAL_QUEUE_DIR is set so the
# main working tree never needs to change branch.
# The orchestrator writes failure notes to the payload file in the main tree;
# copy it into the worktree before cd-ing so the edits get committed.
if [[ -n "${ARSENAL_QUEUE_DIR:-}" ]]; then
    if [[ -f "claude-arsenal/queue/${TASK_ID}.md" ]]; then
        mkdir -p "${ARSENAL_QUEUE_DIR}/claude-arsenal/queue"
        cp "claude-arsenal/queue/${TASK_ID}.md" \
            "${ARSENAL_QUEUE_DIR}/claude-arsenal/queue/${TASK_ID}.md"
    fi
    cd "${ARSENAL_QUEUE_DIR}" \
        || { echo "release.sh: could not cd into queue worktree '${ARSENAL_QUEUE_DIR}'" >&2; exit 2; }
fi

# Guard: a release pushed from the wrong branch diverges from the coordination
# ref and never lands. Fail loud rather than retry into a dead end.
current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ "${current_branch}" != "${QUEUE_BRANCH}" ]]; then
    echo "release.sh: not on coordination branch '${QUEUE_BRANCH}' (HEAD=${current_branch:-unknown}); run queue_branch.sh first" >&2
    exit 2
fi

# Guard (CA-15): scan the payload for secrets before modifying any local file.
# Scanning first avoids the split-brain state where tasks.jsonl is updated by
# update_task_row.py but the release is then refused — leaving the local ledger
# out of sync with the remote. Matches the same patterns as queue_doctor.py.
_scan_payload_secrets() {
    python3 - "${1}" <<'PYEOF'
import re, sys

_PATTERNS = [
    ("AWS access key id", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("private key block",
     re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b")),
    ("Slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b")),
    ("credential assignment", re.compile(
        r"(?i)\b(?:api[_-]?key|secret|token|password|passwd|access[_-]?key"
        r"|client[_-]?secret|private[_-]?key|bearer)\b\s*[:=]\s*"
        r"['\"]?([A-Za-z0-9/_+.\-]{16,})")),
]

path = sys.argv[1]
found = 0
with open(path, encoding="utf-8", errors="replace") as fh:
    for lineno, line in enumerate(fh, 1):
        for label, pat in _PATTERNS:
            if pat.search(line):
                print(
                    f"release.sh: secret detected in payload '{path}': "
                    f"{label} at line {lineno} (value redacted)",
                    file=sys.stderr,
                )
                found = 1
sys.exit(found)
PYEOF
}
if [[ -f "claude-arsenal/queue/${TASK_ID}.md" ]]; then
    _scan_payload_secrets "claude-arsenal/queue/${TASK_ID}.md"
    _scan_status=$?
    if [[ ${_scan_status} -eq 1 ]]; then
        echo "release.sh: refusing to stage payload with secrets — redact them from claude-arsenal/queue/${TASK_ID}.md before releasing" >&2
        exit 2
    elif [[ ${_scan_status} -ne 0 ]]; then
        echo "release.sh: secret scan failed (python3 may be missing or scan script errored)" >&2
        exit 2
    fi
fi

final_status="$(python3 "${UPDATE_PY}" "${TASK_ID}" "${NEW_STATUS}" "${QUEUE_FILE}" "${PR_URL}" "${RESET_ATTEMPTS}")" || exit 1

if [[ -z "${final_status}" ]]; then
    echo "release.sh: update_task_row.py returned empty status for ${TASK_ID}" >&2
    exit 1
fi

# Guard: never let a worker's residual staged changes ride onto the append-only
# coordination ledger. An in-place worker (one whose `isolation: worktree` was
# silently ignored) may have left other paths staged in the index; a plain
# `git commit` would sweep them onto the queue branch. A mixed reset clears the
# index without touching the working tree, so only the queue row + payload we
# stage below get committed. (worker_postcheck.sh should already have cleaned
# the tree; this guards the index regardless.)
git reset -q >/dev/null 2>&1 || true

# Stage the queue row AND the task payload: a release may carry ## Failure notes
# or a PR URL written into claude-arsenal/queue/<id>.md that must travel with the
# state commit rather than being lost on worktree cleanup. Stage them separately
# — a single `git add` with a non-existent payload pathspec fails atomically and
# would leave the queue change unstaged (a task may have no payload file).
git add "${QUEUE_FILE}" 2>/dev/null
if [[ -f "claude-arsenal/queue/${TASK_ID}.md" ]]; then
    git add "claude-arsenal/queue/${TASK_ID}.md" 2>/dev/null
fi

# Distinguish "already at target" from a real commit failure. The Python step
# above always sets the row to ${final_status} (updated=True), so an empty staged
# diff means the ledger already reflects the target — an idempotent no-op, not
# a recorded change. Swallowing the commit exit and pushing unchanged HEAD would
# otherwise report success when no ledger commit landed (and would push extra
# local commits — see the single-commit guard below).
if git diff --cached --quiet -- 2>/dev/null; then
    echo "release.sh: ${TASK_ID} already at ${final_status}; no new ledger commit to push" >&2
    exit 0
fi
if ! git commit -m "release: ${TASK_ID} → ${final_status}" >/dev/null 2>&1; then
    echo "release.sh: commit failed for ${TASK_ID} → ${final_status} (status NOT recorded)" >&2
    exit 1
fi

# Guard: only this single release commit may reach the coordination ledger.
# `git push HEAD:refs/heads/<branch>` publishes EVERY local commit ahead of the
# remote, so non-queue commits on a shared tree would leak onto the queue. Fetch
# the published tip and confirm exactly one commit (our release) sits on top of
# it. A rebase in the retry loop below replays only this one queue commit, so
# the invariant holds across retries; checking once here is sufficient.
git fetch "${REMOTE}" "${QUEUE_BRANCH}" >/dev/null 2>&1 || true
queue_tip="$(git rev-parse --verify --quiet "refs/remotes/${REMOTE}/${QUEUE_BRANCH}" 2>/dev/null \
    || git rev-parse --verify --quiet FETCH_HEAD 2>/dev/null || true)"
if [[ -n "${queue_tip}" ]]; then
    # The parent of our release commit must already be on the published tip — then
    # only the release commit is new. If HEAD~1 is NOT an ancestor of the tip, this
    # branch carries non-queue commits; refuse rather than leak them.
    if ! git merge-base --is-ancestor "HEAD~1" "${queue_tip}" 2>/dev/null; then
        echo "release.sh: refusing to push local commits to '${QUEUE_BRANCH}' — only single claim/release commits may land on the coordination ledger; non-queue commits are present on this branch" >&2
        exit 2
    fi
fi

# Push to the coordination ref with exponential backoff retry (up to 3
# attempts). A non-fast-forward means a concurrent claim/release landed first:
# rebase onto it and retry. Any other failure is a misconfiguration, not a
# race — fail loud immediately instead of burning all three attempts.
delay=1
for attempt in 1 2 3; do
    # LANG=C keeps error messages in English so the grep below is locale-safe.
    if push_err="$(LANG=C git push "${REMOTE}" "HEAD:refs/heads/${QUEUE_BRANCH}" 2>&1)"; then
        exit 0
    fi
    if ! printf '%s' "${push_err}" | grep -qiE 'non-fast-forward|fetch first|cannot lock ref|but expected|failed to update ref|incorrect old value'; then
        echo "release.sh: push to '${QUEUE_BRANCH}' failed (not a race): ${push_err}" >&2
        exit 2
    fi
    git pull --rebase --autostash "${REMOTE}" "${QUEUE_BRANCH}" 2>/dev/null \
        || git rebase --abort 2>/dev/null || true
    sleep "${delay}"
    delay=$((delay * 2))
done

echo "release.sh: push failed after 3 attempts for task ${TASK_ID}" >&2
exit 1
