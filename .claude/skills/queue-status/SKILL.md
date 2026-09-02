---
name: queue-status
description: When the user wants queue progress counts by status, or to audit the queue for inconsistencies (missing gates, missing issue handles, broken deps). Do NOT use to modify task status.
user-invocable: true
argument-hint: "[--detail]"
metadata:
  type: workflow
---

# queue-status

Reports the board: how many tasks are open, claimed, done and blocked, and — with
`--detail` — every task with its priority, state, and what is holding it up.

CANARY: queue-status-loaded-2026-06-13-fb78d23e-d4e5f6a7b8c9d0e1

## When to load

Load this skill when:

- The user asks "how is the queue?", "what tasks are left?", "queue status", or "/queue-status".
- Checking whether all tasks are done before closing a loop session.
- Diagnosing a stuck queue (tasks blocked on unmet deps).

## How to use

First fetch the `arsenal:task` issues — open **and** closed — with whatever GitHub access
this surface has, and save the JSON. Ask for `number`, `title`, `state`, `labels`,
`assignees` and **not `body`**: the board is derived from labels and state, the task id
resolves from the title when no body is present, and the bodies are the bulk of the fetch.
Then:

Run `query_status.py` (in `claude-arsenal/scripts/`, beside `task_select.py`):

```bash
# Summary counts
query_status.py --issues /tmp/issues.json

# Full task list with blockers
query_status.py --issues /tmp/issues.json --detail
```

It ships in the runtime bundle rather than in this skill's own folder because
the session-start protocol in `AGENTS.md` runs the board every session without
loading any skill — a `${CLAUDE_SKILL_DIR}` path would be undefined there.

State comes from the issues and the graph comes from `arsenal/tasks/`, which is exactly
what the selector reads — so the board can never disagree with what a worker will pick up
next. Without `--issues` it still lists the graph, but every task shows as `open`, because
state lives in the issues.

## What it flags

Three problems are reported on stderr, and `--fail-on-problems` turns them into a non-zero
exit so a `make` target or CI job can gate on them:

- **`no-gate`** — the task has no fenced ` ```bash ` block. A gate written as prose executes
  nothing, and a gate that runs nothing passes everything. This is worth failing a build
  over: one consumer audit found 0 of 70 payloads carried a fenced block, so its entire
  gate layer had been inert without anyone noticing.
- **`no-handle`** — the task file exists but no issue points at it, so no agent can claim
  it. Run `handle_sync.py` and create the missing issues. Where it reports a near-identical
  issue title instead of proposing one, that issue is probably already the handle: add
  `arsenal-task: <id>` to it rather than opening a second. This delays work rather than
  corrupting it.
- **`depends on unknown task`** — a dep id that no task file declares. The selector treats
  unknown deps as unsatisfied, so such a task would never become eligible and would never
  say why.
- **completion drift** — the task file and its issue disagree about whether the work is
  finished: a file archived `status: merged` whose issue is still open (the PR merged
  without closing it), or an issue closed as completed whose task file is still live in
  `tasks/`. Both mean a merge did half of what it was meant to. `effective_state` hides
  this from selection on purpose — a merged task must never be handed out again, whatever
  became of its issue — so the board is the only place it can surface.

## Gotchas

- **`blocked` does not mean failed.** A task becomes eligible automatically once its
  dependencies are closed as completed.
- **Only a close as *completed* satisfies a dependency.** An issue closed as not-planned
  leaves dependents blocked on purpose — a stray close should not release work nobody did.
- **`claimed` means an agent holds the claim ref**, not that a human is looking at it. The
  issue's assignee and its claim comment name which session, and the session id doubles as
  a link to it. A claim held for over a day with no open PR belonged to a session that
  crashed; `.github/workflows/arsenal-queue.yml` releases those on a schedule, so a repo
  with the workflow should not accumulate them.
