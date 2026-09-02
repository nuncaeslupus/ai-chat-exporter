# Claude Arsenal

<!-- claude-arsenal v3.4.2 — imported via @claude-arsenal/AGENTS.md -->

This file is imported by the host repo's `CLAUDE.md` via the session-protocol block
that `/init` injects, so it sits in context on **every turn of every session**. It
therefore carries only what a session needs before it knows what kind of session it is:
how to start, what a task is, how a claim is decided, and how a task finishes.

The rest of the protocol lives in `claude-arsenal/references/`, read **on demand**.
Those are plain paths, never `@` imports — nothing here pulls them into context. The
table at the end says which file answers what.

Paths starting `arsenal/` are the host-owned tree, and a host that sets `ARSENAL_HOME`
relocates all of them at once. `claude-arsenal/` is the vendored bundle and never moves.

---

## Session-start protocol

At the start of every session (fresh start, context compaction, or cold restart):

0. **Refresh the bundle.**
   a. If `claude-arsenal/bin/check_update.sh` exists, run it **with `--check-only`** and
      surface whatever it reports: current, a missing `arsenal` remote, a bundle ahead of
      the newest tag, an `UPDATE AVAILABLE`, or — the one that has bitten consumers — an
      `UNTAGGED UPSTREAM RELEASE`, where upstream's default branch ships a version whose
      tag was never pushed. The fix for that one is upstream (`make tag`), not here.
      `--check-only` matters: without it the script merges the new subtree and commits,
      which is a history-writing side effect from a step described as a report, landing in
      the same main working tree the worker loop requires to be clean.
   b. Run `python3 .claude/skills/init/scripts/init.py --repo-path . --silent` to refresh
      any stale bundle script, and report anything it refreshes. It writes nothing when
      the installed bundle is NEWER than the skill's copies — report that line as-is and
      update the plugin; do not pass `--allow-downgrade` to get past it. That refusal is
      itself part of the skill, so if (a) reported `VENDORED SKILL BEHIND BUNDLE`, skip (b)
      entirely: a skill old enough to be behind may be old enough to predate the guard, and
      it will rewrite the bundle backwards. Skip (a) and (b) when that script is not present.
   c. **Read the capability map** — `python3 .claude/skills/init/scripts/init.py --list-sections`
      names every skill section this marketplace ships and whether it is installed here. Read
      it, do not file it: when a later task is squarely covered by a section this repo did
      **not** install, say so once, then do what was asked.
      → `claude-arsenal/references/capability-map.md`

1. **Establish the GitHub channel** — `bash claude-arsenal/bin/github_channel.sh --detect`
   prints `gh`, `rest`, or `none`. **`none` is not a failure**: it means no scriptable
   channel exists on this surface, so every GitHub step below is performed with your own
   built-in GitHub tools instead. What must not happen is skipping those steps. The
   previous protocol gated them on `command -v gh`, which turned required work into silent
   no-ops on Claude Code on the web, where `gh` is absent.

2. **Fetch the task issues** — list issues labelled `arsenal:task`, **open and closed**,
   and save the JSON (e.g. to `/tmp/arsenal-issues.json`). Closed ones are not optional: a
   closed-as-completed issue is what marks a dependency satisfied.
   > Ask for **`number`, `title`, `state`, `labels`, `assignees` — not `body`.** Every
   > script below resolves an issue to its task from the `arsenal-task:` line *or* from
   > the title, so the bodies buy nothing and cost the most: on a surface where the fetch
   > lands in context, a 40-issue board is ~9k tokens with bodies and ~1.2k without,
   > charged once per session before any work is read. With the GitHub MCP tools that is
   > the `fields` argument; with `gh`, `--json number,title,state,labels,assignees`.

3. **Read the board** —
   `python3 claude-arsenal/scripts/query_status.py --issues /tmp/arsenal-issues.json`.
   Report anything it flags: a task with no fenced gate block, a task file with no issue
   handle, or a dep that no task file declares.

4. **Create any missing handles** (usually a no-op — `.github/workflows/arsenal-queue.yml`
   opens them when the task file lands) —
   `python3 claude-arsenal/scripts/handle_sync.py --issues /tmp/arsenal-issues.json`
   prints one JSON object per task file that has no issue yet; create those issues with the
   `arsenal:task` label and a **visible** `` `arsenal-task: <id>` `` line in the body. It
   must be visible text, not an HTML comment: some GitHub tools strip angle-bracketed
   content from bodies, and an id that is stripped leaves the issue anonymous and the board
   reading as stateless. A row carrying an `ambiguous` key is a collision to resolve first,
   not an issue to create. This is the only sync in the system: one-directional and
   idempotent, so a failure delays work rather than corrupting it.

4b. **Import issues filed between sessions** — list open issues carrying the import label
   (default `arsenal:queue`; `import-label` in `arsenal/config.toml` changes it), save the
   JSON, then
   `python3 claude-arsenal/scripts/issue_import.py --issues /tmp/arsenal-import.json --apply`.
   Apply everything each row prints — the `arsenal-task: <id>` line into the body, plus
   the `add_label` / `remove_label` swap onto `arsenal:task`; an issue left on the import
   label is invisible to step 2 and `handle_sync.py` proposes a duplicate for it next
   session. Then commit the new task files.
   → `claude-arsenal/references/queue-seeding.md`

5. **Read handover** — if `arsenal/session/handover.md` has content beyond the template
   placeholder, read it for the previous session's context.
   > The handover is a snapshot from compaction time, not current state. Never resume a
   > task named there without re-reading the board first — the queue is the truth.

