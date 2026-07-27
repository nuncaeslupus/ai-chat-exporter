---
name: execution
description: When the user is implementing code changes from a design — code change, tests, merge-ready output. Do NOT use for investigation (see specify), design (see design), or routine one-off scripts that bypass the design step.
metadata:
  type: workflow
---

# Execution Workflow

CANARY: execution-loaded-2026-05-19-4597aff5bb98dd36

Reads `status/specification.md` and `status/plan.md`. Updates `status/plan.md` task statuses as work progresses. Per-task notes (decisions, deviations) go in `tmp/<task-id>-notes.md` (gitignored by the host repo, never committed).

Load `references/template.md` when writing `tmp/<task-id>-notes.md` for a task.

## Steps

### Step 1: Prepare implementation plan

#### 1a. Verify prerequisites
- [ ] Design document exists and is approved
- [ ] Engineering gates are complete (if applicable)
- [ ] Workspace chosen (see 1a.1)
- [ ] Branch created from the default branch in the chosen workspace
- [ ] Local environment running (if applicable)

#### 1a.1 Workspace — main checkout or worktree?

Before creating the branch, decide where the work lives. From the repo root, run `git status --short` and check the current branch:

- **Clean tree on the default branch** → work in the main checkout. Create the branch in place.
- **Clean tree on an unrelated branch** that the user is no longer touching (confirm if unsure) → fast-forward to the default branch and continue in the main checkout.
- **Dirty tree, OR an in-flight branch the user might still be working on, OR a long-running stack (container, dev server, watcher) pinned to the main checkout path** → do NOT switch the main checkout's HEAD. Create a worktree instead:

  ```bash
  REPO=$(git rev-parse --show-toplevel)
  TICKET=<ticket-id>
  DEFAULT=$(git -C "$REPO" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)
  git -C "$REPO" worktree add "../${TICKET}-worktree" -b "${TICKET}-short-description" "$DEFAULT"
  ```

  Then run all subsequent steps (branch, commits, tests, PR) from that worktree path. When in doubt, prefer creating the worktree: it never destroys state. Ask the user only when the path is genuinely ambiguous (e.g. they may want to abandon the in-flight branch).

  For container-bound work, the container has to be rebound to the worktree path; consult the host repo's container / compose documentation for the exact recipe.

Remove the worktree with `git worktree remove <worktree-path>` once the PR is merged.

#### 1b. Review task scope
- What files will be created or modified (list before starting)
- What tests will be created or modified
- What order to implement (dependencies first)

#### 1c. Identify existing patterns
- Read existing code in affected files/services
- Identify patterns to follow (naming, structure, error handling)
- Note any deviations from standard patterns and why

### Step 2: Implement each task — RED → GREEN → RECORD

For each task from the design, work its **Gate** (the measurable acceptance condition in `status/plan.md`) through three motions: make the gate fail first (RED), implement until it passes (GREEN), then record the evidence (RECORD) before starting the next task.

#### 2a. Make the gate fail first (RED)

Before changing production code, write the check that proves the task meets its Gate, and confirm it currently fails for the expected reason:

- **Bug fix**: write a regression test that reproduces the failure first. Run it and confirm it fails for the expected reason — the bug itself, not an unrelated error.
- **New feature**: write a test that specifies the contract or acceptance criterion the task must satisfy. Run it and confirm it fails because the behavior does not exist yet.
- **Metric gate**: wire the measurement the gate names (latency benchmark, coverage run, error-rate probe) and confirm the current value misses the threshold — a measured value short of the gate is the RED for a metric, just as a failing test is the RED for behavior.
- **Coverage**: unit tests for new functions and logic branches; integration tests for new endpoints, queries, or inter-service calls; edge cases for null/empty inputs, boundary values, and error conditions.

Name each test with the convention `test_<what>_<condition>_<expected_result>`.

If the host repo's `CLAUDE.md` contains `<!-- test-discipline: test-after -->`, write the test alongside the change instead.

