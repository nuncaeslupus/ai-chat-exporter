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

Two shapes are accepted, and they are **two different signals**. Write whichever
one your surface can actually supply; a document may carry both.

**A forecast — `used_percentage`** under `five_hour` and/or `seven_day`, the
same block a statusLine receives:

```json
{"five_hour": {"used_percentage": 95, "resets_at": "2026-09-04T12:00:00Z"}}
```

This is compared against `ARSENAL_QUOTA_STOP_PCT` (default 90). Its whole job is
to stop *before* the wall.

**A refusal — `status`**, the vocabulary `get_session` returns on a cloud
session. Either nested under a window, or flat, exactly as that call gives it:

```json
{"status": "rejected", "rateLimitType": "five_hour", "resetsAt": 1787709000}
```

Any `status` other than `"allowed"` stops the loop (exit 3). `"allowed"` passes,
and is reported as a pass rather than as missing data — so a document carrying
only this shape guards properly on a surface that has no percentage to give.

### Why the refusal is not a percentage

`ARSENAL_QUOTA_STOP_PCT` **does not apply** to the refusal check, and cannot
disable it. That is deliberate. A percentage is a forecast about the next call;
88% means it will probably work, and the threshold is a judgement about how much
headroom a fleet keeps. `status: "rejected"` is a fact already established — the
next call fails now, whatever any percentage says.

So do not translate a refusal into a synthesised `"used_percentage": 100`. If
you do, `ARSENAL_QUOTA_STOP_PCT=101` silently turns off a guard that is
reporting a wall already hit.

A `status` value this script does not recognise stops the loop rather than
passing it, and that includes a malformed one — `null`, `false`, a number. The
check is keyed on the **key being present**, not on the value being well-formed:
the field is only ever written by a host that chose to write it, so anything
other than `"allowed"` is a misconfiguration worth halting loudly over, not a
reason to keep dispatching. An **absent** `status` is a different thing entirely
and changes nothing.

Anything carrying **neither** signal is "fields absent" and fails open
**silently**: `{"five_hour": {}}`, or a `used_percentage` sent as a string. That
is still the trap to watch for — a document that describes exhaustion in a third
vocabulary buys nothing and says nothing about it.

---
