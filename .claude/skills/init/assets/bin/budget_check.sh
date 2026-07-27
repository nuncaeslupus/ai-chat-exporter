#!/usr/bin/env bash
# budget_check.sh — pre-dispatch quota guard for the worker loop.
#
# Reads claude-arsenal/session/rate_limits.json (written by statusline_capture.sh)
# and decides whether the loop may dispatch more workers.
#
# Exit:
#   3 — either window's used_percentage is at/above ARSENAL_QUOTA_STOP_PCT
#       (default 90), OR this session has dispatched ARSENAL_MAX_ITERATIONS
#       rounds (default 50). Loud and distinct so the loop STOPS and writes a
#       handover.
#   0 — under threshold, OR data is missing/unparseable/absent fields. The
#       missing-data case is a deliberate FAIL-OPEN for the QUOTA check only:
#       the loop keeps running where quota is not observable (API/metered usage,
#       non-Pro/Max plan, before the first response, or older Claude Code).
#
# rate_limits.json is Pro/Max-only, so on API/metered billing the quota guard
# always fails open. The per-session dispatch-round cap is the ALWAYS-AVAILABLE
# backstop: it does not depend on observable quota, so an auto-dispatching loop
# can never run unbounded. Set ARSENAL_MAX_ITERATIONS=0 to disable it (quota-only
# behaviour). The counter resets per CLAUDE_SESSION_ID.

set -uo pipefail

FILE="${ARSENAL_RATE_LIMITS_FILE:-claude-arsenal/session/rate_limits.json}"
STOP_PCT="${ARSENAL_QUOTA_STOP_PCT:-90}"
MAX_ITER="${ARSENAL_MAX_ITERATIONS:-50}"
ITER_FILE="${ARSENAL_ITER_STATE_FILE:-claude-arsenal/session/budget_iterations.json}"
SESSION_ID="${CLAUDE_SESSION_ID:-default}"

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
    except Exception:
        pass
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

worst = None
over = []
for window in ("five_hour", "seven_day"):
    w = data.get(window) or {}
    v = w.get("used_percentage")
    if isinstance(v, (int, float)):
        worst = v if worst is None else max(worst, v)
        if v >= stop:
            over.append((window, v, w.get("resets_at")))

if worst is None:
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
