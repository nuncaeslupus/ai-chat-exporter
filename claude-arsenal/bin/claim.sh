#!/usr/bin/env bash
# claim.sh <task_id> [<session_id>]
# Attempts to claim an open task with optimistic git-push concurrency.
#
# The queue lives on a dedicated coordination branch (default: arsenal-queue,
# override with ARSENAL_QUEUE_BRANCH). All orchestrator sessions MUST run on
# that branch so its remote ref is the shared lock: two sessions race to
# fast-forward the same ref and Git lets exactly one win. Per-task code work
# happens in worktrees on feature branches, never on this branch.
#
# Stdout:
#   "won" + task JSON   — claim landed on the remote.
#   "lost"              — another session won the race (remote ref moved on).
#   "error: <reason>"   — misconfiguration (wrong branch, protected branch,
#                         no upstream/remote). NOT a race; the loop must stop.
# Exit:
#   0 — won or lost.
#   2 — error (loud failure, kept distinct from a lost race).

QUEUE_BRANCH="${ARSENAL_QUEUE_BRANCH:-arsenal-queue}"
REMOTE="${ARSENAL_QUEUE_REMOTE:-origin}"
QUEUE_FILE="claude-arsenal/queue/tasks.jsonl"
TASK_ID="${1:?claim.sh requires <task_id>}"
SESSION_ID="${2:-${CLAUDE_SESSION_ID:-"session-$$"}}"

# _fail writes to stdout (not stderr) — callers check stdout for the
# "error: " prefix as part of the won/lost/error protocol.
_fail() { echo "error: $1"; exit 2; }

# Operate from the coordination worktree when ARSENAL_QUEUE_DIR is set so the
# main working tree never needs to change branch.
if [[ -n "${ARSENAL_QUEUE_DIR:-}" ]]; then
    cd "${ARSENAL_QUEUE_DIR}" \
        || _fail "could not cd into queue worktree '${ARSENAL_QUEUE_DIR}'"
fi

# Guard: must be on the coordination branch. Off it, HEAD diverges from the
# push target and every claim silently looks "lost" — fail loud instead.
current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ "${current_branch}" != "${QUEUE_BRANCH}" ]]; then
    _fail "not on coordination branch '${QUEUE_BRANCH}' (HEAD=${current_branch:-unknown}); run queue_branch.sh first"
fi

_claim_json() {
    python3 - "${TASK_ID}" "${SESSION_ID}" "${QUEUE_FILE}" <<'PY'
import sys, json, os, pathlib, tempfile
from datetime import datetime, timezone

task_id, session_id, queue_path = sys.argv[1:]
path = pathlib.Path(queue_path)
if not path.exists():
    print("lost")
    sys.exit(0)

rows = []
for line in path.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line:
        try:
            data = json.loads(line)
            if isinstance(data, dict):
                rows.append(data)
        except json.JSONDecodeError:
            pass

target = next(
    (r for r in rows if r.get("id") == task_id and r.get("status") == "open"),
    None,
)
if target is None:
    print("lost")
    sys.exit(0)

target["status"] = "in_progress"
target["assignee"] = session_id
# Lease timestamp (ISO-8601 UTC, second precision): records WHEN the claim
# landed so a crashed session's stranded in_progress task can be detected by age
# (queue_doctor.py --lease-ttl) and reclaimed, rather than blocking forever.
target["claimed_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

# Atomic write (QIC-13): temp file in the same dir then os.replace, so a crash
# mid-write can never corrupt the append-only ledger.
text = "\n".join(json.dumps(r, separators=(",", ":")) for r in rows) + "\n"
fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
try:
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)
except BaseException:
    try:
        os.unlink(tmp)
    except OSError:
        pass
    raise
print("ok")
print(json.dumps(target))
PY
}

result=$(_claim_json 2>/dev/null)
first="${result%%$'\n'*}"

if [[ "${first}" != "ok" ]]; then
    echo "lost"
    exit 0
fi

task_json="${result#ok$'\n'}"

# Stage, commit, and push to the coordination branch.
git add "${QUEUE_FILE}" 2>/dev/null || { echo "lost"; exit 0; }

if ! git commit -m "claim: ${TASK_ID} → in_progress [${SESSION_ID}]" >/dev/null 2>&1; then
    # Nothing staged or already committed — race lost locally.
    git checkout -- "${QUEUE_FILE}" 2>/dev/null || true
    echo "lost"
    exit 0
fi

# Guard: only this single claim commit may reach the coordination ledger.
# `git push HEAD:refs/heads/<branch>` publishes EVERY local commit ahead of the
# remote, so on a shared tree (no worktree isolation) task code committed on
# this branch would leak onto the queue. Fetch the published tip and confirm
# exactly one commit (our claim) sits on top of it before pushing. A genuine
# race (remote advanced) still shows our one local commit on top of the old tip
# and is handled by the push rejection below; more than one means non-queue
# commits are present, so fail loud instead of leaking them onto the ledger.
git fetch "${REMOTE}" "${QUEUE_BRANCH}" >/dev/null 2>&1 || true
queue_tip="$(git rev-parse --verify --quiet "refs/remotes/${REMOTE}/${QUEUE_BRANCH}" 2>/dev/null \
    || git rev-parse --verify --quiet FETCH_HEAD 2>/dev/null || true)"
