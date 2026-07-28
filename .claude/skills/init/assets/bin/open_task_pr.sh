#!/usr/bin/env bash
# open_task_pr.sh <task_id> <title> [<type>]
# Commit a worker's task changes on a feature branch cut from the host DEFAULT
# branch (origin/main, NOT arsenal-queue), push it, and open a PR.
#
# Prints ONE line on stdout, consumed by the caller and recorded on the queue
# row via `release.sh done --pr <value>`:
#   <pr-url>            — a PR was created (a `gh` backend was available).
#   branch:<name>       — the branch was pushed but no PR backend exists here;
#                         the orchestrator/operator opens the PR (github skill /
#                         MCP). The branch ref is enough to do so.
#
# Conventional Commits message: `<type>: <title>` (type defaults to feat). The
# Co-Authored-By trailer is NEVER hardcoded — it is taken verbatim from
# ARSENAL_COAUTHOR ("Name <email>") when the caller exports the active model
# identity supplied by the harness. Absent it, no trailer is written.
#
# Env: ARSENAL_QUEUE_REMOTE (default origin); ARSENAL_COAUTHOR (optional);
#      ARSENAL_ALLOW_SHARED_ADD (operator escape hatch, see the guard below).
# Exit: 0 branch pushed (PR opened or branch emitted), 1 on push failure / usage.

set -uo pipefail

REMOTE="${ARSENAL_QUEUE_REMOTE:-origin}"
TASK_ID="${1:?open_task_pr.sh requires <task_id>}"
TITLE="${2:?open_task_pr.sh requires <title>}"
TYPE="${3:-feat}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd 2>/dev/null || echo .)"

# Snapshot the working tree to a permanent refs/arsenal-rescue/… ref. Used
# before the stale-base replay below, which force-moves HEAD across the tree.
# Echoes the ref (empty when the tree is clean or the helper is unavailable).
_rescue_snapshot() {
    [[ -f "${SCRIPT_DIR}/rescue_snapshot.sh" ]] || return 0
    bash "${SCRIPT_DIR}/rescue_snapshot.sh" "$1" 2>/dev/null || true
}

# True when this process runs in a LINKED git worktree (`git worktree add`),
# i.e. real per-worker isolation: a linked worktree has its own git dir that
# differs from the repository's common dir. Derived from git, never from an
# env var the caller sets about itself.
_in_linked_worktree() {
    local git_dir common_dir
    git_dir="$(git rev-parse --absolute-git-dir 2>/dev/null || true)"
    common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
    if [[ -z "${common_dir}" ]]; then
        # git < 2.31 has no --path-format; resolve the (possibly relative) path.
        common_dir="$(git rev-parse --git-common-dir 2>/dev/null || true)"
        [[ -n "${common_dir}" ]] && common_dir="$(cd "${common_dir}" 2>/dev/null && pwd -P || true)"
    fi
    [[ -n "${git_dir}" && -n "${common_dir}" && "${git_dir}" != "${common_dir}" ]]
}

# Slug: lowercase, non-alphanumerics → single hyphens, trimmed, capped.
slug="$(printf '%s' "${TITLE}" | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-40 | sed -E 's/-+$//')"
[[ -z "${slug}" ]] && slug="task"
BRANCH="arsenal/${TASK_ID}-${slug}"

# Resolve the host default branch from the remote's published HEAD symref, then
# fetch it so we branch off its real tip. NEVER fall back to the current HEAD:
# the worker runs on arsenal-queue, and branching off it would drag the entire
# queue-coordination history into the PR. Fail fast instead.
default_branch="$(git ls-remote --symref "${REMOTE}" HEAD 2>/dev/null \
    | sed -n 's|^ref:[[:space:]]*refs/heads/\([^[:space:]]*\).*|\1|p')"
[[ -z "${default_branch}" ]] && default_branch="main"
if git fetch "${REMOTE}" "${default_branch}" >/dev/null 2>&1; then
    default_ref="FETCH_HEAD"
else
    default_ref="${REMOTE}/${default_branch}"
fi
default_base="${default_branch}"

# Cut (or switch to) the feature branch off the default branch. Uncommitted
# worktree changes from the worker carry across the checkout.
#
# A plain `git checkout -b` refuses when those changes touch a file whose
# content differs between the worker's base and the fetched tip — the worker's
# worktree was cut from a STALE base and the default branch has moved since
# (a merged PR from an earlier task in the same session is the common case).
# That is not a real conflict, so do not hard-fail on it: replay the worker's
# edits onto the fresh base instead (`_carry_onto`), which is what a rebase
# would have done. The pre-replay snapshot means even the unresolvable case
# leaves the work on a ref rather than losing it.
_carry_onto() {
    local branch="$1" base="$2" head_sha snapshot ref
    head_sha="$(git rev-parse --verify --quiet HEAD 2>/dev/null || true)"
    [[ -n "${head_sha}" ]] || return 1

    ref="$(_rescue_snapshot "open_task_pr: ${TASK_ID} edits before replay onto ${base}")"
    snapshot=""
    [[ -n "${ref}" ]] && snapshot="$(git rev-parse --verify --quiet "${ref}" 2>/dev/null || true)"
    if [[ -z "${snapshot}" ]]; then
        # No snapshot → no safety net, so do not touch the tree. Either the tree
        # is clean (the checkout failed for some other reason) or
        # rescue_snapshot.sh is unavailable.
        echo "open_task_pr: cannot branch off '${base}' and could not snapshot the working tree first — refusing to move it. Check that claude-arsenal/bin/rescue_snapshot.sh is present, then re-run." >&2
        return 1
    fi

    # Clear the tree to its stale HEAD before moving: the snapshot holds every
    # edit, and leaving the worker's untracked files in place would make the
    # replay below fail with "untracked working tree files would be
    # overwritten". `clean -fd` (no -x) keeps ignored files — node_modules and
    # friends stay put.
    git reset -q --hard >/dev/null 2>&1 || true
    git clean -fdq >/dev/null 2>&1 || true
    git checkout -f -B "${branch}" "${base}" >/dev/null 2>&1 || return 1
    # Applies the snapshot's diff against its parent (the stale base) onto the
    # fresh base, three-way. -n leaves it staged; unstage so the tree looks
    # exactly like the normal carry-across path before `git add -A` below.
    if ! git cherry-pick -n "${snapshot}" >/dev/null 2>&1; then
        git cherry-pick --quit >/dev/null 2>&1 || true
        git reset -q --hard "${base}" >/dev/null 2>&1 || true
        echo "open_task_pr: worker edits for ${TASK_ID} conflict with '${base}' and could not be replayed automatically. They are saved at ${ref} — resolve with 'git cherry-pick -n ${ref}' on the fresh base, then re-run." >&2
        return 1
    fi
    git reset -q >/dev/null 2>&1 || true
    echo "open_task_pr: worker's base was stale; replayed its edits onto '${base}' (snapshot kept at ${ref})" >&2
    return 0
}

