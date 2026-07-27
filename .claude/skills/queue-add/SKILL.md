---
name: queue-add
description: When the user wants to add a task to the claude-arsenal queue. Do NOT use to update or remove existing tasks.
user-invocable: true
argument-hint: "--title TITLE [--priority N] [--workspace NAME] [--tag TAG] [--requires surface:X] [--deps lo-XXXX] [--max-attempts N]"
---

# queue-add

Appends a new task row to `claude-arsenal/queue/tasks.jsonl` with a hash-based ID, title, priority, optional workspace scope, surface requirements, and dependency edges. Validates schema and dependency edges before writing.

CANARY: queue-add-loaded-2026-06-13-fb78d23e-c3d4e5f6a7b8c9d0

## When to load

Load this skill when:

- The user wants to add a task, ticket, or work item to the queue.
- Phrasing: "add a task", "queue this up", "enqueue", "/queue-add".
- Seeding the queue from a list of tasks before starting workers.

## How to use

```bash
python3 .claude/skills/queue-add/scripts/create_task.py \
  --title "Implement claim.sh" \
  --priority 10 \
  --workspace BACKEND \
  --tag CLI \
  --requires "surface:cli" \
  --deps lo-a1b2 \
  --max-attempts 3
```

The script generates a `lo-XXXX` hash ID, writes the row, and prints the assigned ID.
Use the printed ID as a `--deps` argument when adding dependent tasks.

## Writing the payload file

After `create_task.py` prints the new ID, create `claude-arsenal/queue/<id>.md`.
The payload is the first thing a worker reads; include a gate line, the test
function names the worker must write RED first (copied from the plan's Tests column),
and one reference anchor per spec section, decision record, or sibling pattern
needed to start — spare them the grep.

Load `.claude/skills/queue-add/references/payload-template.md` when writing the payload file for a new task.

Example:

```markdown
**Gate**: metric_name ≥ threshold on held-out test set

## References
- Spec: `spec.md §7.3` — table defining the gate formula
- Decision: `DECISIONS.md #1` — rationale for approach chosen in design
- Sibling: `<subproject>/path/to/sibling.py` — pattern to reuse for implementation
```

## Gotchas

- **Deps must already exist in the queue.** The script rejects `--deps` values that do not match an existing task ID.
- **`requires` values are exact strings.** Use `surface:cli` or `surface:web`; unrecognised values pass through but will never match a worker's surface profile.
- **`--workspace` scopes the task.** When set, `queue_eval.sh` with `LOOP_WORKSPACE=X` will only return tasks for that workspace.
- **`--tag` (repeatable) adds free-form labels.** `/continue CLI` scopes the loop to tasks carrying tag `CLI` (multiple tags AND together via `LOOP_TAGS`). Tags are orthogonal to `--workspace` and `--requires`.
- **`--max-attempts N` (default 3) sets the per-task retry cap.** After N consecutive gate failures the task auto-escalates to `escalated` status and leaves the eligible pool. Set higher for tasks known to be environment-sensitive; set to 1 for tasks that need manual review after any failure. `queue-status` shows escalated counts and per-task attempt budget in `--detail`.
- **Tasks authored in a feature PR land on the default branch, not `arsenal-queue`.** Running `/queue-add` during a feature-branch session (no active orchestrator, `ARSENAL_QUEUE_DIR` unset) writes rows to the main working tree — committed to that branch, not to the coordination branch. Once the PR merges, those rows are on the default branch but absent from `arsenal-queue`. The orchestrator runs `queue_sync.sh` automatically at step 1b of every session start to close this gap. To port missing rows manually before `/continue`, run `queue_sync.sh` with `ARSENAL_QUEUE_DIR` set to the coordination worktree path. To avoid the mismatch entirely, seed the queue on the coordination branch by running `queue_branch.sh` first.
