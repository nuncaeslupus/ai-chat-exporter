#!/usr/bin/env bash
# reconcile_merged.sh — flip `done` tasks whose PR has merged to `merged`.
#
# The queue's `done` status means "PR opened + gate passed", NOT "PR merged".
# This walks every `done` task in tasks.jsonl that carries a `pr` URL, asks `gh`
# whether that PR is merged, and records the terminal `merged` status via
# release.sh — the single coordination-branch writer — for those that landed.
# Run it on the coordination branch (like release.sh), on demand or at session
# start, so the board distinguishes opened-but-unmerged from merged.
#
# Env: ARSENAL_QUEUE_REMOTE / ARSENAL_QUEUE_BRANCH (passed through to release.sh).
# Exit: 0 (reports how many flipped), 2 on misconfiguration (no gh / no queue).

set -uo pipefail

QUEUE_FILE="claude-arsenal/queue/tasks.jsonl"
# In worktree mode the live queue lives inside the coordination worktree (where
# release.sh writes it); read it there, not the stale main-tree copy, or the
# done→merged flip silently no-ops.
if [[ -n "${ARSENAL_QUEUE_DIR:-}" && -d "${ARSENAL_QUEUE_DIR}" ]]; then
    QUEUE_FILE="${ARSENAL_QUEUE_DIR}/${QUEUE_FILE}"
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE="${SCRIPT_DIR}/release.sh"

if ! command -v gh >/dev/null 2>&1; then
    echo "reconcile_merged: gh not found — cannot query PR merge state" >&2
    exit 2
fi
if [[ ! -f "${QUEUE_FILE}" ]]; then
    echo "reconcile_merged: no queue at ${QUEUE_FILE}" >&2
    exit 2
fi

# Emit "<id>\t<pr>" for every `done` task carrying an http(s) PR URL. Rows whose
# `pr` is a bare `branch:<name>` (no PR backend yet) are skipped — nothing to query.
# A `while read` loop (not `mapfile`) keeps this working on macOS's stock Bash 3.2.
entries=()
while IFS= read -r entry; do
    [[ -n "${entry}" ]] && entries+=("${entry}")
done < <(python3 - "${QUEUE_FILE}" <<'PY'
import sys, json, pathlib

for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        row = json.loads(line)
    except json.JSONDecodeError:
        continue
    if not isinstance(row, dict):
        continue
    pr = row.get("pr")
    if row.get("status") == "done" and isinstance(pr, str) and pr.startswith("http"):
        print(f"{row['id']}\t{pr}")
PY
)

flipped=0
for entry in "${entries[@]}"; do
    [[ -z "${entry}" ]] && continue
    id="${entry%%$'\t'*}"
    pr="${entry#*$'\t'}"
    state="$(gh pr view "${pr}" --json state --jq .state 2>/dev/null || echo "")"
    if [[ "${state}" == "MERGED" ]]; then
        bash "${RELEASE}" "${id}" merged --pr "${pr}"
        rc=$?
        if [[ "${rc}" -eq 0 ]]; then
            flipped=$((flipped + 1))
            echo "reconcile_merged: ${id} done → merged (${pr})"
        elif [[ "${rc}" -eq 2 ]]; then
            # Misconfiguration (wrong branch / no upstream) — affects every task,
            # so abort rather than retry it for the rest.
            echo "reconcile_merged: release.sh misconfiguration (exit 2); aborting" >&2
            exit 2
        else
            echo "reconcile_merged: failed to record merged for ${id}" >&2
        fi
    fi
done

echo "reconcile_merged: ${flipped} task(s) flipped to merged"
exit 0
