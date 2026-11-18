# Quota governance — the token-budget stop

Read this when the loop stopped before dispatch, when tuning how much a session
is allowed to spend, or when a window went and nobody knows where.

---

## Where the window went — `scripts/usage_report.py`

Everything below is *forward-looking*: may this session dispatch again? It reads
a percentage remaining and can say nothing about what consumed the rest. The
backward question has its own script:

```bash
python3 claude-arsenal/scripts/usage_report.py --since 2026-09-14
```

Per session and **per model**: turns, average and peak context, output, cache
read, and the busiest hour. Reads the transcripts Claude Code already writes
(`~/.claude/projects/`), so it needs no setup and works after the fact.

Two things it is built to show, because both hid a real problem:

- **Cost is `turns x context`, not output.** A fleet that read 438M tokens to
  write 1.3M is not fixed by shorter answers. The lever is `context-window` in
  `arsenal/config.toml` (written by `/init` into `.claude/settings.json` as
  `autoCompactWindow`) — raising it to "avoid filling up" raises the floor every
  turn pays. Set it too low, though, and sessions compact mid-task and re-read
  what they dropped, paying in turns instead. Measure, then move it.
- **Dispatched turns are listed separately**, and they are the only direct
  evidence of what model your workers actually ran as. `models.workers` says what
  *should* have been used; this says what was. That gap once cost two exhausted
  five-hour windows with nothing misconfigured anywhere a person could see.

---

## Quota governance — token-budget stop

`statusline_capture.sh` (registered by `/init` as the host `statusLine` command)
writes `arsenal/session/rate_limits.json` (gitignored) from the
`rate_limits` block Claude Code feeds a statusLine on stdin — the only channel
that data arrives on. Before every dispatch, the loop runs `budget_check.sh`:

- Either window (`five_hour` / `seven_day`) at/above `ARSENAL_QUOTA_STOP_PCT`
  (default 90) → exit `3`: stop, write `handover.md`, report the reset time.
- File missing / fields absent (non-Pro/Max plan, before the first response,
  Claude Code older than v2.1.172, which has no `statusLine.rate_limits`) →
  exit `0`, **fail-open**: the loop runs where quota is not observable.

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

### What the guard above still cannot see — other sessions

Every check above is **per session**: this session's `rate_limits.json`, this
session's round counter. Nine independent orchestrators each saw a compliant
budget and shared one five-hour window between them, because nothing compared
notes. There is no API a script can poll for "how many sessions are live", so
`budget_check.sh` does the next-best thing: it lists `~/.claude/projects/<project
dir>/<session id>.jsonl` transcripts (one file per top-level session, written
continuously while that session runs) modified in the last
`ARSENAL_CONCURRENCY_WINDOW_MIN` minutes (default 15; `0` disables) that belong
to a session id other than its own, and — only when it finds at least one —
prints how many on stderr:

```
budget_check: 3 other session(s) touched a transcript in the last 15m — this account's quota window is shared across all of them
```

This is a **report, not a gate** — it never changes the exit code, because
recent activity is not the same fact as "still running" and turning it into a
stop would be inventing a threshold nobody asked for. It is also **CLI-only in
practice**: on a cloud session each container has its own filesystem, so there
are never any sibling transcripts to find, and the check stays silent — the
same silence as a healthy single-session run. Treat its silence on a cloud
surface as "not observable", the same reading `budget_check.sh`'s own header
gives a missing `rate_limits.json` — not as "confirmed alone".

---
