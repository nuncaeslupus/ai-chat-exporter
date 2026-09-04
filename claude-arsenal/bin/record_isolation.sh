#!/usr/bin/env bash
# record_isolation.sh — record that worker isolation is guaranteed by the
# DISPATCH MECHANISM, for surfaces where no worker returns through
# worker_postcheck.sh.
#
# The deadlock this exists to break (#247):
#
#   worktree_probe.sh deliberately persists only a NEGATIVE verdict, because a
#   passing git-level probe does not prove the Task tool honors
#   `isolation: worktree`. So `available` has exactly one writer —
#   worker_postcheck.sh, observing a returned worker's ARSENAL_WORKER_TOPLEVEL.
#   A worker dispatched as a SEPARATE SESSION never returns through that path.
#   The sentinel therefore stays absent forever, task_select.py reads `unknown`,
#   and every batch is clamped to one task on the one surface where separate
#   sessions are the only shape that works at all.
#
# Why worker_postcheck.sh cannot simply be handed a toplevel from any source,
# which is the fix the issue proposes:
#
#   its check is `worker_root != own_root`, and across containers that
#   comparison INVERTS. Two containers routinely both check out at
#   /home/user/<repo>, so identical paths would be read as "the worker ran in my
#   tree" — `unavailable` — at the exact moment isolation is most complete. Path
#   equality is evidence of a shared tree only WITHIN one filesystem. Feeding it
#   a cross-container path makes it answer confidently and wrongly.
#
# So this records a different kind of fact. Not "I measured two roots and they
# differed", but "I dispatched through a mechanism that cannot share a tree".
# For a separate container with its own clone, cross-worker clobbering — the only
# thing the clamp prevents — is impossible by construction, not by observation.
#
# WHAT THIS ASSUMES, stated plainly because it is the acceptance criterion for a
# safety clamp: that the named mechanisms really do give each worker its own
# filesystem. That is true of a separately-created session (its own container,
# its own clone) and of an explicitly-created separate clone. It is NOT
# something this script can verify from here — it is an attestation by the
# orchestrator about how it dispatched. That is why the vocabulary is closed:
# an orchestrator may attest a mechanism the bundle knows, and may not invent a
# reason. An unknown name is a hard error, never a passthrough.
#
# Usage:  record_isolation.sh <mechanism>
#         record_isolation.sh --list
#
# Exit:   0 recorded; 2 unknown mechanism or bad usage.

set -uo pipefail

# The closed vocabulary. Each entry names a dispatch mechanism under which two
# workers CANNOT reach the same working tree, with why it holds.
_MECHANISMS=(
    "separate-session:each worker is a session in its own container with its own clone"
    "separate-clone:each worker was given its own clone on this filesystem"
)

_list() {
    local row
    for row in "${_MECHANISMS[@]}"; do
        printf '  %-18s %s\n' "${row%%:*}" "${row#*:}"
    done
}

_usage() {
    cat <<EOF
usage: record_isolation.sh <mechanism>

Records that worker isolation holds because of HOW workers were dispatched,
for surfaces where no worker returns through worker_postcheck.sh.

Known mechanisms:
$(_list)

This is an attestation, not a measurement. Use it only when you dispatched
through the mechanism you name. If workers run as Task-tool subagents in this
session, do NOT use this — worker_postcheck.sh measures that case correctly and
its answer is worth more than an assertion.
EOF
}

case "${1:-}" in
    -h|--help) _usage; exit 0 ;;
    --list) _list; exit 0 ;;
    "") echo "record_isolation: a mechanism is required" >&2; _usage >&2; exit 2 ;;
esac

MECHANISM="$1"
known=0
for row in "${_MECHANISMS[@]}"; do
    [[ "${MECHANISM}" == "${row%%:*}" ]] && { known=1; break; }
done

if [[ "${known}" != 1 ]]; then
    echo "record_isolation: unknown mechanism '${MECHANISM}'" >&2
    echo "record_isolation: an unknown name is refused rather than recorded — this file gates a safety clamp, so the vocabulary is closed. Known mechanisms:" >&2
    _list >&2
    exit 2
fi

dir="${ARSENAL_SESSION_DIR:-${ARSENAL_HOME:-arsenal}/session}"
if ! mkdir -p "${dir}" 2>/dev/null; then
    echo "record_isolation: cannot create ${dir}" >&2
    exit 2
fi

# ORDER MATTERS, and it is the provenance that goes first.
#
# The sentinel is what lifts a safety clamp. Provenance is one of the three
# things bounding that decision — a closed vocabulary, a refusal that writes
# nothing, and a record of who attested what and when. Writing the sentinel
# first and letting the sidecar fail soft meant a blocked provenance write
# (a stale directory at that path is enough) still lifted the clamp, still
# exited 0, and still printed that provenance existed. An attestation nobody
# can audit is the thing this was supposed to be better than.
#
# So: build the provenance in a temp file, publish it, and only then record the
# verdict. Every failure leaves the sentinel untouched, which leaves the clamp
# ON — the safe direction. The reverse ordering has no safe failure at all.
session="${CLAUDE_CODE_REMOTE_SESSION_ID:-${CLAUDE_CODE_SESSION_ID:-unknown}}"
why="${dir}/worktree_isolation.why"
why_tmp="${why}.$$.tmp"

# `mv file dir` MOVES THE FILE INTO THE DIRECTORY and reports success, so a
# stale directory at the provenance path would sail through the publish below
# and leave the sentinel lifted with the provenance filed one level down where
# nothing looks for it. Reject anything that is not a regular file up front, and
# assert the result after — a publish that "succeeded" is not the same fact as
# the provenance being where it belongs.
if [[ -e "${why}" && ! -f "${why}" ]]; then
    echo "record_isolation: ${why} exists and is not a regular file — recording NOTHING. The verdict gates a batch-width clamp and is only as good as its provenance; remove whatever is at that path and re-run." >&2
    exit 2
fi

if ! {
    printf 'verdict: available\n'
    printf 'basis: attested-dispatch-mechanism\n'
    printf 'mechanism: %s\n' "${MECHANISM}"
    printf 'recorded_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
    printf 'recorded_by_session: %s\n' "${session}"
} > "${why_tmp}" 2>/dev/null; then
    rm -f "${why_tmp}" 2>/dev/null || true
    echo "record_isolation: cannot write provenance to ${why_tmp} — recording NOTHING. The verdict gates a batch-width clamp and is only as good as the record of who attested it, so a provenance that cannot be written is a refusal, not a warning." >&2
    exit 2
fi

if ! mv -f "${why_tmp}" "${why}" 2>/dev/null || [[ ! -f "${why}" ]]; then
    rm -f "${why_tmp}" 2>/dev/null || true
    echo "record_isolation: cannot publish provenance to ${why} — recording NOTHING, and the isolation sentinel is untouched." >&2
    exit 2
fi

# Last, and only now. A failure here leaves provenance describing a verdict that
# was not recorded, which reads correctly: the clamp stays on.
if ! printf 'available\n' > "${dir}/worktree_isolation" 2>/dev/null; then
    echo "record_isolation: provenance was written to ${why} but the verdict could not be written to ${dir}/worktree_isolation — nothing has been lifted; the batch stays clamped." >&2
    exit 2
fi

echo "record_isolation: recorded available (mechanism: ${MECHANISM}) — provenance in ${why}"
exit 0
