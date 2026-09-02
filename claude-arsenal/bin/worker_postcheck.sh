#!/usr/bin/env bash
# worker_postcheck.sh
# Run by the orchestrator after EVERY worker returns.
# Restores and asserts the one invariant the coordination protocol depends on:
# HEAD is back on the queue branch and the working tree is clean.
#
# Why: a worker is supposed to run in its own `isolation: worktree`. When that
# isolation is silently unavailable (observed on some web sessions), the worker
# runs in the orchestrator's shared tree instead: open_task_pr.sh checks out a
# feature branch (moving the orchestrator's HEAD off the coordination branch),
# and a gate-failed worker can leave uncommitted edits sitting on the
# orchestrator's own tree. Subsequent steps then run from the wrong branch (it guards on the recorded host
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
# NOTHING IS EVER DISCARDED IRRECOVERABLY. The restore path is a hard reset of
# whatever tree it runs in — including the host's MAIN working tree, which is
# where the orchestrator runs it. Uncommitted work that happens to be sitting
# there (a human's WIP, an orchestrator's own in-progress edit) has no blob in
# the object database and cannot be recovered from the reflog. So every
# destructive path here first snapshots the whole tree — tracked edits AND
# untracked files — to a permanent `refs/arsenal-rescue/…` ref via
# rescue_snapshot.sh, prints that ref on stderr, and appends it to
# `${ARSENAL_SESSION_DIR}/rescue_refs`.
#
# Exit 4: the worker reported `done` without the evidence a completion carries
#         (a PR URL or `branch:` line, and `toplevel:`). Checked before anything
#         destructive runs, because an abandoned worker's gate may still be
#         alive. Only checked when ARSENAL_WORKER_OUTCOME is passed.
# Stdout: `ok` | `restored`. NOTE: `ok` means the tree invariant holds, NOT
#         that worktree isolation is in effect — that verdict is the
#         `worktree_isolation` sentinel, which the selector reads directly.
# Env:    ARSENAL_WORKER_TOPLEVEL — the worker's `git rev-parse --show-toplevel`.
#         Without it isolation cannot be proven and nothing is recorded.
#         ARSENAL_WORKER_OUTCOME / ARSENAL_WORKER_RESULT — the outcome the worker
#         reported and its returned text, so a `done` that carries no PR URL,
#         no `branch:` and no `toplevel:` is refused (exit 4) instead of recorded.
# Stderr: `worker_postcheck: rescued uncommitted changes to <ref> …` when a
#         restore had work to save.
# Exit:   0 invariant holds (possibly after restore); 2 could not restore;
#         3 the tree was dirty and could not be snapshotted, so NOTHING was
#           discarded and the restore did not run.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd 2>/dev/null || echo .)"

# Snapshot the working tree to a rescue ref before a destructive restore, and
# tell the operator where it went. The ref lands in RESCUED_REF for
# _record_rescue_ref to persist AFTER the restore.
#
# Returns non-zero when the tree had work and it could NOT be put on a ref —
# and the caller must then not run the destructive step. Previously
# rescue_snapshot.sh reported a failed snapshot exactly as it reported a clean
# tree (no ref, exit 0), so a disk-full or a permissions error read as "nothing
# to save" and the reset went ahead anyway: the work destroyed, and no ref to
# get it back from. A missing rescue_snapshot.sh is the one case that still
# degrades to the old behaviour, because a bundle that does not ship it cannot
# be made safer by refusing to run.
RESCUED_REF=""
_rescue_before_restore() {
    local reason="$1" status
    RESCUED_REF=""
    [[ -f "${SCRIPT_DIR}/rescue_snapshot.sh" ]] || return 0
    RESCUED_REF="$(bash "${SCRIPT_DIR}/rescue_snapshot.sh" "${reason}" 2>/dev/null)"
    status=$?
    if [[ ${status} -ne 0 || -z "${RESCUED_REF}" ]]; then
        RESCUED_REF=""
        return 1
    fi
    echo "worker_postcheck: rescued uncommitted changes to ${RESCUED_REF} before restoring — recover with 'git checkout ${RESCUED_REF} -- .' (or 'git diff HEAD ${RESCUED_REF} | git apply')" >&2
    return 0
}

# Persist the rescue ref for the orchestrator. Must run AFTER the restore: the
# session dir is untracked, so the restore's own `git clean -fdq` would delete
# a note written before it.
_record_rescue_ref() {
    local dir
    [[ -n "${RESCUED_REF}" ]] || return 0
    dir="${ARSENAL_SESSION_DIR:-${ARSENAL_HOME:-arsenal}/session}"
    mkdir -p "${dir}" 2>/dev/null || return 0
    printf '%s\n' "${RESCUED_REF}" >> "${dir}/rescue_refs" 2>/dev/null || true
}

