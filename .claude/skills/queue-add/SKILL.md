---
name: queue-add
description: When the user wants to add a task to the claude-arsenal queue. Do NOT use to update or remove existing tasks.
user-invocable: true
argument-hint: "--title TITLE [--priority N] [--workspace NAME] [--tag TAG] [--requires surface:X] [--deps t-XXXXXXXX] [--max-attempts N]"
---

# queue-add

Creates a task as a file in the repository — `arsenal/tasks/<id>.md` — carrying its
title, priority, dependencies, and acceptance gate, then prints the issue handle to open
for it. The file is the task; the issue is only a handle, so agents can claim it and the
board stays visible.

CANARY: queue-add-loaded-2026-06-13-fb78d23e-c3d4e5f6a7b8c9d0

## When to load

Load this skill when:

- The user wants to add a task, ticket, or work item to the queue.
- Phrasing: "add a task", "queue this up", "enqueue", "/queue-add".
- Seeding the queue from a list of tasks before starting workers.

## How to use

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/create_task.py" \
  --title "Extract the surface probe into its own script" \
  --priority 5 \
  --deps t-aaaa1111 \
  --requires "surface:cli" \
  --tag INFRA \
  --workspace BACKEND
```

It prints the new task id on stdout and, on stderr, the exact issue to open. Create that
issue with whatever GitHub access this surface offers — the built-in GitHub tools, `gh`,
or the REST API — with the `arsenal:task` label and a visible `` `arsenal-task: <id>` `` line in the
body. **The marker is what links issue to task**; without it the task is invisible to the
selector, and without the label the issue is never treated as claimable work.

Use the printed id as a `--deps` argument when adding dependent tasks.

## Write a real gate

The generated file contains a deliberately failing gate. Replace it before the task is
claimed:

````markdown
## Acceptance gate

```bash
bash <the test that proves this task is done>
```
````

The fenced block is what makes a gate mechanical. Prose, and inline `single-backtick`
commands, are never executed — so a gate written as prose runs nothing, and a gate that
runs nothing passes everything. One consumer audit found 0 of 70 payloads carried a
fenced block, meaning an entire gate layer had been inert for months. `task_select.py`
reports `gate: false` for a task with no block, so the problem is visible rather than
silent, and the placeholder fails until it is replaced rather than passing by default.

Load `${CLAUDE_SKILL_DIR}/references/payload-template.md` for the fuller task-body shape:
the test names a worker should write failing first, and one reference anchor per spec
section or sibling pattern needed to start — spare them the grep.

## `--requires` gates; `--tag` only labels

Both are applied by `task_select.py`, but only one of them protects anything.
`--requires` is matched against what the session *can do*, so a task is hidden from a
session that cannot run it. `--tag` is matched against what the session *asked for* — it
narrows a search and nothing more, so a tag never keeps a task away from a session that
would fail it. "A person has to answer this" therefore belongs in `--requires`; as a tag
it holds until the moment an unattended worker asks for that tag, then fails three times.

| capability | the task cannot proceed without | granted by |
|---|---|---|
| `surface:cli` | a real terminal on a machine | the probe |
| `surface:cloud` | a cloud session (`surface:web` is the older name for the same thing) | the probe |
| `services:postgres`, `services:redis` | that daemon answering | the probe |
| `access:human` | a person to decide, label, answer, or approve | naming it at `/continue` |
| `access:browser` | a driveable browser | the session's own tools |
| `access:secrets` | machine-local credentials — prod tokens, SSH keys, a vault | naming it at `/continue` |
| `access:device` | hardware physically attached — a phone, a serial port, a board | naming it at `/continue` |

Reach for a new capability only when a session that already has `surface:cli` would
*still* be unable to do the task. That test is what keeps the list this short: LAPTOP, PC,
DESKTOP and CLI are all one capability, and the tools that only exist on a real machine —
Claude Design, the research tool — need no name of their own beyond `surface:cli`.

Tags are for scoping a working session instead: `FRONTEND`, `BACKEND`, `DOCS`, `INFRA`,
`FLAKY`. Both lists are examples, not an enum — `create_task.py` accepts any string.

## Gotchas

- **Deps must already exist.** `--deps` is rejected if no task file declares that id. The
  selector treats an unknown dep as unsatisfied, so a typo would otherwise block the task
  forever and silently. Finished tasks count — `_history/` is read too, so a dep on merged
  work is declarable rather than a relationship only prose records.
- **Ids are random, not derived from the title.** Two agents adding tasks at the same time
  cannot collide, and no coordination is needed to mint one.
- **`requires` values are matched as exact strings.** A typo passes validation and then
  matches nothing, so the task is never offered to anyone — the failure looks like an
  empty queue, not like a bad value. Copy them from the table above.
- **`--tag` and `--requires` are both repeatable and orthogonal**, to each other and to
  `--workspace`.
- **`--max-attempts N` (default 3) caps retries.** Each retry claims the next attempt ref;
  past the cap the task stops being offered and needs a human.
- **The task file must be merged to the default branch to count.** Task files are read
  from the default branch so every agent computes the same graph — a task on an unmerged
  branch is not yet part of the queue. That is the same rule as any other change to the
  project.
