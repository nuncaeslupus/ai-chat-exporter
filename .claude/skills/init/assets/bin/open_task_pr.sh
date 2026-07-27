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
#      ARSENAL_SURFACE (must equal 'worktree' to permit git add -A).
# Exit: 0 branch pushed (PR opened or branch emitted), 1 on push failure / usage.

set -uo pipefail

REMOTE="${ARSENAL_QUEUE_REMOTE:-origin}"
TASK_ID="${1:?open_task_pr.sh requires <task_id>}"
TITLE="${2:?open_task_pr.sh requires <title>}"
TYPE="${3:-feat}"

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
current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ "${current}" != "${BRANCH}" ]]; then
    if git rev-parse --verify --quiet "${BRANCH}" >/dev/null 2>&1; then
        git checkout "${BRANCH}" >/dev/null 2>&1 || { echo "open_task_pr: cannot switch to ${BRANCH}" >&2; exit 1; }
    elif ! git checkout -b "${BRANCH}" "${default_ref}" >/dev/null 2>&1; then
        echo "open_task_pr: cannot resolve default branch '${default_branch}' (ref '${default_ref}') to branch off" >&2
        exit 1
    fi
fi

# Stage and commit. A dynamic Co-Authored-By is added only when supplied.
# Safety guard: git add -A stages everything in the working tree, which risks
# sweeping unrelated files or secrets when multiple workers share the same
# checkout. Only allow it when ARSENAL_SURFACE confirms this process is running
# inside an isolated worktree. If the surface is unset (legacy / no-init
# context) or indicates a shared checkout, refuse loudly rather than silently
# staging unrelated files.
if [[ "${ARSENAL_SURFACE:-}" != "worktree" ]]; then
    echo "open_task_pr: git add -A refused on shared checkout — ARSENAL_SURFACE='${ARSENAL_SURFACE:-<unset>}' (expected 'worktree'). Run from an isolated worktree." >&2
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