#### 2b. Implement to green

1. **Read before writing**: always read the existing code in the target file/module first
2. **Follow existing patterns**: match the style, naming, and structure of surrounding code
3. **One concern per change**: each commit should do one thing
4. **Type safety**: use type hints (Python) or strict types (TypeScript)
5. **Error handling**: handle errors explicitly, never silently swallow exceptions
6. **No hardcoded values**: configuration via environment variables or constants
7. **Comments**: match the file's existing comment density and docstring style. Default to no comment. Earn one only when the *why* is non-obvious — a hidden invariant, a non-obvious edge case, a workaround for a specific bug, behavior that would surprise the reader. Don't explain *what* the code does (well-named identifiers handle that). Don't reference the current task, PR, or caller — that belongs in the PR description, not the source, and rots as the codebase evolves. Multi-line comments (3-4 lines or more) need genuinely unexpected behavior the code cannot convey on its own.
8. **Re-run the test from 2a (or the test written alongside the change under `test-after`); do not proceed until it passes.**

After each significant change:
- Run linting (use the host repo's lint command — e.g. `make lint`, `ruff check`, `eslint`)
- Run relevant tests (use the host repo's test command — e.g. `make test`, `pytest <path>`)
- Fix issues before proceeding

#### 2c. Record the gate evidence (RECORD)

Once the task is green, record its gate evidence in `status/plan.md`'s **Evidence log** before starting the next task: the measured value, the exact command that produced it, the commit SHA, and the environment provenance (which machine or runner — `ci`, `local`, or a project tag). Confirm the measured value meets the gate; the `gate-check` skill's `run_gate.py --input status/plan.md --id <task> <measured>` reports PASS/FAIL with the numbers and flags an incomplete row. A task is not done until its gate passes and its evidence is recorded — that recorded trail is what `review` and `ship` audit. (For a plan with no Gate column — predating this convention — keep the green-tests bar from Step 2b and skip the record.)

### Step 3: Verify and refactor

Re-run the full lint and test suite for the affected area. With the test from 2a green as a safety net, refactor for clarity — rename, extract, deduplicate — re-running the tests after each step to confirm nothing breaks.

- **API-contract bugs lock the regression at the API level**: when the fix is a signature mismatch — wrong arity, wrong kwargs, wrong return shape — the regression test asserts the API contract on the interface itself (the logger's signature, the emitter's signature, the HTTP client's response shape), not just the one call site that triggered the report. A test that pins the contract catches the next caller that makes the same mistake, before it reaches production.

### Step 4: Self-review before PR

Before creating the PR, verify:

- [ ] All tests pass
- [ ] Linting passes with no warnings
- [ ] No debug code, commented-out blocks, or TODO items left behind
- [ ] No hardcoded secrets, URLs, or credentials
- [ ] Changes match the design scope (no scope creep)
- [ ] PR description prepared: what changes, why, how to test

### Step 5: Create PR

- Write clear PR description linking to ticket/design
- Add reviewers
- Ensure CI passes
- **When opening multiple PRs in a planned sequence**, follow the stacking rule in `github` — branches must stack, and only the last PR in the sequence bumps `.bundle-version`.

---

## Abbreviation

**Abbreviated execution** = Step 2a + Step 2b + Step 2c + Step 4 (tests and gate evidence are not optional in abbreviation). Whether abbreviation is allowed depends on project conventions documented in the host repo's `CLAUDE.md`; that same file can declare `<!-- test-discipline: test-after -->` to fall back to write-tests-after (see Step 2a).

## Workspace-aware paths

When `claude-arsenal/project/<WORKSPACE>/` exists, read the spec and plan from there (`spec.md`, `plan.md`, `context.md`) and record gate evidence in the workspace's `plan.md` instead of `status/`. Otherwise read `status/specification.md` and `status/plan.md` as above. When running under the task queue, the claimed task's payload at `claude-arsenal/queue/<id>.md` carries the acceptance gate, which the queue's gate runner executes before the task is released.