# Persist the isolation verdict for task_select.py (QIC-6).
#
# `restored` is proof of in-place execution: the orchestrator's HEAD had moved,
# so something ran in its tree → `unavailable`, and the next batch is clamped to
# one worker without relying on the orchestrator to remember.
#
# The positive verdict needs real evidence, and "HEAD did not move" is not it.
# A worker can run in the orchestrator's tree without ever moving HEAD: on a
# surface that restricts pushes to the session's designated branch, the branch
# the worker should be on IS the branch the orchestrator is on; and a worker
# that fails before reaching open_task_pr.sh never switches branch either. Both
# leave the invariant intact and used to be recorded as `available` — which is
# what PERMITS ramping to ARSENAL_MAX_WORKERS > 1, so an unproven condition
# licensed the exact parallel-fan-out-into-one-tree it exists to prevent (#147).
#
# So the answer comes from the worker itself: ARSENAL_WORKER_TOPLEVEL carries
# the `git rev-parse --show-toplevel` the worker returns. Different root → it
# genuinely ran elsewhere → `available`. Same root → in-place → `unavailable`,
# whatever the branch did. Absent → nothing is recorded, and `unknown` keeps the
# selector clamped, because the safe reading of unproven is not "proven".
_record_isolation() {
    local dir="${ARSENAL_SESSION_DIR:-${ARSENAL_HOME:-arsenal}/session}"
    mkdir -p "${dir}" 2>/dev/null || return 0
    printf '%s\n' "$1" > "${dir}/worktree_isolation" 2>/dev/null || true
}

# There is one invariant now: the session's tree must still be on the branch it
# started on, and it must be clean. The coordination branch is gone, so there is
# no second tree to reconcile against and no "legacy mode" — just this.
#
# The host branch is NOT assumed to be `main`: on Claude Code on the web a
# session is pinned to its own designated branch (e.g. `claude/web-…`), so
# resetting to `main` would throw away the session's own work (#128). It is
# recorded on first run and reused from then on; an explicit
# ARSENAL_DEFAULT_BRANCH always wins.
# A `done` has to carry its evidence, and this runs BEFORE the restore below.
#
# The failure: a host gate that takes 10-12 minutes invites a worker to run it as
# a background job, arm a watcher, and end its turn — "I'll pick back up when the
# monitor notifies me." Ending the turn is terminal. The orchestrator is notified
# of a COMPLETED worker whose result is that sentence: no PR, no `branch:`, no
# `toplevel:`. The task looks finished and is not, and the notification is
# indistinguishable from a real completion unless somebody reads the prose and
# asks where the PR URL went. Measured three times in one fan-out of nine, each
# time after a broader prohibition in the dispatch prompt — so this is a protocol
# gap, not a worker defect, and prose is the mitigation that already failed.
#
# It runs first for a reason. An abandoned worker's gate is often STILL RUNNING;
# the restore below is `reset --hard` + `clean -fd`, which would destroy the very
# work this is meant to rescue. Refuse before touching the tree.
#
# Opt-in by passing ARSENAL_WORKER_OUTCOME: an orchestrator that does not pass it
# gets exactly the old behaviour.
if [[ "${ARSENAL_WORKER_OUTCOME:-}" == "done" ]]; then
    _missing=""
    [[ -n "${ARSENAL_WORKER_TOPLEVEL:-}" ]] || _missing="toplevel:"
    if ! printf '%s' "${ARSENAL_WORKER_RESULT:-}" \
        | grep -qE '(https?://[^[:space:]]+/pull/[0-9]+|^[[:space:]]*branch:[[:space:]]*[^[:space:]]+)'; then
        _missing="${_missing:+${_missing} and }a PR URL or branch: line"
    fi
    if [[ -n "${_missing}" ]]; then
        echo "worker_postcheck: a worker reported 'done' without ${_missing} — that is an ABANDONED task, not a completion, and the tree has NOT been touched." >&2
        echo "worker_postcheck: the usual cause is a worker that backgrounded the host gate or open_task_pr.sh and ended its turn; its processes may still be running. Resume that worker and let it finish in the foreground, rather than recording the task as done." >&2
        exit 4
    fi
fi

session_dir="${ARSENAL_SESSION_DIR:-${ARSENAL_HOME:-arsenal}/session}"
current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
dirty="$(git status --porcelain 2>/dev/null)"

recorded_branch=""
if [[ -f "${session_dir}/host_branch" ]]; then
    recorded_branch="$(cat "${session_dir}/host_branch" 2>/dev/null || true)"
