# Queue seeding — turning plans and issues into tasks

Read this when the selector returns nothing and the queue has to be filled: from
a plan table, from issues filed between sessions, or from a divergence found
mid-session. A session that picks up existing work never needs this file.

## Contents

- [Seeding from a plan table](#seeding-from-a-plan-table) — one procedure, workspace or solo
- [Importing issues filed between sessions](#importing-issues-filed-between-sessions)
- [Divergence handling](#divergence-handling) — a `D-N` task, never a note in the handover

---

## Seeding from a plan table

When there are no task files yet and a plan exists, seed the queue from its
implementation-tasks table **without asking the user first**.

Where the plan lives depends on the repo's shape, and that is the only
difference between the two cases:

- **Workspace-structured** — `arsenal/project/overview.md` lists the workspaces;
  read `arsenal/project/<workspace>/plan.md` for each, and pass
  `--workspace <NAME>` on every `create_task.py` call so the task files under the
  right workspace.
- **Solo / single-workspace** — read `status/plan.md` and omit `--workspace`.

Everything below is the same either way. The table columns are:
`T# | Description | Location | Size | Depends | Gate | Tests`

**Steps:**

1. Add tasks with no dependencies first, capturing each printed ID. Pass the
   size from the table's Size column and let `--size` write the value:
   ```bash
   python3 .claude/skills/queue-add/scripts/create_task.py \
     --title "T1: <Description>" \
     --size S \
     --workspace FRONTEND \
   # → prints e.g. t-3f8a91c2, and the issue handle to open on stderr
   ```

   > **Ordering goes in `deps`; size goes in `priority`.** Transcribing an
   > ordered `T1 … T50` table tempts you to encode rank here — T1 gets 100, T2
   > gets 95 — and nothing rejects it. But a rank scale's floor sits above the
   > size scale's ceiling, so once both are on one board every rank-encoded task
   > outranks every sized one unconditionally, and dispatch order comes to
   > reflect when a row was written rather than anything anyone chose. `deps` is
   > the DAG the selector actually runs on and the thing that survives
   > re-planning; use it. `query_status.py` reports a board carrying both.

2. Add tasks whose deps are now in the queue:
   ```bash
   python3 .claude/skills/queue-add/scripts/create_task.py \
     --title "T3: <Description>" \
     --size M \
     --workspace FRONTEND \
     --deps t-3f8a91c2 \
   ```

3. `create_task.py` writes `arsenal/tasks/<id>.md`; fill in its body and replace the
   placeholder gate:

   ````markdown
   # T1: <Description>

   ## Acceptance gate
   <Gate column content — prose describing what must be true.>

   If the check is mechanically runnable, also add a bash block:
   ```bash
   bash tests/my_feature_test.sh
   ```

   ## Tests
   <Tests column content>

   ## Location
   <Location column content>
   ````

   `gate_run.sh` executes that block, and a worker opens no PR when it fails —
   so a task cannot reach `done` on a gate that failed or never ran. **The fence
   is what makes a gate mechanical**, and a numeric threshold needs a committed
   measurement behind it: see `claude-arsenal/references/evidence-gates.md`
   before writing either kind.

4. Proceed to the **worker loop** (`claude-arsenal/references/worker-loop.md`).

---

## Importing issues filed between sessions

Step 4b of the session-start protocol runs `issue_import.py`. It writes a task
file per labelled issue that is not already a handle, and prints, per issue,
three remote changes for you to apply:

| Key | What to do with it |
|---|---|
| `add_to_issue_body` | append the `` `arsenal-task: <id>` `` line to that issue's body — visible text, never an HTML comment |
| `add_label` | add `arsenal:task` to the issue |
| `remove_label` | drop the import label |

The first turns the existing issue into the task's handle rather than opening a
second one. **The two labels matter as much as the marker**: step 2 fetches the
board by `arsenal:task` specifically, so an issue left carrying only the import
label is invisible to it — `handle_sync.py` then reports the task as having no
handle and proposes a *second* issue for it, which is how you end up with two
issues for one task, both resolving to the same id.

Apply all three, and commit the new task files.

Why the step exists: issues get filed between sessions, from a phone, with no
session open to seed a task, and until it existed nothing read them. The
selector sees only task files, so an empty selection was reported as "no work"
in a repo carrying a dozen open issues.

An imported task carries `requires: [human:gate]` and is therefore **visible but
never dispatched** — its gate is the issue's prose, and a gate that runs nothing
passes everything. Writing a real gate and deleting that line is what makes it
claimable, which is a human's call, not a worker's.

The import label defaults to `arsenal:queue`; set `import-label` in
`arsenal/config.toml` to change it.

---

## Divergence handling

A **spec divergence** is code that contradicts what `spec.md` / `plan.md`
require — wrong labels, wrong scope, a missing step, a wrong constant. Noting one
in `handover.md` prose is **insufficient**: the handover is a snapshot the next
session overwrites, so a prose-only divergence never shows up in `queue-status`,
is never ordered or blocked against other tasks, and silently persists across
context compactions while workers keep building on the wrong inputs.

**Rule: any blocking spec divergence found during a session MUST be seeded as a
queue task before the session ends.** The queue is the source of truth, not the
handover.

Minimum task — title it `D-N` (the Nth divergence this session):

```bash
python3 .claude/skills/queue-add/scripts/create_task.py \
  --title "D-N: <short description>" \
```

In a workspace-structured project, add `--workspace <WORKSPACE>` to file the
divergence under the right workspace; solo / single-workspace repos omit it.
Give it a task file at `arsenal/tasks/<id>.md` that names three things:
what the spec requires, what the code does, and the fix location.

This applies to workers and solo sessions alike. A worker that spots a divergence
outside its own task's scope flags it in its returned outcome; the orchestrator —
the single queue writer — seeds the task (it never lets a worker push to the
coordination branch). A solo session seeds the task directly.

---
