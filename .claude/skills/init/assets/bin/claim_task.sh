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
#                          201 as `won`, 422 as `lost`; a 403 from the shell
#                          token means use the tools, not stop (stderr hint)
# Exit: 0 won, 1 lost, 5 manual, 2 error.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Git Bash: a native python.exe cannot open a `/c/...` path, and MSYS rewrites
# one it is handed into a wrong `C:\c\...`. Resolve to `C:/...` once, here, so
# every path built from SCRIPT_DIR below works for both shells. Identity elsewhere.
command -v cygpath >/dev/null 2>&1 && SCRIPT_DIR="$(cygpath -m "${SCRIPT_DIR}")"
CHANNEL="${SCRIPT_DIR}/github_channel.sh"

# Not `${1:?...}`: that exits 1, and this script documents 1 as `lost`. A caller
# invoked with an unset or empty id would read its own usage error as a lost
# race and skip the task as already claimed. Usage errors exit 2, like `_fail`
# below -- which is defined further down, hence the inline exit.
TASK_ID="${1:-}"
ATTEMPT="${2:-1}"

[[ -n "${TASK_ID}" ]] || { echo "error: claim_task.sh requires <task-id>" >&2; exit 2; }

REMOTE="${ARSENAL_QUEUE_REMOTE:-origin}"
# env, then arsenal/config.toml, then the shipped default. `claim-prefix` was a
# documented, validated setting that nothing read: this line was the hardcoded
# string it was supposed to control. queue_hooks.py, which prunes these refs,
# resolves it the same way — the two must agree or a claim outlives its task.
PREFIX="${ARSENAL_CLAIM_PREFIX:-}"
if [[ -z "${PREFIX}" ]]; then
    PREFIX="$(python3 "${SCRIPT_DIR}/../scripts/arsenal_config.py" --get claim-prefix 2>/dev/null || true)"
fi
PREFIX="${PREFIX:-arsenal/claims}"

_fail() { echo "error: $1" >&2; exit 2; }

# Serialized in-place mode: the worker runs in THIS checkout and open_task_pr.sh
# commits it with `git add -A`, so anything already changed here — a user's own
# settings edit, a large untracked dir — would ride into the task's PR (#546).
# A linked worktree has no such residue by construction, which is why the check
# keys on the in-place sentinel. ARSENAL_ALLOW_SHARED_ADD=1 is the same operator
# escape hatch open_task_pr.sh honours.
session_dir="${ARSENAL_SESSION_DIR:-${ARSENAL_HOME:-arsenal}/session}"
if [[ "${ARSENAL_ALLOW_SHARED_ADD:-}" != "1" ]] \
    && { [[ "${ARSENAL_WORKTREE_ISOLATION:-}" == "unavailable" ]] \
        || [[ "$(tr -d '[:space:]' 2>/dev/null < "${session_dir}/worktree_isolation")" == "unavailable" ]]; }; then
    dirty="$(git status --porcelain 2>/dev/null)"
    if [[ -n "${dirty}" ]]; then
        echo "error: in-place mode commits this whole checkout, and it already has changes" >&2
        echo "       no task made:" >&2
        sed 's/^/         /' <<<"${dirty}" | head -20 >&2
        echo "       They are not yours to move: ask the user to commit or stash them" >&2
        echo "       (git stash push -u), or to list a directory of theirs in" >&2
        echo "       .git/info/exclude, then claim again." >&2
        exit 2
    fi
fi

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

# json.dumps, not printf: a task id carrying a quote or a backslash produced
# malformed JSON here, while open_task_pr.sh already builds the equivalent
# payload this way and adversarial_review.sh charset-checks the same TASK_ID.
# Today's input is the agent's own task listing, so the exposure is narrow —
# this was the one place in the project that did not guard the value.
body="$(python3 -c 'import json,sys; print(json.dumps({"ref":sys.argv[1],"sha":sys.argv[2]}))' \
    "${ref}" "${sha}")" || _fail "cannot build the claim payload for ${ref}"
path="/repos/${slug}/git/refs"

out="$(bash "${CHANNEL}" --api POST "${path}" "${body}" 2>/dev/null)"
status=$?

case ${status} in
    0) echo "won ${ref}"; exit 0 ;;
    3) echo "lost"; exit 1 ;;
    5)
        echo "manual POST ${path} ${body}"
        # The channel already tried this with the shell's token and was refused
        # the write (or has no channel at all). `--detect` saying `rest` only
        # means reads work, so repeating the same POST with that token answers
        # 403, which an agent reads as an `error` and stops on (#502). A ref
        # creation is a branch creation, so the harness's own branch tool makes
        # the identical compare-and-swap.
        {
            echo "claim_task: make this call with your built-in GitHub tools, not this shell's token —"
            echo "  it creates branch '${ref#refs/heads/}' at ${sha} (e.g. a create_branch tool)."
            echo "  Created (201) = won; already exists (422) = lost. A 403 means the shell token"
            echo "  cannot create refs: use the tool instead. It is not an error to stop on."
        } >&2
        exit 5
        ;;
    *)
        echo "error: claim call failed for ${TASK_ID}" >&2
        [[ -n "${out}" ]] && echo "${out}" >&2
        exit 2
        ;;
esac