fi
_entry_branch="${current}"
host_branch="${ARSENAL_DEFAULT_BRANCH:-${recorded_branch}}"
if [[ -z "${host_branch}" ]]; then
    # First run of the session: whatever we are on now IS the host branch.
    # Recording it here rather than guessing is what stops a later restore from
    # dragging the session onto a branch it never asked for.
    host_branch="${current:-main}"
    mkdir -p "${session_dir}" 2>/dev/null || true
    printf '%s\n' "${host_branch}" > "${session_dir}/host_branch" 2>/dev/null || true
fi

# Did the worker run in a different tree? Answered from the worker's own root,
# never inferred from a branch name that need not have changed.
_isolation_from_worker_root() {
    local worker_root="${ARSENAL_WORKER_TOPLEVEL:-}"
    local own_root
    [[ -n "${worker_root}" ]] || { echo "unknown"; return 0; }
    own_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
    [[ -n "${own_root}" ]] || { echo "unknown"; return 0; }
    if [[ "${worker_root}" == "${own_root}" ]]; then
        echo "unavailable"
    else
        echo "available"
    fi
}

if [[ "${current}" == "${host_branch}" && -z "${dirty}" ]]; then
    verdict="$(_isolation_from_worker_root)"
    case "${verdict}" in
        available|unavailable) _record_isolation "${verdict}" ;;
        *)
            echo "worker_postcheck: no ARSENAL_WORKER_TOPLEVEL from the worker, so isolation is unproven — recording nothing, and the selector stays clamped to one worker. Have the worker return 'git rev-parse --show-toplevel' (agents/worker.md) and pass it through." >&2
            ;;
    esac
    if [[ "${verdict}" == "unavailable" ]]; then
        echo "worker_postcheck: the worker ran in this tree (${ARSENAL_WORKER_TOPLEVEL}) — isolation is NOT in effect; staying serialized in-place" >&2
    fi
    echo "ok"
    exit 0
fi

# Recover. Discard uncommitted changes — the worker's code lives on its pushed
# feature branch, or it is an abandoned gate failure, exactly what a real
# worktree's cleanup would have thrown away. `reset --hard` leaves gitignored
# session files untouched; `clean -fdq` removes untracked but not ignored files.
#
# That is the INTENT — but this runs in the host's shared tree, where the
# assumption can be wrong. Snapshot first, so a wrong assumption costs a ref
# lookup rather than the work.
if [[ -n "${dirty}" ]]; then
    if ! _rescue_before_restore "worker_postcheck: restoring '${current:-unknown}' to '${host_branch}'"; then
        # Refusing is the whole point. This runs in the host's MAIN tree, and
        # `reset --hard` on uncommitted work leaves nothing to recover from —
        # no reflog, no stash, no dangling object. A dirty tree the orchestrator
        # cannot restore is a stall; one it destroyed is not recoverable at all.
        echo "worker_postcheck: the working tree is dirty and could NOT be snapshotted to a rescue ref — refusing to reset. Nothing was discarded. Commit or stash the tree by hand, then re-run; check disk space and repository permissions first." >&2
        exit 3
    fi
fi
git reset -q --hard >/dev/null 2>&1 || true
git clean -fdq >/dev/null 2>&1 || true
if [[ "${current}" != "${host_branch}" ]]; then
    git checkout -f "${host_branch}" >/dev/null 2>&1 || true
fi

current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
dirty="$(git status --porcelain 2>/dev/null)"
if [[ "${current}" != "${host_branch}" || -n "${dirty}" ]]; then
    echo "worker_postcheck: could not restore HEAD to '${host_branch}' / clean tree (HEAD=${current:-unknown})" >&2
    exit 2
fi

_record_rescue_ref

# The isolation verdict is a measurement, not a side effect of how much this
# script had to clean up. `restored` used to record `unavailable` outright, so a
# tree that was merely DIRTY — session scratch, an untracked artifact — outranked
# the worker's own reported root and clamped every later batch to one task. The
# measured case: worker root `.claude/worktrees/agent-…`, orchestrator root the
# repo, HEAD never off `main` (the rescue commit said `restoring 'main' to
# 'main'`), and the verdict came back `unavailable` anyway.
#
# HEAD having MOVED is different: that is real evidence something ran in this
# tree, and it still outranks the worker's claim. Only the dirty-tree-alone case
# defers to the measurement.
if [[ "${_entry_branch}" != "${host_branch}" ]]; then
    _record_isolation unavailable
else
    case "$(_isolation_from_worker_root)" in
        available)
            _record_isolation available
            echo "worker_postcheck: the tree was dirty and has been restored, but the worker ran in ${ARSENAL_WORKER_TOPLEVEL} and HEAD never left '${host_branch}' — isolation holds, so the batch is not clamped" >&2
            ;;
        # No report, or the worker names this very tree. Both stay conservative:
        # the restore happened for a reason and nothing measured says otherwise.
        *) _record_isolation unavailable ;;
    esac
fi
echo "restored"
exit 0
