---
name: arsenal-init
description: Runs the claude-arsenal installer (the init skill) under a name that does not collide with Claude Code's built-in /init. Use when the user types /arsenal-init. Not for writing a CLAUDE.md.
disable-model-invocation: true
user-invocable: true
argument-hint: "[same arguments as the init skill]"
metadata:
  type: workflow
---

# arsenal-init

`/init` is also Claude Code's built-in command for writing a `CLAUDE.md`, so typing
it can run that instead of this bundle's installer. This command is the same
installer under a name nothing else uses. It is hidden from the model's skill
listing, so it costs a session nothing until someone types it.

CANARY: arsenal-init-loaded-2026-11-18-21118b51-0f5cae86ee954b0d

## Steps

1. Load the `init` skill with the Skill tool: `core:init` when the plugin is
   installed, otherwise the `init` vendored in `.claude/skills/`. Pick the one
   that installs `claude-arsenal/`, never the built-in that writes a `CLAUDE.md`.
2. Follow it with these arguments: `$ARGUMENTS`.
