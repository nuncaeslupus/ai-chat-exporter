#!/usr/bin/env bash
# statusline_capture.sh — host statusLine command (registered by /init).
#
# Claude Code feeds a statusLine command a JSON object on stdin that, on Pro/Max
# subscriptions, carries a `rate_limits` block (five_hour / seven_day, each with
# used_percentage 0-100 and resets_at). That data is delivered ONLY here — no
# env var, CLI flag, or file exposes it otherwise. This script extracts it,
# writes claude-arsenal/session/rate_limits.json (gitignored) ATOMICALLY so a
# concurrent budget_check.sh read never sees a partial file, and prints a short
# status line on stdout.
#
# Missing rate_limits (non-Pro/Max, pre-first-response, older Claude Code) → no
# file is written/overwritten; budget_check.sh then fails open.
# Exit: 0 always (a statusLine command must never break the prompt).

set -uo pipefail

OUT="${ARSENAL_RATE_LIMITS_FILE:-claude-arsenal/session/rate_limits.json}"
payload="$(cat || true)"

ARSENAL_SL_PAYLOAD="${payload}" python3 - "${OUT}" <<'PY'
import os, sys, json, pathlib, tempfile

out = pathlib.Path(sys.argv[1])
try:
    data = json.loads(os.environ.get("ARSENAL_SL_PAYLOAD", "") or "{}")
except Exception:
    data = {}
if not isinstance(data, dict):
    data = {}

rl = data.get("rate_limits")
if not isinstance(rl, dict):
    rl = {}


def _pct(window):
    w = rl.get(window) or {}
    v = w.get("used_percentage")
    return v if isinstance(v, (int, float)) else None


# Persist only when rate_limits is actually present — never blow away a good
# snapshot with an empty one on a refresh that lacks the block.
if isinstance(rl, dict) and rl:
    snapshot = {
        "five_hour": rl.get("five_hour", {}),
        "seven_day": rl.get("seven_day", {}),
    }
    tmp_name = None
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w", dir=str(out.parent), delete=False, encoding="utf-8"
        ) as tmp:
            tmp_name = tmp.name
            json.dump(snapshot, tmp)
            tmp.flush()
            os.fsync(tmp.fileno())
        os.replace(tmp_name, out)
    except Exception:
        if tmp_name:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass

# Short status line: model + the two windows when known.
five, seven = _pct("five_hour"), _pct("seven_day")
parts = []
model = (data.get("model") or {}).get("display_name")
if model:
    parts.append(str(model))
if five is not None:
    parts.append(f"5h {five:.0f}%")
if seven is not None:
    parts.append(f"7d {seven:.0f}%")
print(" | ".join(parts) if parts else "claude-arsenal")
PY

exit 0
