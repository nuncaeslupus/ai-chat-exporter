# Auto-fire setup — Stop hook + skip override

By default, session-end is a manual / on-request skill. To make it fire automatically at conversation close, install a Stop hook. To suppress it for the next conversation only, drop a sentinel file.

## Stop hook installation

Use the update-config skill to add a Stop hook to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "if [ -n \"${CLAUDE_SESSION_END_AUTOFIRE:-}\" ]; then exit 0; fi; test -f \"${CLAUDE_PROJECT_DIR}/tmp/.skip-next-session-end\" && rm -f \"${CLAUDE_PROJECT_DIR}/tmp/.skip-next-session-end\" || CLAUDE_SESSION_END_AUTOFIRE=1 /usr/bin/env claude --print '/session-end'"
          }
        ]
      }
    ]
  }
}
```

What this does:

1. **Recursion guard:** if `CLAUDE_SESSION_END_AUTOFIRE` is already set, exit 0
   immediately. The spawned sub-session (step 4) inherits this variable, so when
   *its own* Stop hook fires at close it short-circuits here instead of spawning
   yet another session. Without this guard the hook recurses indefinitely — each
   auto-fired session ends, re-triggers the Stop hook, and launches another.
2. Check for the skip sentinel `${CLAUDE_PROJECT_DIR}/tmp/.skip-next-session-end`.
3. If present: delete it and exit 0 — session-end is skipped this once.
4. Otherwise: launch a non-interactive Claude session (with
   `CLAUDE_SESSION_END_AUTOFIRE=1` in its environment) that invokes
   `/session-end` against the same project directory.

The non-interactive invocation runs the skill in a fresh sub-session; it does not pollute the just-ended conversation. The retrospective + handoff write happen in the sub-session and commit (if handoff mode is on) before exiting.

## Skip override — `tmp/.skip-next-session-end`

Drop this file to suppress the next auto-fire:

```bash
touch tmp/.skip-next-session-end
```

The sentinel is one-shot: it's deleted on the first hook invocation, whether or not session-end ran. Useful when:

- You're closing the terminal mid-investigation, not at a clean stopping point.
- You already ran `/session-end` manually and don't want it to fire again on Stop.
- The session was an experiment you don't want to retrospectively scan.

The skip file lives under `tmp/` (gitignored). It is NOT honored when session-end is invoked manually — only when the Stop hook would have fired it.

## Sanity checks before enabling auto-fire

- Confirm `claude --print '/session-end'` works in your environment from outside an active session. Some shells lose env vars between the Stop event and the spawned subprocess.
- Confirm the github skill is also installed (or you have `handoff=no` / `handoff=ticket` set), otherwise session-end may try to write `status/handoff.md` in a repo that doesn't expect it.
- Confirm `${CLAUDE_PROJECT_DIR}` resolves correctly inside the hook — some hook versions only expose `${CLAUDE_TRANSCRIPT_PATH}` or similar; consult the harness's Stop-hook env-var contract.
- The recursion guard relies on `CLAUDE_SESSION_END_AUTOFIRE` propagating from the spawned `claude` process into its own Stop-hook subprocess. If your harness sanitizes the hook environment, swap the env sentinel for a marker file instead — e.g. guard on `test -f "${CLAUDE_PROJECT_DIR}/tmp/.session-end-autofiring"`, `touch` it before the spawn, and `rm -f` it when the sub-session exits.

## Disabling auto-fire

Remove the Stop hook entry from `~/.claude/settings.json` (via update-config or by hand). The skill itself is unaffected — manual `/session-end` keeps working.
