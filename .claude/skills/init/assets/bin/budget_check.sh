#!/usr/bin/env bash
# budget_check.sh — pre-dispatch quota guard for the worker loop.
#
# Reads arsenal/session/rate_limits.json (written by statusline_capture.sh)
# and decides whether the loop may dispatch more workers.
#
# Exit:
#   3 — a window reports a REFUSAL (`status` present and not "allowed"), OR
#       either window's used_percentage is at/above ARSENAL_QUOTA_STOP_PCT
#       (default 90), OR this session has dispatched ARSENAL_MAX_ITERATIONS
#       rounds (default 50). Loud and distinct so the loop STOPS and writes a
#       handover.
#   0 — under threshold, OR data is missing/unparseable/absent fields. The
#       missing-data case is a deliberate FAIL-OPEN for the QUOTA check only:
#       the loop keeps running where quota is not observable (API/metered usage,
#       non-Pro/Max plan, before the first response, or older Claude Code).
#
# A REFUSAL IS NOT A PERCENTAGE. `status` and `used_percentage` answer different
# questions and are checked separately, on purpose. A percentage is a forecast:
# 88% means the next call will probably work, and the threshold is a judgement
# about how much headroom a fleet should keep. `status: "rejected"` is a fact
# already established about a call that was made — the next one fails now,
# whatever any percentage says, and no threshold setting should be able to talk
# the loop past it. So the refusal check runs FIRST and ignores
# ARSENAL_QUOTA_STOP_PCT entirely; mapping one onto the other (a refusal
# synthesised as "100%") would let ARSENAL_QUOTA_STOP_PCT=101 disable it.
#
# It also reaches a surface the percentage cannot. `get_session` on a cloud
# session returns `rate_limit_info` with `status` and no `used_percentage`, so a
# document carrying only what that surface can supply used to hit the
# "no used_percentage" fail-open and guard nothing. Any value other than
# "allowed" stops — including `null`, `false` and a number: the field's vocabulary
# names the permitting value, and anything else, malformed or merely unfamiliar,
# is not a permission to continue. The check is keyed on the KEY being present,
# never on the value being well-formed. That direction
# is deliberate — the field is written only by a host that chose to write it, so
# an unrecognised value is a misconfiguration worth halting loudly over rather
# than a guard that quietly does nothing.
#
# rate_limits.json is Pro/Max-only, so on API/metered billing the quota guard
# always fails open. The per-session dispatch-round cap is the ALWAYS-AVAILABLE
# backstop: it does not depend on observable quota, so an auto-dispatching loop
# can never run unbounded. Set ARSENAL_MAX_ITERATIONS=0 to disable it (quota-only
# behaviour). The counter resets per session, keyed on
# CLAUDE_CODE_REMOTE_SESSION_ID falling back to CLAUDE_CODE_SESSION_ID — the
# same pair claiming-internals.md names. The old CLAUDE_SESSION_ID is set on no
# current surface, so every run keyed on the literal "default": one shared
# counter across every session on the machine, which both over-counts a fresh
# session and lets a long one reset by coincidence.

set -uo pipefail

# The session dir, resolved the way every other writer resolves it. Hardcoding
# `arsenal/` meant a relocated host tree kept its rate-limit and round-counter
# state somewhere the rest of the toolkit does not look.
_SESSION_DIR="${ARSENAL_SESSION_DIR:-${ARSENAL_HOME:-arsenal}/session}"
FILE="${ARSENAL_RATE_LIMITS_FILE:-${_SESSION_DIR}/rate_limits.json}"
STOP_PCT="${ARSENAL_QUOTA_STOP_PCT:-90}"
MAX_ITER="${ARSENAL_MAX_ITERATIONS:-50}"
ITER_FILE="${ARSENAL_ITER_STATE_FILE:-${_SESSION_DIR}/budget_iterations.json}"
SESSION_ID="${CLAUDE_CODE_REMOTE_SESSION_ID:-${CLAUDE_CODE_SESSION_ID:-${CLAUDE_SESSION_ID:-default}}}"

python3 - "${FILE}" "${STOP_PCT}" "${MAX_ITER}" "${ITER_FILE}" "${SESSION_ID}" <<'PY'
import sys, json, pathlib

file = pathlib.Path(sys.argv[1])
try:
    stop = float(sys.argv[2])
except ValueError:
    stop = 90.0
try:
    max_iter = int(sys.argv[3])
except ValueError:
    max_iter = 50
iter_file = pathlib.Path(sys.argv[4])
session_id = sys.argv[5]

