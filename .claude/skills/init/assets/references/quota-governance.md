# Quota governance — the token-budget stop

Read this when the loop stopped before dispatch, or when tuning how much a
session is allowed to spend.

---

## Quota governance — token-budget stop

`statusline_capture.sh` (registered by `/init` as the host `statusLine` command)
writes `arsenal/session/rate_limits.json` (gitignored) from the
`rate_limits` block Claude Code feeds a statusLine on stdin — the only channel
that data arrives on. Before every dispatch, the loop runs `budget_check.sh`:

- Either window (`five_hour` / `seven_day`) at/above `ARSENAL_QUOTA_STOP_PCT`
  (default 90) → exit `3`: stop, write `handover.md`, report the reset time.
- File missing / fields absent (non-Pro/Max plan, before the first response,
  older Claude Code) → exit `0`, **fail-open**: the loop runs where quota is not
  observable.

`rate_limits` is a snapshot at the last message and is **Pro/Max only**; on
API/metered usage the quota check always fails open. So `budget_check.sh` also
enforces an **always-available** per-session dispatch-round cap
(`ARSENAL_MAX_ITERATIONS`, default 50; `0` disables) that does not depend on
observable quota — the real ceiling for an auto-dispatching loop on metered
billing. The counter resets per session — `CLAUDE_CODE_REMOTE_SESSION_ID`, falling
back to `CLAUDE_CODE_SESSION_ID`, the same pair `references/claiming-internals.md`
names; `CLAUDE_SESSION_ID` is set on no current surface — and lives in the gitignored
`arsenal/session/budget_iterations.json`.

### On a cloud session the guard cannot see quota at all

`statusline_capture.sh` is a **statusLine** command, and a statusLine is a
terminal affordance. A session running in the cloud — Claude Code on the web,
the desktop and mobile apps, a routine — never runs one, so
`rate_limits.json` is never written and `budget_check.sh` fails open on every
round. That is the surface most likely to be running an unattended fleet, and
it is the surface where the quota half of the guard does nothing. On it,
`ARSENAL_MAX_ITERATIONS` is not a backstop; it is the entire ceiling.

**`ARSENAL_RATE_LIMITS_FILE` is the seam.** It overrides the path
`budget_check.sh` reads, so an orchestrator that can observe quota by some
other means can write that file itself and the percentage guard starts working:

```bash
# whatever your surface can tell you about quota, in the shape below
ARSENAL_RATE_LIMITS_FILE=/tmp/quota.json bash claude-arsenal/bin/budget_check.sh
```

The shape is not negotiable — `used_percentage` under `five_hour` and/or
`seven_day`, the same block a statusLine receives:

```json
{"five_hour": {"used_percentage": 95, "resets_at": "2026-09-04T12:00:00Z"}}
```

Anything else is "fields absent" and fails open **silently**, which is the trap:
a document that plainly describes exhaustion in some other vocabulary still
buys nothing. A `get_session` response carrying `{"status": "allowed",
"rateLimitType": "five_hour"}` does not satisfy this check — translate it to
the shape above, or the guard stays inert while looking configured.

And translate honestly: `status` reports whether the API is refusing *right
now*, which is a wall already hit. `ARSENAL_QUOTA_STOP_PCT` exists to stop
before that. A hard stop on a refusal is a reasonable thing to want, but it is
a different signal and must not be mapped onto the percentage threshold — doing
so makes the threshold silently inert whenever the other document is present.

---
