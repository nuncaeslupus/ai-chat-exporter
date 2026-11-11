---
name: queue-status
description: Reports queue counts and flags missing gates, handles and broken deps. Use when the user asks how the queue stands. Not for changing task status.
user-invocable: true
argument-hint: "[--detail]"
effort: low
metadata:
  type: workflow
---

# queue-status

Reports the board: how many tasks are open, claimed, done and blocked, and —
with `--detail` — every task with its priority, state, and what holds it up.

CANARY: queue-status-loaded-2026-06-13-fb78d23e-d4e5f6a7b8c9d0e1

## When to load

- The user asks how the queue stands, what tasks are left, or types `/queue-status`.
- Checking whether every task is done before closing a loop session.
- Diagnosing a stuck queue.

## How to use

Fetch the `arsenal:task` issues, open and closed, with whatever GitHub access
this surface has, asking for `number`, `title`, `state`, `labels`, `assignees`
(plus `state_reason` where the surface returns it) and leaving out `body` — the board is derived from labels and state, and bodies
are most of the fetch. Then run `query_status.py` (in `claude-arsenal/scripts/`):

```bash
query_status.py --issues /tmp/issues.json            # summary counts
query_status.py --issues /tmp/issues.json --detail   # every task with blockers
```

It reads the same graph as the selector, so the board matches what a worker
will pick next. Without `--issues` every task shows as `open`, because state
lives in the issues.

## What it flags

Problems go to stderr; `--fail-on-problems` makes them a non-zero exit for a
`make` target or CI job.

- **`no-gate`** — no fenced ` ```bash ` block, so the gate runs nothing and
  passes everything.
- **`no-handle`** — no issue points at the task, so no agent can claim it. Run
  `handle_sync.py` and create the missing issues; where it reports a
  near-identical issue title, add `arsenal-task: <id>` to that issue instead of
  opening a second.
- **`depends on unknown task`** — a dep id no task file declares. The selector
  treats it as unsatisfied, so the task would never become eligible.
- **completion drift** — the task file and its issue disagree on whether the
  work is finished (a merged file with an open issue, or a completed issue with
  a live file). Selection hides this on purpose, so the board is where it shows.

## Reading the board

- `blocked` is not failed: the task becomes eligible once its dependencies are
  closed as completed. A close as not-planned leaves dependents blocked.
- `claimed` means an agent holds the claim ref; the issue's assignee and claim
  comment name the session. A claim over a day old with no open PR may be stale;
  `arsenal-queue.yml` releases those on a schedule, and
  `claude-arsenal:core:queue-next § references/claim-gotchas.md` says how
  stale claims are released.
