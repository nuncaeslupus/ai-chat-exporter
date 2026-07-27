---
name: continue
description: When the user wants to resume work or run the worker loop — picks the next unblocked task, optionally scoped by tag(s) and/or a workspace, or matched by title text. Use /continue [TAG … | WORKSPACE | search-text]. Do NOT use before running init.
user-invocable: true
argument-hint: "[TAG … | WORKSPACE | search-text]"
---

# continue

Resumes session work by picking the next unblocked task from the queue and running the worker loop. Optionally scoped by tag(s) and/or a workspace, or matched against a fuzzy task title.

CANARY: continue-loaded-2026-06-13-fb78d23e-b2c3d4e5f6a7b8c9

## When to load

Load this skill when:

- The user types `/continue`, "continue", "resume", "run the workers", or "WORKSPACE: Continue".
- The session needs to pick up where a previous session left off.
- The user provides a workspace name or task search string after the command.

## How to use

```bash
# Pick globally best unblocked task
python3 .claude/skills/continue/scripts/query_task.py

# Bare-word tokens are order-independent and resolved by membership:
#   known workspace -> workspace filter (at most one)
#   known tag       -> tag filter (multiple tags are ANDed)
#   anything else   -> fuzzy title search
python3 .claude/skills/continue/scripts/query_task.py CLI FRONTEND   # tag CLI AND workspace FRONTEND
python3 .claude/skills/continue/scripts/query_task.py CLI WEB        # tag CLI AND tag WEB
python3 .claude/skills/continue/scripts/query_task.py FRONTEND       # workspace only

# Equivalent explicit flags (compose with tokens)
python3 .claude/skills/continue/scripts/query_task.py --workspace FRONTEND
python3 .claude/skills/continue/scripts/query_task.py --search "implement login"
```

`/continue CLI FRONTEND` and `/continue FRONTEND CLI` resolve to the same scope. A task qualifies only if it carries **every** requested tag and matches the workspace when one is given. The scope is plumbed to the loop as `LOOP_TAGS` (comma-separated) and `LOOP_WORKSPACE`, which `queue_eval.sh` / `queue_batch.sh` apply on top of the surface-capability filter.

**Before claiming anything, enter the coordination branch** — run
`queue_branch.sh` (in `claude-arsenal/bin/`). It is idempotent (safe to run every
session) and puts the session on the shared `arsenal-queue` ref so claims actually
coordinate across sessions. **If it exits non-zero (e.g. a dirty working tree),
or warns that it could not publish/track the shared ref (no remote, or a
push rejected — the web-proxy case), stop and surface to the user instead of
claiming.** A claim made before the shared ref is reached cannot coordinate.
Skip it or ignore a failure, and `claim.sh` runs on the wrong branch: it
either exits `error` (the off-branch guard) or — on an older bundle without the
guard — pushes the claim to a private branch where it can never race anyone, so
every session "wins" the same task and duplicates work. Run it first.

Then proceed with the **Worker loop algorithm** from `claude-arsenal/AGENTS.md`:
1. Read workspace context: `claude-arsenal/project/<workspace>/context.md` and `handover.md`.
2. Claim the task using the bundle claim script (see `claude-arsenal/AGENTS.md` § Worker loop algorithm). **Obey the result verbatim:** `won` → proceed; `lost` → another session owns it, drop it and pick the next; `error` (exit 2) → misconfiguration (off the coordination branch, protected ref, or no upstream) — **stop and surface to the user**. Never "recover" a `lost` or `error` by creating an upstream, pushing `-u`, or re-claiming on another ref: that bypasses the lock and causes the exact double-claims this protocol exists to prevent.
3. Spawn worker subagent.
4. Release on completion using the bundle release script.
5. Loop back to step 1.

## Gotchas

- **`WORKSPACE: Continue`** as natural language (e.g. "FRONTEND: Continue") is equivalent to `/continue FRONTEND` — scope to that workspace.
- **Tags are a free-form label axis**, orthogonal to workspace and to the surface-capability `requires` filter. Attach them with `/queue-add --tag CLI --tag WEB` (repeatable).
- **A name that is both a workspace and a tag** resolves as the workspace first. Two distinct workspaces in one invocation is an error; an unknown token mixed with scope tokens is an error (use scope tokens, or search text alone).
- **Blocked workspace**: if `LOOP_WORKSPACE=X queue_eval.sh` returns empty but global queue has tasks, report what's blocking and offer to fall back to global queue.
- **No open tasks**: if the queue is empty but workspace plans exist, seed from plans first (see AGENTS.md "Queue seeding").
- **Escalated tasks are skipped by the loop.** A task transitions to `escalated` when it exhausts `max_attempts` consecutive gate failures. The loop never dispatches it again. To recover: run `release.sh <id> open --reset-attempts` from `claude-arsenal/bin/` (resets `attempts` to 0 and status to `open`), then `/continue`. Review the `## Failure notes` in the task payload before re-dispatching — they record what each prior attempt tried and why it failed. `queue-status --detail` shows `attempts=N/max_attempts=M` for escalated tasks.
