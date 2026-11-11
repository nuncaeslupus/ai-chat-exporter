#!/usr/bin/env bash
# park_task.sh <task_id> [<reason>]
# Push a stopped task's uncommitted work to `arsenal/wip/<task_id>` on the
# remote, so it outlives the tree it was written in.
#
# Why this exists: every "stop before the PR" exit — a round cap, a gate
# failure, a quota stop, a session ending — leaves the work as uncommitted files,
# because open_task_pr.sh wants it uncommitted and is the only step that pushes.
# rescue_snapshot.sh can capture that tree, but under a LOCAL ref, and on a cloud
# container a local ref dies with the container. Two finished tasks were redone
# from scratch that way (#482).
#
# The snapshot is rescue_snapshot.sh's: a commit on top of HEAD taken through a
# temporary index, so the caller's index, HEAD and files are left as they were.
# The work stays uncommitted here; the next attempt, on any surface, restores
# it uncommitted with the command this prints.
#
# Stdout: `wip: arsenal/wip/<task_id>` and a `resume:` line, or
#         `wip: none (clean tree)` when there was nothing to park.
# Exit:   0 pushed, or nothing to park;
#         1 the tree had work and it could not be snapshotted;
#         2 snapshotted but not pushed — the local ref is on stderr, and on a
#           cloud surface it does not survive the container.
# Env:    ARSENAL_REMOTE — remote to push to (default `origin`).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_ID="${1:-}"
REASON="${2:-parked before the PR}"
REMOTE="${ARSENAL_REMOTE:-origin}"

[[ -n "${TASK_ID}" ]] || { echo "usage: park_task.sh <task_id> [<reason>]" >&2; exit 1; }
# A task id names a branch; refuse anything git would read as more than one.
git check-ref-format "refs/heads/arsenal/wip/${TASK_ID}" 2>/dev/null \
    || { echo "park_task: '${TASK_ID}' is not usable in a branch name" >&2; exit 1; }

ref="$(bash "${SCRIPT_DIR}/rescue_snapshot.sh" "park ${TASK_ID}: ${REASON}")" || {
    echo "park_task: the tree has work and could NOT be snapshotted — nothing was pushed. Check disk space and repository permissions, then re-run." >&2
    exit 1
}
if [[ -z "${ref}" ]]; then
    echo "wip: none (clean tree)"
    exit 0
fi

branch="arsenal/wip/${TASK_ID}"
# Forced: the branch is one task's latest parked state, not a history. A second
# park of the same task replaces the first, which is what the next attempt wants.
for delay in 0 2 4 8; do
    sleep "${delay}"
    if git push -q --force "${REMOTE}" "${ref}:refs/heads/${branch}" >/dev/null 2>&1; then
        echo "wip: ${branch}"
        echo "resume: git fetch ${REMOTE} ${branch} && git restore --source=FETCH_HEAD --worktree -- ."
        exit 0
    fi
done
echo "park_task: snapshotted to ${ref} but could not push ${branch} to ${REMOTE} — on a cloud surface that ref dies with the container. Push it by hand: git push --force ${REMOTE} ${ref}:refs/heads/${branch}" >&2
exit 2
