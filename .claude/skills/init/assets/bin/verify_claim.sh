#!/usr/bin/env bash
# verify_claim.sh <task_id>
# Post-compaction helper: determines whether a prior context window already
# pushed work for a claimed task, so the new context can skip re-doing it.
#
# Stdout (one line):
#   done              — task is done/merged in queue; nothing to do.
#   pushed:<ref>      — task is in_progress but a branch/PR was already pushed
#                       (ref is either a URL or "branch:<name>").  The
#                       orchestrator should call release.sh done --pr <ref>.
#   in_progress       — task is in_progress with no pushed branch on origin.
#   open              — task is open (not yet claimed by anyone).
#   unknown           — task not found or queue file missing.
#
# The script is safe to call from the queue worktree (ARSENAL_QUEUE_DIR set) or
# from the main working tree.  It never writes to disk.
# Exit: 0 always.

REMOTE="${ARSENAL_QUEUE_REMOTE:-origin}"
QUEUE_FILE="claude-arsenal/queue/tasks.jsonl"
TASK_ID="${1:?verify_claim.sh requires <task_id>}"

# When the caller has set up a coordination worktree, the queue file lives
# inside that worktree.
_queue_path="${QUEUE_FILE}"
if [[ -n "${ARSENAL_QUEUE_DIR:-}" && -d "${ARSENAL_QUEUE_DIR}" ]]; then
    _queue_path="${ARSENAL_QUEUE_DIR}/${QUEUE_FILE}"
fi

# Single Python invocation: locate the task row and emit "<status> <pr_field>"
# (space-separated; pr_field may be empty).
read -r status pr_field <<< "$(python3 - "${TASK_ID}" "${_queue_path}" <<'PY'
import sys, json, pathlib
task_id, queue_path_str = sys.argv[1], sys.argv[2]
queue_path = pathlib.Path(queue_path_str)
if not queue_path.exists():
    print("unknown")
    sys.exit(0)
for line in queue_path.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        row = json.loads(line)
        if isinstance(row, dict) and row.get("id") == task_id:
            print(f"{row.get('status', 'unknown')} {row.get('pr', '')}")
            sys.exit(0)
    except json.JSONDecodeError:
        pass
print("unknown")
PY
)"

case "${status}" in
    done|merged)
        echo "done"
        exit 0
        ;;
    open)
        echo "open"
        exit 0
        ;;
    in_progress)
        # A pr field on an in_progress row means release.sh was called with --pr
        # but the status flip was interrupted.  Treat the ref as valid.
        if [[ -n "${pr_field}" ]]; then
            echo "pushed:${pr_field}"
            exit 0
        fi
        # Probe origin for any feature branch pushed for this task.
        # open_task_pr.sh names branches arsenal/<task_id>-<slug>, so a prefix
        # match on refs/heads/arsenal/<task_id>- is sufficient.
        branch="$(git ls-remote "${REMOTE}" "refs/heads/arsenal/${TASK_ID}-*" 2>/dev/null \
            | head -1 | awk '{print $2}' | sed 's|^refs/heads/||')"
        if [[ -n "${branch}" ]]; then
            echo "pushed:branch:${branch}"
        else
            echo "in_progress"
        fi
        exit 0
        ;;
    *)
        echo "unknown"
        exit 0
        ;;
esac
