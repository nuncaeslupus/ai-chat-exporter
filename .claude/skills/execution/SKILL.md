---
name: execution
description: Implements a planned task test-first, through to a merge-ready PR. Use when the user is building what a plan describes. Not for one-off scripts.
metadata:
  section: workflow
  type: workflow
---

# Execution Workflow

CANARY: execution-loaded-2026-05-19-4597aff5bb98dd36

Reads `status/specification.md` and `status/plan.md` and updates the plan's task
statuses as work progresses. Per-task notes go in `tmp/<task-id>-notes.md`
(gitignored); load `references/template.md` when creating one.

Keep the notes' **Resume** section (Decided / Ruled out / Next step) current after
RED, after GREEN, and after each decision: it is what the session reads back after
context compaction.

Work through every task in the plan and on to the PR without pausing between tasks
for confirmation; stop only when blocked or before a step that is hard to undo.
Deliver the scope the plan asks for, and list pre-existing bugs and unrequested
cleanup as follow-ups in the PR description rather than fixing them in this diff.

## Steps

### Step 1: Prepare

- The design is approved and the branch is created from the default branch.
- **Where the work lives.** Run `git status --short` and check the branch. A clean
  tree on the default branch (or on a finished, unrelated branch) works in place.
  A dirty tree, an in-flight branch the user may still be using, or a long-running
  process pinned to the checkout gets a worktree, because a worktree never
  destroys state:

  ```bash
  REPO=$(git rev-parse --show-toplevel)
  TICKET=<ticket-id>
  DEFAULT=$(git -C "$REPO" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)
  git -C "$REPO" worktree add "../${TICKET}-worktree" -b "${TICKET}-short-description" "$DEFAULT"
  ```

  Run every later step from the worktree; remove it with `git worktree remove`
  once the PR merges. Ask the user only when the choice is genuinely ambiguous.
- List the files and tests to create or change, in dependency order, and read the
  surrounding code for the patterns to follow (naming, structure, error handling).

### Step 2: Implement each task — RED → GREEN → RECORD

Each task's **Gate** in `status/plan.md` is its measurable acceptance condition.

**RED.** Before changing production code, write the check that proves the gate and
see it fail for the expected reason: a regression test that reproduces the bug, a
test that specifies the missing behaviour, or, for a metric gate, the measurement
showing the current value misses the threshold. Cover new branches, endpoints and
edge cases (null/empty, boundaries, error paths). Name tests
`test_<what>_<condition>_<expected_result>`. Put a new test in a file that is not
already the suite's slowest, since the longest file sets the parallel suite's wall
clock; load `claude-arsenal:core:init § references/performance-tuning.md` (§ The
long pole) when a test file needs splitting. With `<!-- test-discipline: test-after -->` in the host `CLAUDE.md`, write
the test alongside the change instead.

A test is owed per failure mode of logic that branches, parses, has boundaries or
can lose data, not per function; a module with such logic and no test file gets one.
Write none that greps prose, re-runs a measurement a gate already runs, or pins a
constant or glue. Build an expensive fixture once per module, and give a test slower
than about a second a stated reason or a slow tier that does not run on every push.
Load `references/test-cost.md` when a task adds more than a handful of tests or one
of them is slow. When a task writes or changes a CI workflow, load
`claude-arsenal:core:init § references/ci-minutes.md` (§ CI defaults) first.

**GREEN.** Implement until the check passes:

- Read the target code first and match its style, naming and structure.
- Write the smallest change that passes the gate: needed at all → stdlib → already in
  the repo → minimal new code (`claude-arsenal:core:init § references/lean-code.md`).
- One concern per commit; type hints or strict types; handle errors explicitly;
  configuration through environment variables or constants.
- Comments: match the file's density, default to none, and add one only for a *why*
  the code cannot show (a hidden invariant, a surprising edge case). Leave task and
  PR references out of the source.
- When the fix is an API-contract mismatch (arity, kwargs, return shape), pin the
  contract on the interface itself, so the next caller making the same mistake is
  caught too.

**RECORD.** Add the gate evidence to the plan's **Evidence log**: measured value,
exact command, commit SHA and environment provenance (`ci`, `local`, or a project
tag). The `gate-check` skill's `run_gate.py --id <task> <measured>` reports PASS/FAIL. A task is done when its gate passes and the row is recorded; a
plan with no Gate column predates the convention, so skip the record there.

### Step 3: Check

Run the host repo's lint and the tests for the affected area once
(`make lint`, `make test`, `pytest <path>`, …) and fix what fails; this is the real
check behind reporting the code done. When a check cannot run here, say which and
why. Refactor with the green suite as the safety net, then confirm:

- no debug code, commented-out blocks or stray TODOs;
- no hardcoded secrets, URLs or credentials;
- the diff matches the design scope;
- the PR description says what changed, why, and how to test it.

### Step 4: Independent review

Before opening the PR, run the pre-PR review: one cold reviewer subagent that sees
only the packet. Protocol, exits and round cap:
`claude-arsenal:core:init § references/pre-pr-review.md`.

### Step 5: Create the PR

Write the description (linking the ticket or design), add reviewers, and see CI
pass. For several PRs that merge in sequence, follow the `github` skill's stacking
reference.

---

## Abbreviation

**Abbreviated execution** = Steps 2, 3 and 4, where the host repo's `CLAUDE.md`
allows it. Tests, gate evidence and the independent review stay, because
abbreviating skips ceremony, not the checks the author cannot do on their own work.

## Workspace-aware paths

When `arsenal/project/<WORKSPACE>/` exists, read `spec.md`, `plan.md` and
`context.md` from there and record gate evidence in that `plan.md`. Under the task
queue, the claimed task's payload at `arsenal/tasks/<id>.md` carries the acceptance
gate, which the queue's gate runner executes before the task is released.
