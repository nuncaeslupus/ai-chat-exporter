#!/usr/bin/env bash
# queue_eval.sh [--surface-profile <path>]
# Emits the JSON of the next unblocked, highest-priority task eligible for the
# current surface.  Stdout is empty when no eligible task exists.
# Exit: 0 always.
#
# Thin wrapper over queue_batch.sh: the single-task case is a batch of one, so
# the selection/filter logic (deps, surface capabilities, LOOP_WORKSPACE,
# LOOP_TAGS) lives in queue_batch.sh and is shared, not duplicated here.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Pass through --surface-profile (and ignore unknown flags, as before).
ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --surface-profile) ARGS+=(--surface-profile "$2"); shift 2 ;;
        *) shift ;;
    esac
done

# --max 1 forces a single task regardless of ARSENAL_MAX_WORKERS; head -1 keeps
# the historical single-line contract even if that ever changes.
bash "${SCRIPT_DIR}/queue_batch.sh" --max 1 "${ARGS[@]}" | head -1

exit 0
