# Queue seeding — turning plans and issues into tasks

Read this when the selector returns nothing and the queue has to be filled: from
a plan table, from issues filed between sessions, or from a divergence found
mid-session. A session that picks up existing work never needs this file.

## Contents

- [Seeding from a plan table](#seeding-from-a-plan-table) — one procedure, workspace or solo
- [The handle marker must be visible text](#the-handle-marker-must-be-visible-text)
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

Only an approved plan is seeded:
`python3 .claude/skills/design/scripts/validate_plan.py --input <plan> --require-approved`
must exit 0 first. A plan whose `**Status**` is still `draft` goes back to the
reviewer as its reader (`references/annotatable-reader.md`), not onto the board.
A plan with no `**Status**` line at all predates the review record — ask once
whether it is approved and record the answer in its header.

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

   Encode table order in `deps`, not in `priority`, which holds size only. A
   rank scale (T1 = 100, T2 = 95) sits above the size scale, so rank-encoded
   tasks outrank every sized one and dispatch follows row order rather than the
   dependency graph. `query_status.py` reports a board carrying both.

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

   `gate_run.sh` executes that block, and a worker opens no PR when it fails.
   Only the fenced block runs, and a numeric threshold needs a committed
   measurement; read `claude-arsenal/references/evidence-gates.md` before
   writing either kind.

4. Proceed to the **worker loop** (`claude-arsenal/references/worker-loop.md`).

---

## The handle marker must be visible text

The `` `arsenal-task: <id>` `` line that `handle_sync.py` and `issue_import.py`
put in an issue body is written as visible text, not an HTML comment, because
some GitHub tools strip angle-bracketed content. A stripped id leaves the issue
anonymous, and `handle_sync.py` then proposes a second handle for the same task.

## Importing issues filed between sessions

Step 4b of the session-start protocol runs `issue_import.py`, which writes a
task file per labelled issue that is not already a handle and prints, per issue,
the remote changes to apply:

| Key | What to do with it |
|---|---|
| `add_to_issue_body` | append the `` `arsenal-task: <id>` `` line to that issue's body — visible text, never an HTML comment |
| `add_label` | add `arsenal:task` to the issue |
| `add_id_label` | add `arsenal-id:<id>` — what keeps the issue paired to its task after either is renamed, and the only exact marker a body-less fetch can see |
| `remove_label` | drop the import label |

Apply every row and commit the new task files. The body line makes the existing
issue the task's handle; the labels matter as much, because step 2 fetches the
board by `arsenal:task`, so an issue left with only the import label is invisible
and `handle_sync.py` proposes a second issue for the same task.

An imported task carries `requires: [human:gate]` and is therefore **visible but
never dispatched** — its gate is the issue's prose, and a gate that runs nothing
passes everything. Writing a real gate and deleting that line is what makes it
claimable, which is a human's call, not a worker's.

The import label defaults to `arsenal:queue`; set `import-label` in
`arsenal/config.toml` to change it.

---

## Divergence handling

A **spec divergence** is code that contradicts what `spec.md` / `plan.md`
require: wrong labels, wrong scope, a missing step, a wrong constant. Seed every
blocking divergence as a queue task before the session ends. A note in
`handover.md` is not enough, because the handover is a snapshot the next session
overwrites; a divergence that lives only there never appears in `queue-status`,
is never ordered against other tasks, and lets workers keep building on the
wrong inputs.

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
default branch). A solo session seeds the task directly.

---