if [[ -n "${queue_tip}" ]]; then
    # The parent of our claim commit must already be on the published tip — then
    # only the claim commit is new. If HEAD~1 is NOT an ancestor of the tip, this
    # branch carries non-queue commits; refuse rather than leak them.
    if ! git merge-base --is-ancestor "HEAD~1" "${queue_tip}" 2>/dev/null; then
        git reset --soft "HEAD~1" >/dev/null 2>&1 || true
        git checkout -- "${QUEUE_FILE}" >/dev/null 2>&1 || true
        _fail "refusing to push local commits to '${QUEUE_BRANCH}' — only single claim/release commits may land on the coordination ledger; non-queue commits are present on this branch"
    fi
fi

# Push the local claim commit to the shared coordination ref. Exactly one
# racer fast-forwards; the rest are rejected non-fast-forward.
# LANG=C keeps error messages in English so the grep below is locale-safe.
if push_err="$(LANG=C git push "${REMOTE}" "HEAD:refs/heads/${QUEUE_BRANCH}" 2>&1)"; then
    # Guard against the web double-claim vector: a restricted-push surface may
    # transparently redirect `git push HEAD:refs/heads/<queue-branch>` to the
    # session's own branch and still exit 0. The shared ref never moves, so two
    # sessions can both see push success and both report "won" on the same task.
    # The remote ref is the lock — so confirm it actually advanced TO OUR commit
    # before claiming the win. Re-fetch the published tip and compare.
    git fetch "${REMOTE}" "${QUEUE_BRANCH}" >/dev/null 2>&1 || true
    landed_tip="$(git rev-parse --verify --quiet "refs/remotes/${REMOTE}/${QUEUE_BRANCH}" 2>/dev/null \
        || git rev-parse --verify --quiet FETCH_HEAD 2>/dev/null || true)"
    local_head="$(git rev-parse --verify --quiet HEAD 2>/dev/null || true)"
    # Our claim commit must be REACHABLE from the published tip (ancestor-or-equal),
    # not strictly equal: another session may legitimately fast-forward a different
    # claim on top of ours between our push and this re-fetch. A redirect leaves our
    # commit off the shared ref entirely, so --is-ancestor fails and we error out.
    if [[ -n "${landed_tip}" && -n "${local_head}" ]] \
        && git merge-base --is-ancestor "${local_head}" "${landed_tip}" 2>/dev/null; then
        echo "won"
        echo "${task_json}"
        exit 0
    fi
    # Push reported success but the coordination ref did not advance to our claim
    # commit — the push was redirected off the shared ref. Treat as a hard error
    # (not a race): the shared-ref lock is not in effect, so continuing would let
    # two sessions both "win". Unwind the local claim and fail loud.
    git reset HEAD~1 >/dev/null 2>&1 || true
    git checkout -- "${QUEUE_FILE}" >/dev/null 2>&1 || true
    _fail "push to '${QUEUE_BRANCH}' reported success but the coordination ref did not advance to our claim commit — the push was redirected off the shared ref (restricted-push surface); the shared-ref lock is not in effect"
fi

# Push failed. Unwind the local claim either way: mixed reset (not --hard)
# preserves any uncommitted user files.
git reset HEAD~1 >/dev/null 2>&1 || true
git checkout -- "${QUEUE_FILE}" >/dev/null 2>&1 || true

if printf '%s' "${push_err}" | grep -qiE 'non-fast-forward|fetch first|cannot lock ref|but expected|failed to update ref|incorrect old value'; then
    # Remote ref advanced — a genuine race (a plain non-fast-forward, or an
    # atomic ref-update CAS loss: "cannot lock ref … is at X but expected Y",
    # or "remote rejected … (incorrect old value provided)" when two pushes
    # hit the same ref concurrently).
    # The local claim was already unwound above, so there is nothing to rebase:
    # just resync to the new remote tip (robust against unrelated unstaged
    # files) so the next loop iteration re-evaluates against fresh queue state.
    git fetch "${REMOTE}" "${QUEUE_BRANCH}" >/dev/null 2>&1 || true
    git reset "${REMOTE}/${QUEUE_BRANCH}" >/dev/null 2>&1 || true
    git checkout -- "${QUEUE_FILE}" >/dev/null 2>&1 || true
    echo "lost"
    exit 0
fi

# Anything else (protected branch, permission denied, no remote/upstream) is a
# misconfiguration, not a race. Fail loud so the loop stops instead of spinning
# on a deadlock that looks like an endless lost race.
_fail "push to '${QUEUE_BRANCH}' failed (not a race): ${push_err}"