6. **Pick up work** — `claude-arsenal/references/worker-loop.md`. If the selector returns
   nothing and a plan exists, seed the queue from it
   (`claude-arsenal/references/queue-seeding.md`); if there is no plan either, report done
   or ask the user.

   Which model runs what is the host's setting, not this file's:
   `python3 claude-arsenal/scripts/arsenal_config.py --get models.workers` is what the
   orchestrator exports as `CLAUDE_CODE_SUBAGENT_MODEL` before any dispatch. If
   `models.orchestrator` is set and is not the model you are running as, say so once —
   nothing can switch it from inside the session, so noticing is the whole of the check.

7. **Before ending a session with open work** — audit every task whose issue is claimed or
   whose PR is open (CI, reviews, mergeability), print the table for the user, then write
   `arsenal/session/handover.md`. `/session-end` does this in full; defer to it when loaded.

   This step is **reporting, not repair**. Nothing the next session needs depends on it
   running: a merged PR has already closed and archived its task, and an abandoned one has
   already released its claim. A session that ends abruptly — quota stop, crash, a closed
   window — leaves the queue correct anyway. If you ever find yourself writing "remember to
   X before the session ends", that belongs in the workflow or in a script, not here.

---

## Task format

A task is a file — `arsenal/tasks/<id>.md` — with YAML-ish front matter and a body:

````markdown
---
id: t-3f8a91c2
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

`deps` is the dependency graph, so the graph is versioned with the code and changes
through a pull request like anything else. **Task files are read from the default
branch**, never the session's working branch — that is what makes every agent compute the
same order regardless of what it is working on. `priority` encodes **task size** — S=10,
M=5, L=1, larger runs sooner — and nothing else; build order belongs in `deps`.

**The gate must be a fenced ` ```bash ` block.** Prose, and inline `single-backtick`
commands, are never executed: a gate that runs nothing passes everything. `query_status.py`
and `task_select.py` both report a task with no block, because an entire gate layer can go
inert without anyone noticing — one consumer audit found 0 of 70 payloads carried one.
→ `claude-arsenal/references/evidence-gates.md`

---

## Claiming — the contract

A claim is decided by GitHub, not by agreement between sessions: creating a ref is a
compare-and-swap, so exactly one caller wins and there is no window in which two agents
both believe they did.

```bash
bash claude-arsenal/bin/claim_task.sh <task-id>
#   won <ref>   → yours; proceed
#   lost        → someone else has it; take the next task (normal, not an error)
#   manual …    → no scriptable channel: make that exact call with your GitHub tools;
#                 201 = won, 422 = lost
#   error:      → misconfiguration; stop and surface it
```

**Never route around a `lost` or an `error`** — claiming a different ref, pushing `-u` to
give your branch its own, or bumping the attempt number to "win" recreates exactly the
double-claims this exists to prevent. Obey the result.

After winning, mark the issue so a human can see who holds it: self-assign, add
`arsenal:claimed`, and comment with the session id from `CLAUDE_CODE_REMOTE_SESSION_ID`
(a `cse_…` value that is also a session URL, so the claim is clickable), falling back to
`CLAUDE_CODE_SESSION_ID`. **Do not invent an id.**
→ `claude-arsenal/references/claiming-internals.md`

---

## Completion — merging is the update

**No step in this protocol asks anyone to finish a task.** `open_task_pr.sh` resolves the
task's issue number, writes `Closes #<issue>` into the PR body *and* the commit message,
and moves the task file into `tasks/_history/` with `status: merged` inside the same diff.
So one merge closes the issue, archives the file, and unblocks the dependents. The body
form fires on a merge into the **default** branch; the commit form survives a squash and is
what closes the issue for a **stacked** PR whose base is another branch.

If the helper refuses, it found no resolvable issue handle — a PR that would merge closing
nothing. Pass `ARSENAL_TASK_ISSUE=<n>` or create the handle with `handle_sync.py`; do not
reach for `ARSENAL_ALLOW_UNLINKED_PR=1`, which is the old silent failure, opted into.

**Merging is the one step with a configured answer.** Before merging, run
`python3 claude-arsenal/scripts/arsenal_config.py --get merge-policy` and do not merge
beyond what it allows — nor ask the user a question the host already answered there.
→ `claude-arsenal/references/github-automation.md`

---

## References — read the one you need, when you need it

Each is a plain file to open, not an import. Nothing below is in context until you read it.

| File | Read it when |
|---|---|
| `references/worker-loop.md` | Dispatching workers: the loop, worktree isolation, `worker_postcheck.sh`, per-task PRs, credit guards, every `ARSENAL_*` knob |
| `references/queue-seeding.md` | The queue is empty: seeding from a plan table, importing filed issues, seeding a `D-N` divergence |
| `references/evidence-gates.md` | Writing or trusting a gate: the fence rule, hardened execution, numeric evidence, `unmeasured` |
| `references/claiming-internals.md` | A claim misbehaves: why ref creation is the lock, attempt refs, ref accumulation, `on: push` cost |
| `references/github-automation.md` | Completion: what `merge-policy` requires, the five transitions GitHub runs, opting out |
| `references/quota-governance.md` | The loop stopped before dispatch: quota windows, fail-open, the round cap |
| `references/pre-pr-review.md` | About to open a PR: the cold-start adversarial review, its verdicts, `pre-pr-review` modes |
| `references/state-layout.md` | A lookup: where a file lives, what a task state means |
| `references/annotatable-reader.md` | Handing over a spec or plan: which documents need a reader, and why the work that consumes them waits for the annotations |
| `references/capability-map.md` | A task looks like something a skill would do: what the map says, when to volunteer an uninstalled section, and when not to |
