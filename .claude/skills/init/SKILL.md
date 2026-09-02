---
name: init
description: When the user needs claude-arsenal/ set up in a host repo, or wants to register a workspace via --workspace. Re-running is safe (refreshes stale bundle files only). Do NOT use to add tasks (see queue-add) or resume the worker loop (see continue).
user-invocable: true
argument-hint: "[--repo-path PATH] [--profile NAME] [--sections A,B] [--workspace NAME] [--root PATH] [--spec PATH] [--plan PATH]"
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

**First-time init — ask before installing.**

Every installed skill costs a row in the resident skills listing of every
session in this repo from now on, whether or not it ever triggers. So a first
install asks one question before running anything:

> What kind of project is this? **python** (adds the Python toolchain skills),
> **general** (spec/design/execute/review/ship), or **minimal** (queue and
> GitHub only)?

Pass the answer as the profile:

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/init.py" --repo-path . --profile general
```

Ask only when `arsenal/config.toml` has no `[skills]` table. With one, the repo
has already answered, and re-asking every session is noise. Never infer the
answer from the file tree: a repo containing `.py` files is not necessarily one
whose release process this bundle should be advising on.

The chosen profile is written out as an editable `[skills]` table, so the answer
is a starting point rather than a one-time decision. `--sections workflow,python`
names sections directly instead, for a user who would rather skip the profiles.

**The capability map (read-only):**
```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/init.py" --repo-path . --list-sections
python3 "${CLAUDE_SKILL_DIR}/scripts/init.py" --repo-path . --section python
```
`--list-sections` names every section this bundle ships and whether it is
installed here — including the skills of the ones that are not, which appear
nowhere else in a repo that skipped them. `--section NAME` adds their full
descriptions. The session-start protocol runs the first on every session, so a
task that a skipped section would handle properly gets said out loud instead of
being done the long way. Neither flag writes anything.

**Auto-refresh (session start — silent):**
```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/init.py" --repo-path . --silent
```
Refreshes stale bundle scripts without the "up to date" noise. Prints an upgrade
banner when the installed bundle version is behind the plugin source, and reports
any files it refreshed. The session-start protocol runs this automatically.

**Register a workspace:**
```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/init.py" --workspace FRONTEND
python3 "${CLAUDE_SKILL_DIR}/scripts/init.py" --workspace BACKEND --root ./backend/
```

The script:
1. Creates the `claude-arsenal/` bundle structure: `bin/`, `scripts/`, `agents/`, `references/`. The host-owned `project/`, `queue/` and `session/` state does **not** live here — it is scaffolded under `arsenal/` by item 3.
2. Copies bundle scripts from the plugin into `claude-arsenal/bin/` (checksum-based; refreshes stale files only).
3. Scaffolds the host-owned `arsenal/` tree — `tasks/`, `specs/`, `plans/`, `session/handover.md` — and seeds `arsenal/config.toml`. Upstream owns `claude-arsenal/` and may overwrite it on every re-run; it never writes into `arsenal/` again, so an upgrade cannot touch the host repo's tasks or settings.
4. Vendors the skills for the chosen sections into `.claude/skills/` — `core` always, plus `workflow` and/or `python`. Flipping a section to `false` in `arsenal/config.toml` prunes its skills on the next run and keeps them pruned; an upgrade of a repo that predates sections keeps whatever it already had.
5. Writes a permissive `surface_profile.json` (gitignored) so all tasks are eligible on any surface.
6. Adds `.gitignore` entries for `surface_profile.json` and the statusLine-written `rate_limits.json`.
7. Registers `statusline_capture.sh` as the host `statusLine` command (skipped if one already exists) so `budget_check.sh` can read quota.
8. Injects the session-start protocol block + `@claude-arsenal/AGENTS.md` import into `CLAUDE.md`.
9. Registers the skill-edit **gate hooks** in `.claude/settings.json` (`check_skill_workshop_loaded.sh` and its two marker hooks) — a plugin ships these as plugin hooks, but plugin hooks do not travel with a clone, and settings hooks do. It no longer writes a marketplace **declaration**: the web runtime never fetches a git marketplace, so the skills are **vendored** into `.claude/skills/` (item 4) where every surface reads them from the clone itself.

**Retiring vendored skill copies:**
```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/init.py" --repo-path . --migrate-plugins yes
```
A repo set up before plugins reached cloud sessions has copies of these skills under `.claude/skills/`, each carrying a `.arsenal-vendored` marker. Once the plugin is declared, both sets are live at once: the plugin's are namespaced (`core:specify`), the vendored ones are not (`specify`), so every skill answers twice and costs listing budget twice.

Init never removes them on its own. When it finds them it prints what it found and stops — **ask the user** whether to remove the vendored copies, then re-run with `--migrate-plugins yes` (or `no` to keep them and stop being asked). The choice is recorded as `plugin-migration` in `arsenal/config.toml`. Only folders carrying the marker are ever removed; a skill the consumer authored is never touched.

With `--workspace NAME`, additionally:
- Creates `arsenal/project/<NAME>/` with `spec.md`, `plan.md`, `context.md`, `handover.md` stubs.
- Upserts `arsenal/project/overview.md` workspace index.

## Gotchas

- **Bundle scripts are authoritative.** Re-running `init` refreshes any `claude-arsenal/bin/` file whose checksum differs from the plugin bundle. Project data (`project/`, `queue/`, `session/handover.md`) is never touched on re-run.
- **Cloud sessions need the commit, not an install.** A cloud session (web, desktop and mobile apps, Claude Tag, routines) runs on a fresh clone and never sees `~/.claude/`, so a plugin installed with `/plugin install` does not reach it — that install state is user-scoped. What reaches it is what the clone carries: the vendored skills under `.claude/skills/` and the hooks in `.claude/settings.json`. Both are plain files in the commit, so they need no marketplace fetch and no network at session start.
- **Shared project settings outrank user settings.** `.claude/settings.json` in the repo wins over the user's own `~/.claude/settings.json`, so a host's hooks are what run even where a developer has their own configured.
- **CC Web without hooks**: `detect_surface.sh` won't auto-run on web, but init writes a permissive `surface_profile.json` so all tasks remain eligible.
- **CLAUDE.md block must be at root.** The injected block appears in the host root `CLAUDE.md`, not a nested file.
- **Auto-refresh on session start.** The session-start protocol (AGENTS.md step 0) runs `init.py --silent` automatically. When the plugin is updated to a new version, the next session start detects the version mismatch, refreshes the stale scripts, and reports what changed. No manual `/init` is required for bundle-script updates — only for new workspace registration or major changes to `CLAUDE.md`. A refresh only ever moves **forward**: when the host's committed bundle is newer than this skill's vendored copies, init writes nothing and says so, because the checksum comparison cannot tell a stale file from an upstream fix that has not reached the plugin yet. Update the plugin instead; `--allow-downgrade` overwrites the newer install and is for recovering a broken one.