# Always-available dispatch-round cap (independent of rate_limits.json). Counts
# one round per budget_check call, resetting when the session changes.
if max_iter > 0:
    try:
        state = json.loads(iter_file.read_text(encoding="utf-8"))
        if not isinstance(state, dict):
            state = {}
    except Exception:
        state = {}
    count = (state.get("count", 0) if state.get("session") == session_id else 0) + 1
    try:
        iter_file.parent.mkdir(parents=True, exist_ok=True)
        iter_file.write_text(
            json.dumps({"session": session_id, "count": count}), encoding="utf-8"
        )
    except Exception as exc:
        # Said out loud rather than swallowed. The count lives only in this
        # file, so a write that fails means every later call recomputes `count`
        # as 1 and the dispatch-round cap — documented as the backstop that does
        # NOT depend on observable state — silently stops capping anything. The
        # run is not failed over it (this is a backstop, not a gate), but an
        # operator who is relying on the cap has to be able to find out that it
        # is not running.
        print(
            f"budget_check: could not persist the round counter to {iter_file} ({exc}) — "
            "the per-session dispatch cap is NOT in effect for this run",
            file=sys.stderr,
        )
    if count > max_iter:
        print(
            f"budget_check: dispatch round {count} exceeds "
            f"ARSENAL_MAX_ITERATIONS={max_iter} — stopping (per-session cap)",
            file=sys.stderr,
        )
        sys.exit(3)

if not file.exists():
    print("budget_check: no rate_limits.json — failing open", file=sys.stderr)
    sys.exit(0)

try:
    data = json.loads(file.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("not a dict")
except Exception:
    print("budget_check: rate_limits.json unparseable or invalid — failing open", file=sys.stderr)
    sys.exit(0)

def _resets(d):
    # `resets_at` is this file's spelling; `resetsAt` is what `get_session`
    # returns, and an orchestrator copying that object verbatim is the whole
    # point of accepting the status shape.
    if not isinstance(d, dict):
        return None
    return d.get("resets_at") or d.get("resetsAt")


# A refusal, at either level. Top level too: `rate_limit_info` is a flat object
# naming its own window in `rateLimitType`, so a host that writes it through
# unchanged has no per-window key to nest it under.
_ABSENT = object()


def _status_of(d):
    """The `status` a document declares, or `_ABSENT` when it declares none.

    Keyed on the KEY being present, not on the value being a string. `null`,
    `false` and `0` are all present statuses that are not "allowed", and typing
    the check meant each of them fell through to the no-percentage fail-open —
    the one outcome the polarity below forbids. A malformed status is an
    unrecognised status.
    """
    return d.get("status", _ABSENT) if isinstance(d, dict) else _ABSENT


refused = []
allowed = []
for window in ("five_hour", "seven_day"):
    w = data.get(window) or {}
    st = _status_of(w)
    if st is _ABSENT:
        continue
    if st == "allowed":
        allowed.append(st)
    else:
        refused.append((window, st, _resets(w)))

st = _status_of(data)
if st is not _ABSENT:
    if st == "allowed":
        allowed.append(st)
    else:
        refused.append((data.get("rateLimitType") or "session", st, _resets(data)))

if refused:
    for window, status, resets in refused:
        shown = status if isinstance(status, str) else f"{status!r} (not a string)"
        msg = f"budget_check: {window} reports status={shown} — quota refused, not a threshold"
        if resets:
            msg += f" (resets_at={resets})"
        print(msg, file=sys.stderr)
    print(
        "budget_check: a refusal is a fact about the next call, so "
        "ARSENAL_QUOTA_STOP_PCT does not apply — stopping",
        file=sys.stderr,
    )
    sys.exit(3)

worst = None
over = []
for window in ("five_hour", "seven_day"):
    w = data.get(window) or {}
    # A window that is not an object at all — `{"five_hour": "nonsense"}` —
    # used to raise AttributeError here and escape as exit 1, which is the
    # loud "stop" code, from a document this script's own contract says it
    # should fail open on. Unreadable is unreadable, whatever its shape.
    if not isinstance(w, dict):
        continue
    v = w.get("used_percentage")
    if isinstance(v, (int, float)):
        worst = v if worst is None else max(worst, v)
        if v >= stop:
            over.append((window, v, _resets(w)))

if worst is None:
    if allowed:
        # A document that carried a status and said "allowed" is not missing
        # data — it answered, in the only vocabulary its surface has. Calling
        # that a fail-open would tell an operator the guard did not run on the
        # exact surface this shape was added to reach.
        print(f"budget_check: ok (status={allowed[0]!r}, no used_percentage on this surface)")
        sys.exit(0)
    print("budget_check: no used_percentage in rate_limits.json — failing open", file=sys.stderr)
    sys.exit(0)

if over:
    for window, v, resets in over:
        msg = f"budget_check: {window} at {v:.0f}% >= {stop:.0f}% stop threshold"
        if resets:
            msg += f" (resets_at={resets})"
        print(msg, file=sys.stderr)
    sys.exit(3)

print(f"budget_check: ok (worst window {worst:.0f}% < {stop:.0f}%)")
sys.exit(0)
PY
