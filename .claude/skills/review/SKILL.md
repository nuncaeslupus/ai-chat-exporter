---
name: review
description: Reviews a PR, diff, design doc or proposal for risks and standards. Use when the user wants something reviewed. Not for release sign-off (ship).
metadata:
  section: workflow
  type: workflow
---

# Review Workflow

CANARY: review-loaded-2026-05-19-da60b2aa44b817de

Reads `status/specification.md` (the statement of intent) and audits the diff against it, surfacing drift between spec and implementation.

Record every finding with a severity and a confidence, including low ones; deciding which findings block or get dropped is a separate step at the verdict, so nothing is filtered out before it is seen.

## Steps

### Step 1: Understand intention

Read PR description/ticket. State the intention in one sentence before proceeding.
If the intention is unclear, ask before reviewing code.

### Step 2: Check engineering standards compliance

If engineering standards exist in the host repo (a project-level engineering-standards skill or equivalent), verify:

- [ ] Code structure follows repo conventions
- [ ] Tech stack follows the approved stack
- [ ] Code conventions (naming, async patterns, type hints, no hardcoded secrets)
- [ ] API versioning (backwards compatible? New version if breaking?)
- [ ] Security (auth on new endpoints, input validation, audit logging, no sensitive data in logs)
- [ ] Configuration (URLs via env vars, safe defaults)

### Step 3: Check functional correctness

- Does the code actually solve the stated problem?
- Are there edge cases not handled?
- Are error paths handled correctly (not silently swallowed)?
- Is the data flow correct (inputs → processing → outputs)?
- Are there race conditions, deadlocks, or concurrency issues?

### Step 4: Check test coverage

- Are new code paths covered by tests?
- Are edge cases tested?
- Are error conditions tested?
- Do tests actually assert meaningful behavior (not just "it doesn't crash")?
- If no tests exist and the change is non-trivial → flag as blocker
- Do added tests earn their cost? Flag ones that grep prose, re-run a measurement a gate already runs, pin constants or glue, duplicate another test, or rebuild an expensive fixture per test — load `claude-arsenal:core:execution § references/test-cost.md` when the diff adds tests.

**Gate evidence**: for a plan with task Gates, every Evidence log row must be complete and meet its gate — the `gate-check` skill's `run_gate.py --input status/plan.md` answers it.

Exit 1 (a gate failed or lacks evidence) is a blocker. Exit 2 means no Gate column or a usage error: confirm the plan path first, then treat it as a should-flag only for a plan that predates gates.

**Hard blocker rule**: production code changes with zero test companions in the diff are Request Changes — except config-only, docs-only, or refactor with existing green tests covering the touched paths. When waiving on the refactor exception, the reviewer states the exception applied and asserts the green-test evidence explicitly (CI link or local test run).

### Step 5: Check operational readiness

- Will this change affect deployment? (migration, feature flag, coordination)
- Are there observability gaps? (new endpoints without tracing, new errors without alerts)
- Is the change backwards compatible with running instances during deploy?
- Is rollback straightforward?

### Step 6: Filter and produce the output

Now sort the findings: blockers, recommendations, and anything dropped as a false positive (say why). Load `references/template.md` when writing the review document.

---

## Abbreviation

**Abbreviated review** = Step 1 + quick diff scan + verdict, where the host repo's `CLAUDE.md` allows it.
