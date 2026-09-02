# Auto-fire setup — a detached weekly run

## Contents

- [The hook](#the-hook)
- [Why SessionStart](#why-sessionstart)
- [Why each guard is there](#why-each-guard-is-there)
- [Alternative: fire at session close](#alternative-fire-at-session-close)
- [Skip override](#skip-override)
- [What was measured](#what-was-measured)
- [Disabling](#disabling)

Load when wiring session-end to run without an explicit `/session-end`, or when
an installed auto-fire is not firing.

By default session-end is manual. The setup below runs it about once a week,
out of band, without the user ever invoking it.

## The hook

Add to `~/.claude/settings.json` via the update-config skill:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "[ -n \"${CLAUDE_SESSION_END_AUTOFIRE:-}\" ] && exit 0; S=\"$CLAUDE_PROJECT_DIR/tmp/.skip-next-session-end\"; [ -f \"$S\" ] && { rm -f \"$S\"; exit 0; }; L=\"$CLAUDE_PROJECT_DIR/tmp/.session-end-last\"; find \"$L\" -mtime -7 2>/dev/null | grep -q . && exit 0; mkdir -p \"$CLAUDE_PROJECT_DIR/tmp\" && touch \"$L\"; setsid env CLAUDE_SESSION_END_AUTOFIRE=1 claude --print '/session-end' </dev/null >/dev/null 2>&1 &"
          }
        ]
      }
    ]
  }
}
```

In order: exit if already inside an auto-fired session; consume the one-shot
skip sentinel if present; exit if a run happened in the last seven days; stamp
the run; launch a detached session that invokes the skill.

Confirm it works by starting a session in a project and checking that
`tmp/.session-end-last` appeared. Nothing else is visible from the session that
triggered it — the spawned run writes its proposals and exits on its own.

Hooks run under `/bin/sh`, so keep any edit POSIX. No `[[`, no arrays.

## Why SessionStart

Firing at session *close* is the obvious reading, and it loses exactly the
sessions worth scanning. `SessionEnd` does not fire when a session is killed —
a closed terminal, a crash, a machine that slept. Measured both ways: a
`SIGKILL`ed session fired nothing, the same hook on a clean exit fired.

`SessionStart` cannot be missed, because working means starting a session. It
retrospects the *previous* session rather than the one just beginning, which
costs nothing — step 2 scans a rolling multi-day window, not one conversation.

The obvious objection to a start-of-session trigger is that it hijacks the
attention of whatever the user sat down to do. That is true of a hook that
returns context, and false here: this one prints nothing and detaches, so the
starting session sees no added tokens and no added latency. Verified — a
session started under this hook answered its prompt with nothing else attached.

## Why each guard is there

**Detached with `setsid … &`.** A hook that spawns a session and waits is
killed: the harness caps hook duration and reports `Hook cancelled` while the
spawn is still running. Detaching returns immediately and lets the child
outlive the session that started it. Never call `claude` in the foreground
here.

**The recursion guard.** The spawned session fires the same hook when it
starts, so without the guard each run launches another. The env sentinel
reaches the child's hook environment, which is what makes the first clause
work. Replace it with a marker file if a harness ever sanitizes that
environment.

**The weekly stamp.** The retrospective scans a rolling window, so firing it
every session re-reads the same transcripts and re-proposes the same findings,
at the cost of a full model session each time. Seven days matches the `--days
7` default in step 2. `SessionStart` also fires on resume and clear, which this
absorbs. Drop the `find`/`touch` pair for every-session behaviour, and expect
duplicates.

## Alternative: fire at session close

Swap `SessionStart` for `SessionEnd` in the snippet — every guard stays as is.
Choose it when a run should reflect the session that just happened, and accept
that abruptly-killed sessions never trigger one.

## Skip override

Suppress the next auto-fire only:

```bash
touch tmp/.skip-next-session-end
```

One-shot, deleted on the first hook invocation after it appears. It does not
stamp a run, so the next session still fires — skipping does not cost the week.
Manual invocations ignore it.

To force a run before the week is up: `rm tmp/.session-end-last`.

## What was measured

On Claude Code 2.1.241, with a temporary `--settings` file:

| Question | Result |
|---|---|
| Does a killed session fire `SessionEnd`? | No — a clean exit does |
| Does a detached `SessionStart` spawn add anything to the session? | No |
| Does a spawned sub-session re-fire the hook? | Yes — the guard is load-bearing |
| Does the env sentinel reach the child's hook? | Yes |
| Does a foreground spawn survive? | No — `Hook cancelled` |
| Does `setsid … &` survive teardown? | Yes |
| Does `CLAUDE_PROJECT_DIR` resolve in the hook? | Yes, from the session's project |
| Which shell runs hooks? | `/bin/sh` |

Re-run these before trusting the snippet on a different harness or a much later
build.

## Disabling

Remove the entry from `~/.claude/settings.json`. Manual `/session-end` is
unaffected.
