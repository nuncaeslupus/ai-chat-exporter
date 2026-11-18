---
name: queue-add
description: Adds a task to the claude-arsenal queue. Use when the user wants a new task queued. Not for editing existing tasks.
user-invocable: true
argument-hint: "--title TITLE [--label WORDS] [--priority N] [--workspace NAME] [--tag TAG] [--requires surface:X] [--deps t-XXXXXXXX] [--max-attempts N]"
---

# queue-add

Creates a task as a file — `arsenal/tasks/<id>.md` — carrying its title,
priority, dependencies and acceptance gate, then prints the issue handle to
open for it. The file is the task; the issue is the handle agents claim.

CANARY: queue-add-loaded-2026-06-13-fb78d23e-c3d4e5f6a7b8c9d0

## When to load

- The user wants to add a task, ticket or work item to the queue ("queue this
  up", "enqueue", `/queue-add`).
- Seeding the queue from a list of tasks before starting workers.

## How to use

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/create_task.py" \
  --title "Extract the surface probe into its own script" \
  --label "extract surface probe" \
  --priority 5 --deps t-aaaa1111 --requires "surface:cli" \
  --tag INFRA --workspace BACKEND
```

It prints the new id on stdout and, on stderr, the issue to open. Create that
issue with the `arsenal:task` label and a visible `` `arsenal-task: <id>` ``
line in the body: the marker links issue to task, and the label makes it
claimable work. `--label` is the board's short name (five words at most);
it defaults to the first five words of the title. Use the printed id as a
`--deps` argument for dependent tasks.

## Write a real gate

The generated file carries a placeholder gate that fails until replaced.
Replace it before the task is claimed:

````markdown
## Acceptance gate

```bash
bash <the test that proves this task is done>
```
````

Only a fenced block is executed; prose and inline commands run nothing, so they
pass everything. Load `${CLAUDE_SKILL_DIR}/references/payload-template.md` when
writing the task body beyond the gate: test names to write failing first, and
one reference anchor per spec section or sibling pattern.

## `--requires` gates; `--tag` only labels

`--requires` is matched against what a session can do, so the task is hidden
from sessions that cannot run it. `--tag` is matched against what a session
asked for and only narrows a search. "A person has to answer this" therefore
belongs in `--requires`, where it keeps unattended workers away.

| capability | the task cannot proceed without | granted by |
|---|---|---|
| `surface:cli` | a real terminal on a machine | the probe |
| `surface:cloud` | a cloud session (`surface:web` is the older name) | the probe |
| `services:postgres`, `services:redis` | that daemon answering | the probe |
| `access:human` | a person to decide, label, answer, or approve | naming it at `/queue-next` |
| `access:browser` | a driveable browser | the session's own tools |
| `access:secrets` | machine-local credentials | naming it at `/queue-next` |
| `access:device` | attached hardware — a phone, a serial port, a board | naming it at `/queue-next` |

Add a new capability only when a session that has `surface:cli` still could not
do the task. Tags scope a working session (`FRONTEND`, `DOCS`, `INFRA`,
`FLAKY`); both lists are examples, and `create_task.py` accepts any string.

## Gotchas

- **Deps must already exist** (`_history/` counts), since an unknown dep would
  block the task silently.
- **`requires` values match as exact strings.** A typo looks like an empty
  queue, so copy them from the table.
- **`--tag`, `--requires` and `--workspace` are independent**; the first two
  are repeatable.
- **`--max-attempts N` (default 3) caps retries**; past it the task needs a person.
- **The task counts once merged to the default branch**, like any other change.
