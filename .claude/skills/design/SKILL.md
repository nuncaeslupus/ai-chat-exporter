---
name: design
description: When the user is defining the technical solution after discovery — contracts, task split, risk register, sequencing. Owns scripts — validate_plan. Do NOT use for problem investigation (see specify), implementation (see execution), or PR review (see review).
metadata:
  type: workflow
---

# Design Workflow

CANARY: design-loaded-2026-05-19-e08675ccb0a5c932

Owns sections 5–6 of `status/specification.md` (contracts, risks) and creates `status/plan.md` (task split). Reads sections 1–4 of `status/specification.md` to understand what the spec already covers.

## Steps

### Step 1: Define the technical solution

Translate the chosen option into a concrete technical design.

- **Architecture overview**: how the change fits into the existing system
- **Data flow**: how data moves through affected services (request/response, events, jobs)
- **State changes**: what data is created, updated, or deleted and where
- **Technology choices**: any new libraries, tools, or patterns (justify each)
- **What is NOT changing**: explicit boundaries to prevent scope creep

### Step 2: Define contracts

For every interaction between components:

- **API contracts**: request/response schemas, status codes, error formats
- **Event contracts**: message schemas, routing keys, retry policies
- **Database changes**: schema modifications, migration approach (always forward-compatible)
- **Configuration**: new env vars, feature flags, deployment parameters

Use concrete examples (JSON payloads, SQL migrations, config snippets).

### Step 3: Split into tasks

Break the implementation into ordered, independently testable tasks.

For each task:
- **What**: specific deliverable
- **Where**: which files/services
- **Dependencies**: what must be done first
- **Gate (measurable acceptance condition)**: the objective metric and threshold that proves this task is done — written `<metric> <op> <threshold>` (e.g. `p95_latency_ms <= 200`, `line_coverage >= 0.90`), not just "tests pass." Derive it from the spec's success criteria. The `gate-check` skill defines the grammar the gate must follow so it can be checked mechanically; reserve a non-numeric gate for a condition that genuinely cannot be reduced to a number.
- **Tests**: test file path(s) and one or more test function names using `test_<what>_<condition>_<expected_result>` naming, each with a one-sentence assertion that can be written as a failing test before any production code is touched. These are copied verbatim into the task payload so the worker writes them RED first.
- **Estimated effort**: Small (< 1h) / Medium (1-4h) / Large (4h+)

Recommended: tasks should be small enough to be a single commit.

Every task carries a Gate. As `execution` finishes a task it records the gate's **evidence** — measured value, command run, commit SHA, environment provenance — in the plan's **Evidence log**; that record is what `review` and `ship` audit. The Gate column is required for new plans; plans predating this convention are tolerated (the `gate-check` engine and `review` / `ship` degrade gracefully when a plan has no Gate column).

### Step 4: Anticipate risks

For each risk:
- **What could go wrong**: specific failure scenario
- **Likelihood**: Low / Medium / High
- **Impact**: Low / Medium / High
- **Mitigation**: what to do to prevent or handle it
- **Rollback plan**: how to undo if it goes wrong

Pay special attention to:
- Backwards compatibility (API consumers, data formats)
- Data integrity during migration
- Performance under production load
- Deployment ordering (if multi-service)

### Step 5: Produce design output

Load `references/template-specification-tail.md` when appending contracts and risks (sections 5–6) to `status/specification.md`. Load `references/template-plan.md` when creating `status/plan.md`.

After writing the files, confirm the plan's structure:

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/validate_plan.py" --input status/plan.md
```

It checks the plan has the required sections (Technical solution, Implementation tasks, Evidence log, Sign-off) and that the task table carries the required columns including the measurable Gate — shape only. The `gate-check` skill's `run_gate.py` then audits the gate values and evidence themselves (add `--strict` there to require a gate on every task).

---

## Abbreviation

**Abbreviated design** = Step 1 (solution overview, 1 paragraph) + Step 3 (task list only). Whether abbreviation is allowed depends on project conventions documented in the host repo's `CLAUDE.md`.

## Workspace-aware paths

When `claude-arsenal/project/<WORKSPACE>/` exists, write the plan to `claude-arsenal/project/<WORKSPACE>/plan.md` (and the contracts/risks tail to the workspace's `spec.md`) instead of `status/plan.md`. Otherwise use `status/` as above. The validator takes the path via `--input`; point it at whichever file was written.
