---
name: queue-next
description: Claims the next unblocked queue task and runs the worker loop, optionally scoped by tag, workspace or title. Use when the user wants to resume work. Not for adding tasks.
user-invocable: true
argument-hint: "[CAPABILITY | TAG … | WORKSPACE | search-text]"
metadata:
  type: workflow
---

# queue-next

Picks the next unblocked task from the repository's task graph, claims it so no
other agent takes it, and runs the worker loop — optionally scoped by tags, a
workspace, a capability or a fuzzy title.

CANARY: queue-next-loaded-2026-06-13-fb78d23e-b2c3d4e5f6a7b8c9

## When to load

- The user types `/queue-next`, "continue", "resume", "run the workers", or
  `WORKSPACE: Continue` (equivalent to `/queue-next WORKSPACE`).
- A session needs to pick up where a previous one left off.

## The loop

**1. Fetch the task issues** as `claude-arsenal/AGENTS.md` session-start steps 1–2 say
(no `body`). Add `state_reason` where the surface returns it: without it, a closed issue
reads as done unless it carries `arsenal:cancelled`.

**2. Ask for the next task.** One call, one line of output:

```bash
task_select.py --tasks-dir arsenal/tasks --issues /tmp/issues.json \
               --capability surface:cli --workspace FRONTEND --tag DOCS
```

`task_select.py` (in `claude-arsenal/scripts/`) applies deps, priority,
capabilities and scope. It reads `arsenal/session/surface_profile.json` itself;
add `--capability access:browser` when a browser appears in this session's own
tools — the probe sees the machine, not the session's connectors. `gate: false` in its output means the task has no runnable
gate; fix the task file before working it, since a prose gate checks nothing.

**3. Check nobody else holds it.** Read the task's issue and skip it if it is
closed, assigned, or labelled `arsenal:claimed`.

**4. Claim it** with `claim_task.sh <task-id>` and obey the result exactly as
`claude-arsenal/AGENTS.md` § Claiming — the contract says (`lost` → take the next task;
`error:` → stop and tell the user).

Load `references/claim-gotchas.md` when a claim is refused, looks stale, or a
task needs a retry attempt. In short: `lost` is final, stale claims are released
only by `queue_hooks.py sweep-claims`, and a retry needs
`ARSENAL_CLAIM_STALE_OK=1` once the first attempt is known stale.

**5. Work the task, then open its PR with `open_task_pr.sh`** (AGENTS.md § Completion).
A session told to push only to one designated branch passes `--branch <that-branch>`.

**6. Loop back to step 2.**

## Scoping

Bare-word tokens are order-independent and resolved by membership, in this
order; a task qualifies only if it satisfies every token:

| the token matches | it resolves to |
|---|---|
| the suffix of a known capability | `--capability` filter (`HUMAN` → `access:human`, `CLI` → `surface:cli`) |
| a known workspace | `--workspace` filter (at most one) |
| a known tag | `--tag` filter (several are ANDed) |
| nothing above | fuzzy title search |

If two capability classes share a suffix, write the token in full as
`class:value`.

A capability token always filters; it also grants the capability only where
nothing can check it:

| token names | granted by the token? | because |
|---|---|---|
| `surface:*`, `services:*` | no — the probe decides | a cloud session cannot run work that needs a real terminal |
| `access:browser` | no — the session's tools decide | with no browser connected, say so and stop |
| `access:human`, `access:secrets`, `access:device` | yes | nothing can probe them, so the person typing the token is the evidence |

## Gotchas

- **A task on an unmerged branch is not in the queue yet** — task files are read from the default branch.
- **A task with no issue handle is invisible.** `arsenal-queue.yml` opens
  handles automatically where installed; otherwise run `handle_sync.py` (in
  `claude-arsenal/scripts/`) and create the ones it lists.
- **Empty scoped selection**: if the global queue still has tasks, report what
  blocks the scope and offer to fall back to the global queue.
