#!/usr/bin/env bash
# queue_doctor.sh [extra queue_doctor.py args]
# Read-only consistency check over the task queue. Wraps queue_doctor.py and
# auto-enables the layers whose tooling is present:
#   - --online       when `gh` is on PATH (cross-checks PR state: false-'done')
#   - --cross-branch  when `git` is on PATH (orphan payloads vs the default branch)
#
# Resolves the queue inside the coordination worktree when ARSENAL_QUEUE_DIR is
# set (like claim.sh / release.sh), else the main working tree. Never writes.
#
# Env:
#   ARSENAL_QUEUE_DIR      coordination worktree (set by queue_branch.sh); optional
#   ARSENAL_QUEUE_REMOTE   remote for --cross-branch (default origin)
#   ARSENAL_DEFAULT_BRANCH default branch for --cross-branch (default main)
#   ARSENAL_DOCTOR_OFFLINE set to 1 to skip the gh/git layers (fast, no network)
#
# Exit: 0 clean (or only findings below the gate), 1 findings at/above --fail-on
#       (default warn), 2 setup error. Suitable as a CI / `make` gate.

set -uo pipefail

REMOTE="${ARSENAL_QUEUE_REMOTE:-origin}"
DEFAULT_BRANCH="${ARSENAL_DEFAULT_BRANCH:-main}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCTOR_PY="${SCRIPT_DIR}/../scripts/queue_doctor.py"
if [[ ! -f "${DOCTOR_PY}" ]]; then
    echo "queue_doctor.sh: helper not found at ${DOCTOR_PY}" >&2
    exit 2
fi

QUEUE_REL="claude-arsenal/queue/tasks.jsonl"
if [[ -n "${ARSENAL_QUEUE_DIR:-}" && -d "${ARSENAL_QUEUE_DIR}" ]]; then
    QUEUE_PATH="${ARSENAL_QUEUE_DIR}/${QUEUE_REL}"
else
    QUEUE_PATH="${QUEUE_REL}"
fi

args=(--queue "${QUEUE_PATH}" --remote "${REMOTE}" --default-branch "${DEFAULT_BRANCH}")
if [[ "${ARSENAL_DOCTOR_OFFLINE:-}" != "1" ]]; then
    command -v gh  >/dev/null 2>&1 && args+=(--online --closed-issues)
    command -v git >/dev/null 2>&1 && args+=(--cross-branch)
fi

python3 "${DOCTOR_PY}" "${args[@]}" "$@"
