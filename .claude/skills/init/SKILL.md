---
name: init
description: When the user needs claude-arsenal/ set up in a host repo, or wants to register a workspace via --workspace. Re-running is safe (refreshes stale bundle files only). Do NOT use to add tasks (see queue-add) or resume the worker loop (see continue).
user-invocable: true
argument-hint: "[--repo-path PATH] [--workspace NAME] [--root PATH] [--spec PATH] [--plan PATH]"
---

# init

Bootstraps the `claude-arsenal/` framework in the host repository. After init, every
session automatically seeds the queue from workspace plans (if present) and starts
workers — no commands needed. Run once per repo to initialize; re-run to add workspaces
or refresh the bundle scripts.

CANARY: init-loaded-2026-06-13-fb78d23e-a1b2c3d4e5f6a7b8

## When to load

Load this skill when:

- A repo needs the task queue set up for the first time.
- The user asks to "init the arsenal", "set up the task queue", "install the orchestrator", or "/init".
- Adding a new workspace to an existing `claude-arsenal/` setup.

## How to use

**First-time init:**
```bash
python3 .claude/skills/init/scripts/init.py --repo-path .
```

**Auto-refresh (session start — silent):**
```bash
python3 .claude/skills/init/scripts/init.py --repo-path . --silent
```
Refreshes stale bundle scripts without the "up to date" noise. Prints an upgrade
banner when the installed bundle version is behind the plugin source, and reports
any files it refreshed. The session-start protocol runs this automatically.

**Register a workspace:**
```bash
python3 .claude/skills/init/scripts/init.py --workspace FRONTEND
python3 .claude/skills/init/scripts/init.py --workspace BACKEND --root ./backend/
```

The script:
1. Creates `claude-arsenal/` structure: `bin/`, `project/`, `queue/`, `session/`, `agents/`.
2. Copies bundle scripts from the plugin into `claude-arsenal/bin/` (checksum-based; refreshes stale files only).
3. Creates empty `claude-arsenal/queue/tasks.jsonl` and `claude-arsenal/session/handover.md`.
4. Writes a permissive `surface_profile.json` (gitignored) so all tasks are eligible on any surface.
5. Adds `.gitignore` entries for `surface_profile.json` and the statusLine-written `rate_limits.json`.
6. Registers `statusline_capture.sh` as the host `statusLine` command (skipped if one already exists) so `budget_check.sh` can read quota.
7. Injects the session-start protocol block + `@claude-arsenal/AGENTS.md` import into `CLAUDE.md`.

With `--workspace NAME`, additionally:
- Creates `claude-arsenal/project/<NAME>/` with `spec.md`, `plan.md`, `context.md`, `handover.md` stubs.
- Upserts `claude-arsenal/project/overview.md` workspace index.

## Gotchas

- **Bundle scripts are authoritative.** Re-running `init` refreshes any `claude-arsenal/bin/` file whose checksum differs from the plugin bundle. Project data (`project/`, `queue/`, `session/handover.md`) is never touched on re-run.
- **CC Web without hooks**: `detect_surface.sh` won't auto-run on web, but init writes a permissive `surface_profile.json` so all tasks remain eligible.
- **CLAUDE.md block must be at root.** The injected block appears in the host root `CLAUDE.md`, not a nested file.
- **Auto-refresh on session start.** The session-start protocol (AGENTS.md step 0) runs `init.py --silent` automatically. When the plugin is updated to a new version, the next session start detects the version mismatch, refreshes the stale scripts, and reports what changed. No manual `/init` is required for bundle-script updates — only for new workspace registration or major changes to `CLAUDE.md`.
