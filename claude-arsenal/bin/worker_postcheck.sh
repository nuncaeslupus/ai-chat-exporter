#!/usr/bin/env bash
# worker_postcheck.sh
# Run by the orchestrator after EVERY worker returns and BEFORE release.sh.
# Restores and asserts the one invariant the coordination protocol depends on:
# HEAD is back on the queue branch and the working tree is clean.
#
# Why: a worker is supposed to run in its own `isolation: worktree`. When that
# isolation is silently unavailable (observed on some web sessions), the worker
# runs in the orchestrator's shared tree instead: open_task_pr.sh checks out a
# feature branch (moving the orchestrator's HEAD off the coordination branch),
# and a gate-failed worker can leave uncommitted edits sitting on the
# append-only ledger. release.sh then refuses to run (it guards on the queue
# branch), and a stray `git commit -a` could sweep task code onto the queue
# branch. This script makes the post-worker state safe either way:
#   - In a real worktree the orchestrator's HEAD never moved → cheap no-op that
#     just confirms the invariant (prints `ok`).
#   - In the silent in-place case it discards the worker's residual tree state
#     (its code is already committed+pushed on the feature branch for a `done`,
#     or deliberately abandoned for a gate failure) and returns to the queue
#     branch (prints `restored`).
#
# A `restored` result is the orchestrator's signal that worktree isolation is
# NOT in effect this session: it must clamp ARSENAL_MAX_WORKERS=1 and stay in
# serialized in-place mode for the rest of the loop.
#
# Stdout: `ok` | `restored`.
# Exit:   0 invariant holds (possibly after restore); 2 could not restore.

set -uo pipefail

QUEUE_BRANCH="${ARSENAL_QUEUE_BRANCH:-arsenal-queue}"

# Persist the isolation verdict for queue_batch.sh (QIC-6). `ok` confirms the
# worker really ran in its own worktree (the orchestrator's HEAD never moved) →
# parallel fan-out is safe. `restored` means isolation was silently ignored and
# the worker ran in-place → record `unavailable` so the next batch is clamped to
# a single worker without relying on the orchestrator to remember to clamp.
_record_isolation() {
    local dir="${ARSENAL_SESSION_DIR:-claude-arsenal/session}"
    mkdir -p "${dir}" 2>/dev/null || return 0
    printf '%s\n' "$1" > "${dir}/worktree_isolation" 2>/dev/null || true
}

# In worktree mode the main tree SHOULD stay on whatever branch it was on when
# queue_branch.sh set up the coordination worktree ("the host branch"), but if
# the Task tool silently ignores isolation: worktree the worker runs in-place
# and can move the main HEAD. Check and restore the main tree first so the
# orchestrator can detect this (a `restored` result clamps ARSENAL_MAX_WORKERS=1).
if [[ -n "${ARSENAL_QUEUE_DIR:-}" ]]; then
    # The host branch is NOT assumed to be `main` — on Claude Code on the web a
    # session is typically pinned to its own designated branch (e.g.
    # `claude/web-continuation-xxx`). queue_branch.sh persists the main tree's
    # actual branch to this session file; only fall back to the literal `main`
    # when neither an explicit override nor a recorded value is available
    # (e.g. queue_branch.sh predates #128). ARSENAL_DEFAULT_BRANCH still wins
    # when the orchestrator sets it explicitly.
    session_dir="${ARSENAL_SESSION_DIR:-claude-arsenal/session}"
    recorded_branch=""
    if [[ -f "${session_dir}/host_branch" ]]; then
        recorded_branch="$(cat "${session_dir}/host_branch" 2>/dev/null || true)"
    fi
    default_branch="${ARSENAL_DEFAULT_BRANCH:-${recorded_branch:-main}}"
    current_main="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    dirty_main="$(git status --porcelain 2>/dev/null)"

    # Only reset when the branch actually moved — a dirty-but-correct-branch
    # state means the user has uncommitted edits, which must NOT be destroyed.
    if [[ "${current_main}" != "${default_branch}" ]]; then
        git reset -q --hard >/dev/null 2>&1 || true
        git clean -fdq >/dev/null 2>&1 || true
        git checkout -f "${default_branch}" >/dev/null 2>&1 || true
        _record_isolation unavailable
        echo "restored"
        exit 0
    fi

    wt_branch="$(git -C "${ARSENAL_QUEUE_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if [[ "${wt_branch}" == "${QUEUE_BRANCH}" ]]; then
        _record_isolation available
        echo "ok"
        exit 0
    fi
    echo "worker_postcheck: queue worktree '${ARSENAL_QUEUE_DIR}' is on '${wt_branch:-unknown}', expected '${QUEUE_BRANCH}'; re-run queue_branch.sh" >&2
    exit 2
fi

# Legacy (non-worktree) mode: ensure the main tree's HEAD is on the
# coordination branch and the tree is clean before release.sh runs.
current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
dirty="$(git status --porcelain 2>/dev/null)"

if [[ "${current}" == "${QUEUE_BRANCH}" && -z "${dirty}" ]]; then
    _record_isolation available
    echo "ok"
    exit 0
fi

# Recover. Discard any uncommitted worktree changes — the worker's code lives on
# its pushed feature branch (a `done`) or is an abandoned gate failure, exactly
# what a real worktree's cleanup would have thrown away. `reset --hard` leaves
# gitignored session files (rate_limits.json, surface_profile.json) untouched;
# `clean -fdq` removes untracked files but NOT ignored ones (no -x).
git reset -q --hard >/dev/null 2>&1 || true
git clean -fdq >/dev/null 2>&1 || true
if [[ "${current}" != "${QUEUE_BRANCH}" ]]; then
    git checkout -f "${QUEUE_BRANCH}" >/dev/null 2>&1 || true
fi

current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
dirty="$(git status --porcelain 2>/dev/null)"
if [[ "${current}" != "${QUEUE_BRANCH}" || -n "${dirty}" ]]; then
    echo "worker_postcheck: could not restore HEAD to '${QUEUE_BRANCH}' / clean tree (HEAD=${current:-unknown})" >&2
    exit 2
fi

_record_isolation unavailable
echo "restored"
exit 0
