#!/usr/bin/env bash
# claim_task.sh <task-id> — take exclusive ownership of a task, or fail cleanly.
#
# The whole coordination problem reduces to one question: when two sessions
# want the same task, who gets it? Every previous answer here needed a shared
# writable branch, a side worktree, and a sync step to keep two copies of the
# ledger honest — and none of it worked on a sandbox that only lets a session
# push its own working branch.
#
# GitHub already provides the primitive:
#
#     POST /repos/{owner}/{repo}/git/refs   →  422 "Reference already exists"
#
# Creating a ref is a compare-and-swap. Exactly one concurrent creator gets
# 201; everyone else gets 422. It is decided server-side, so there is no
# settle interval, no tie-break, and no window where two sessions both believe
# they won. It needs no worktree, no branch switch, and no push — which is why
# it works on every surface.
#
# Two different safety properties, deliberately handled separately:
#
#   * Not taking work a human already holds is a PRECONDITION, not a race —
#     they assigned themselves long before. The caller checks the issue.
#   * Two sessions racing for the same free task is the actual race, and only
#     the claim ref can settle it: every session authenticates as the SAME
#     GitHub identity, so an assignee cannot tell two agents apart.
#
# Stdout:
#   won <ref>            — the claim is yours
#   lost                 — someone else holds it
#   manual <METHOD> <PATH> <BODY>
#                        — no scriptable GitHub channel here; make this exact
#                          call with your built-in GitHub tools and treat
#                          201 as `won`, 422 as `lost`
# Exit: 0 won, 1 lost, 5 manual, 2 error.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHANNEL="${SCRIPT_DIR}/github_channel.sh"

TASK_ID="${1:?claim_task.sh requires <task-id>}"
ATTEMPT="${2:-1}"

REMOTE="${ARSENAL_QUEUE_REMOTE:-origin}"
PREFIX="${ARSENAL_CLAIM_PREFIX:-arsenal/claims}"

_fail() { echo "error: $1" >&2; exit 2; }

slug="$(bash "${CHANNEL}" --slug)" || _fail "cannot determine owner/repo from remote '${REMOTE}'"

# The claim ref points at the default branch head. Any commit would do — the
# ref's existence is the lock, its target is only so the ref is well formed —
# but the default branch head keeps it meaningful if someone looks.
default_branch="${ARSENAL_DEFAULT_BRANCH:-}"
if [[ -z "${default_branch}" ]]; then
    default_branch="$(git symbolic-ref --short "refs/remotes/${REMOTE}/HEAD" 2>/dev/null | sed "s#^${REMOTE}/##")"
fi
default_branch="${default_branch:-main}"

git fetch "${REMOTE}" "${default_branch}" >/dev/null 2>&1 || true
sha="$(git rev-parse "refs/remotes/${REMOTE}/${default_branch}" 2>/dev/null || git rev-parse HEAD 2>/dev/null)"
[[ -z "${sha}" ]] && _fail "cannot resolve a commit to anchor the claim ref"

# Attempt number in the ref name, because a claim ref cannot be deleted from a
# sandboxed session. A crashed session therefore blocks nothing: the next
# attempt takes the next ref rather than waiting for a lease to expire.
#
# But the escape hatch and the lock shared a key. A suffixed ref is a ref nobody
# else is contending for, so the 422-on-existing-ref collision — the whole
# mechanism — was evaluated against the wrong name, and `claim_task.sh <id> 2`
# reported `won` while another session legitimately held the task. A documented
# prohibition is not a lock. So a retry now has to say that it knows the base
# claim exists and is stale, and that acknowledgement is a deliberate act:
ref="refs/heads/${PREFIX}/${TASK_ID}"
if [[ "${ATTEMPT}" != "1" ]]; then
    if [[ "${ARSENAL_CLAIM_STALE_OK:-}" != "1" ]]; then
        echo "error: attempt ${ATTEMPT} would claim ${PREFIX}/${TASK_ID}.a${ATTEMPT}, a ref no" >&2
        echo "       other session contends for, so the atomic collision cannot arbitrate it." >&2
        echo "       Establish that the base claim is stale — its session is gone and the task" >&2
        echo "       is not in progress — then re-run with ARSENAL_CLAIM_STALE_OK=1." >&2
        exit 2
    fi
    ref="refs/heads/${PREFIX}/${TASK_ID}.a${ATTEMPT}"
    echo "warning: bypassing the base claim ${PREFIX}/${TASK_ID} (declared stale)" >&2
fi

body="$(printf '{"ref":"%s","sha":"%s"}' "${ref}" "${sha}")"
path="/repos/${slug}/git/refs"

out="$(bash "${CHANNEL}" --api POST "${path}" "${body}" 2>/dev/null)"
status=$?

case ${status} in
    0) echo "won ${ref}"; exit 0 ;;
    3) echo "lost"; exit 1 ;;
    5) echo "manual POST ${path} ${body}"; exit 5 ;;
    *)
        echo "error: claim call failed for ${TASK_ID}" >&2
        [[ -n "${out}" ]] && echo "${out}" >&2
        exit 2
        ;;
esac
