#!/usr/bin/env bash
# worktree_probe.sh
# Probes whether git worktrees are usable in THIS checkout/sandbox, so the
# orchestrator can decide its dispatch mode before fanning out workers.
#
# Background: the orchestrator dispatches each worker as a Task-tool subagent
# with `isolation: worktree`. On some surfaces (observed on Claude Code on the
# web) that flag is silently ignored — no worktree is created and the worker
# runs in the orchestrator's shared tree on the coordination branch, moving HEAD
# and leaving uncommitted edits on the append-only ledger. A shell script cannot
# interrogate the Task tool, but it CAN test whether git worktrees work here at
# all. That is a necessary condition for safe parallel fan-out and for option
# (b) "orchestrator creates the worktree itself"; when it fails the orchestrator
# must fall back to a serialized, single-worker, in-place mode (ARSENAL_MAX_WORKERS=1)
# and lean on worker_postcheck.sh to keep the coordination branch invariant.
#
# Stdout: one word — `available` or `unavailable`.
# Exit:   0 if worktrees are usable, 1 if not. (Always prints the verdict.)

set -uo pipefail

# Record the isolation verdict where queue_batch.sh reads it, so an `unavailable`
# probe mechanically clamps the batch width to 1 (serialized in-place mode) —
# the orchestrator no longer has to remember to pass --max 1 (QIC-6). Only a
# negative probe is persisted: a passing git-level probe does NOT prove the Task
# tool honors `isolation: worktree`, so `available` is confirmed later by
# worker_postcheck.sh after the first worker returns.
_record_isolation() {
    local dir="${ARSENAL_SESSION_DIR:-claude-arsenal/session}"
    mkdir -p "${dir}" 2>/dev/null || return 0
    printf '%s\n' "$1" > "${dir}/worktree_isolation" 2>/dev/null || true
}

verdict() {
    [[ "$1" == "unavailable" ]] && _record_isolation unavailable
    echo "$1"
    [[ "$1" == "available" ]] && exit 0
    exit 1
}

# Must be inside a (non-bare) work tree to add a linked worktree.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || verdict unavailable

# The `git worktree` subcommand must exist (very old git lacks it).
git worktree list >/dev/null 2>&1 || verdict unavailable

# Functional probe: actually create and remove a throwaway detached worktree.
# Use mktemp -d for a private, unpredictable parent (avoids CWE-377 symlink /
# pre-creation attacks in a shared /tmp), then point the worktree at a child
# path inside it — `git worktree add` requires a non-existent target. Clean both
# up no matter how we exit.
tmp_parent="$(mktemp -d "${TMPDIR:-/tmp}/arsenal-wt-probe.XXXXXX")" || verdict unavailable
probe_dir="${tmp_parent}/wt"
cleanup() {
    git worktree remove --force "${probe_dir}" >/dev/null 2>&1 \
        || rm -rf "${probe_dir}"
    git worktree prune >/dev/null 2>&1 || true
    rm -rf "${tmp_parent}"
}
trap cleanup EXIT

if git worktree add --detach "${probe_dir}" >/dev/null 2>&1; then
    verdict available
fi
verdict unavailable