current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ "${current}" != "${BRANCH}" ]]; then
    if git rev-parse --verify --quiet "${BRANCH}" >/dev/null 2>&1; then
        git checkout "${BRANCH}" >/dev/null 2>&1 || { echo "open_task_pr: cannot switch to ${BRANCH}" >&2; exit 1; }
    elif ! git checkout -b "${BRANCH}" "${default_ref}" >/dev/null 2>&1; then
        if ! git rev-parse --verify --quiet "${default_ref}" >/dev/null 2>&1; then
            echo "open_task_pr: cannot resolve default branch '${default_branch}' (ref '${default_ref}') to branch off" >&2
            exit 1
        fi
        _carry_onto "${BRANCH}" "${default_ref}" || exit 1
    fi
fi

# Stage and commit. A dynamic Co-Authored-By is added only when supplied.
#
# Safety guard: git add -A stages everything in the working tree, which risks
# sweeping a CONCURRENT worker's files or secrets into this commit when workers
# share one checkout. The guard used to require ARSENAL_SURFACE=worktree — but
# nothing set it, so every worker hit the refusal and exported it itself. A
# guard the guarded party certifies is not a guard. So derive the answer:
#
#   1. A linked worktree (`git worktree add`) IS the isolation → allow.
#   2. Serialized in-place mode → allow. Not the caller's word for it: the
#      sentinel is written by worktree_probe.sh / worker_postcheck.sh (the
#      orchestrator's own probes), and `unavailable` is exactly what clamps
#      queue_batch.sh to one worker — so there is no concurrent worker to
#      clobber.
#   3. Otherwise refuse. ARSENAL_ALLOW_SHARED_ADD=1 is the operator escape
#      hatch for a bespoke setup, named so it reads as what it is.
_isolation_sentinel() {
    local dir="${ARSENAL_SESSION_DIR:-claude-arsenal/session}"
    [[ -f "${dir}/worktree_isolation" ]] || return 1
    [[ "$(tr -d '[:space:]' < "${dir}/worktree_isolation" 2>/dev/null)" == "unavailable" ]]
}
if _in_linked_worktree; then
    :
elif [[ "${ARSENAL_WORKTREE_ISOLATION:-}" == "unavailable" ]] || _isolation_sentinel; then
    :
elif [[ "${ARSENAL_ALLOW_SHARED_ADD:-}" == "1" ]]; then
    :
else
    echo "open_task_pr: git add -A refused on shared checkout — not running in a linked git worktree and serialized in-place mode is not recorded (claude-arsenal/session/worktree_isolation). Run from an isolated worktree, or set ARSENAL_ALLOW_SHARED_ADD=1 if you have verified no other worker shares this checkout." >&2
    exit 1
fi
git add -A
commit_args=(-m "${TYPE}: ${TITLE}")
if [[ -n "${ARSENAL_COAUTHOR:-}" ]]; then
    commit_args+=(-m "Co-Authored-By: ${ARSENAL_COAUTHOR}")
fi
if ! git commit "${commit_args[@]}" >/dev/null 2>&1; then
    echo "open_task_pr: nothing to commit for ${TASK_ID} (empty diff); return outcome 'open' with failure notes" >&2
    exit 1
fi

# Push with exponential backoff (network-transient retry only).
delay=1
pushed=0
for _ in 1 2 3; do
    if git push -u "${REMOTE}" "${BRANCH}" >/dev/null 2>&1; then pushed=1; break; fi
    sleep "${delay}"
    delay=$((delay * 2))
done
if [[ "${pushed}" -ne 1 ]]; then
    echo "open_task_pr: push of ${BRANCH} to ${REMOTE} failed" >&2
    exit 1
fi

# Open the PR when a CLI backend is present; otherwise hand the branch back so
# the orchestrator opens it via the github skill / MCP.
if command -v gh >/dev/null 2>&1; then
    body="$(printf '## Summary\n\n%s\n\n## Test plan\n\nSee acceptance gate in claude-arsenal/queue/%s.md.\n' "${TITLE}" "${TASK_ID}")"
    if url="$(gh pr create --base "${default_base}" --head "${BRANCH}" \
                --title "${TYPE}: ${TITLE}" --body "${body}" 2>/dev/null)"; then
        echo "${url}"
        exit 0
    fi
fi

echo "branch:${BRANCH}"
exit 0
