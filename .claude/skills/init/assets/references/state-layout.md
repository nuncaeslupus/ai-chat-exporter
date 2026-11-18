# State layout and task lifecycle

Read this for a lookup: where a file lives, what a directory is for, or what a
task's state means. Nothing here has to be in context to start a session.

## Contents

- [Task lifecycle](#task-lifecycle) — the states, and why none of them is stored
- [Task format — the rest of it](#task-format--the-rest-of-it) — a full example, and the field rules
- [State directory layout](#state-directory-layout)

---

## Task lifecycle

```
open ──claim ref created──→ claimed ──PR merged (Closes #N + archive)──→ done
  ↑                            │
  └──── attempt failed ────────┘   (next attempt claims <id>.a2, up to max-attempts)
```

State is **derived, never stored**: `open` is an open issue with no claim, `claimed` is an
open issue carrying `arsenal:claimed` or an assignee, `done` is an issue closed **as
completed**. An issue closed as not-planned leaves dependents blocked on purpose — a stray
close must not release work that was never done. Because state is derived, a stored status
cannot drift from reality, which is the entire class of bug the old queue doctor existed
to detect.

## Task format — the rest of it

````markdown
---
id: t-3f8a91c2
label: "extract surface probe"
title: "Extract the surface probe into its own script"
priority: 5
deps: [t-aaaa1111, t-bbbb2222]
requires: [surface:cli]
tags: [CLI]
workspace: BACKEND
max-attempts: 3
---

## Acceptance gate
```bash
bash tests/surface_probe_test.sh
```
````

`priority` encodes **task size** — S=10, M=5, L=1, larger runs sooner — and nothing
else. Build order belongs in `deps`. Only `id` and `title` are required.

**Ids are random** (`t-` plus eight hex characters). They used to be a hash of the title
truncated to four characters, checked for uniqueness against the local file only — so two
agents adding a task with the same title minted the same id. Random ids need no
coordination, which is what lets several agents add tasks at once.

## State directory layout

```
claude-arsenal/        ← upstream. /init refreshes what it ships and retires what
                         it no longer ships. A file YOU add here is left alone.
  .arsenal-manifest    ← what this install wrote; only these are ever retired
  AGENTS.md            ← the session protocol; imported via @claude-arsenal/AGENTS.md
  references/          ← the rest of the protocol, read on demand (never imported)
  agents/worker.md     ← worker subagent definition
  agents/reviewer.md   ← adversarial reviewer: reads a change cold, before its PR
  bin/
    github_channel.sh  ← the ONE place that knows how to reach GitHub (gh | rest | none)
    claim_task.sh      ← atomic claim via ref creation
    worktree_probe.sh  ← probes whether git worktrees work here (fan-out safety)
    worker_postcheck.sh ← restores a clean tree after each worker
    rescue_snapshot.sh ← snapshots a dirty tree before any forced restore
    park_task.sh      ← pushes a stopped task's uncommitted work to arsenal/wip/<id>
    host_setup.sh      ← runs the host's install command in a fresh worktree
    open_task_pr.sh    ← worker-side; branch → commit → push → PR
    adversarial_review.sh ← pre-PR review packet, verdict, and freshness receipt
    gate_run.sh        ← runs the task's fenced gate block
    budget_check.sh    ← quota stop + per-session round cap
    check_update.sh    ← bundle freshness against the upstream tag
    reader_hook.sh     ← PostToolUse: a spec or plan changed, its reader is stale
    statusline_capture.sh, detect_surface.sh, workspace_list.sh
  workflows/
    arsenal-queue.yml  ← installed to .github/workflows/ by /init
  scripts/
    task_select.py     ← pure selector: graph + issues → the next task
    query_status.py    ← the board (and the drift report: task vs issue disagreeing)
    handle_sync.py     ← task files with no issue handle yet
    issue_import.py    ← the other direction: labelled issues with no task yet
    issue_for_task.py  ← task id → its issue number, so `Closes #N` can be written
    queue_hooks.py     ← the transitions GitHub runs: close, release, sync, sweep
    arsenal_config.py  ← reads arsenal/config.toml
    arsenal_migrate.py ← one-time move from the old coordination-branch queue
    gate_evidence.py
    reader_check.py    ← which spec/plan lacks a current reader; exports left in Downloads
    ideas_log.py       ← parses/checks status/ideas.md; the board's one `ideas:` line

arsenal/               ← yours. Scaffolded once, then never written by an upgrade
  config.toml          ← merge-policy, host-gate, listing budget…
  tasks/<id>.md        ← the tasks; their front matter is the DAG
  project/             ← workspace overview + per-workspace context (<ws>/spec.md, plan.md)
  session/
    handover.md        ← live; updated each session
    surface_profile.json, rate_limits.json, budget_iterations.json  ← gitignored
```

`surface_profile.json` is what `task_select.py` offers against `requires:`, with any
`--capability` added. `detect_surface.sh` writes it at session start: `surface:cli` or
`surface:cloud`+`surface:web`, reachable services, and every host probe declared in
`config.toml` that exits 0 here (5 s each):

```toml
[capabilities]
"net:example.com" = "curl -sf -o /dev/null --max-time 5 https://example.com/"
"data"            = "test -d data/raw"
```

`requires:` also gates on things that are not the surface — `[human:gate]` for "not for
the worker loop", a name nobody grants for "not yet". A task asking for a capability no
surface offers is listed in the selector's warning, never dispatched.

The split is the point: upstream owns exactly one directory, so an upgrade can never touch
your tasks, plans, or settings — and the vendored prefix contains only upstream content,
which is what makes it consumable as a subtree.
