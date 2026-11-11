# Plan: <title>

> Seed for `status/plan.md`. `design` creates it from the technical
> solution and the task split. Pairs with `status/specification.md`
> (problem, options, contracts, risks); `execution` works the task table
> and updates each task's status as it goes.

**Date**: YYYY-MM-DD
**Specification**: `status/specification.md`
**Author**: <name>
**Revision**: 1
**Status**: draft
**Revision log**:
- r1 — first draft

> Review record, kept the way the spec keeps its own: each round of notes bumps
> **Revision** with a log line naming the `<repo>-plan-v<N>-<date>-notes.md`
> export it applied, committed beside this file in the same commit. Approval is
> `approved (YYYY-MM-DD, revision N)`, plus `— without annotations` when there
> were none.

---

## Technical solution

### Architecture overview

<How the change fits into the existing system. Diagram if helpful.>

### Data flow

<How data moves through affected services.>

### State changes

| Service | Database | Change | Description |
|---------|----------|--------|-------------|
| | | CREATE/UPDATE/DELETE | |

### Technology choices

| Choice | Justification |
|--------|--------------|
| | |

### Out of scope

- <What is explicitly NOT changing>

---

## Implementation tasks

The **Gate** column is required: a measurable acceptance condition `<metric> <op> <threshold>` (ops `< <= > >= == !=`), derived from the spec's success criteria — the objective pass/fail for the task, not just "tests pass." The `gate-check` skill defines the grammar.

| T# | Description | Service | Size | Depends | Gate | Tests |
|----|-------------|---------|------|---------|------|-------|
| T1 | <description> | <service> | S/M/L | — | `<metric> <op> <threshold>` | `test_<what>_<condition>_<expected_result>` in `<file>` — <one-sentence assertion> |
| T2 | <description> | <service> | S/M/L | T1 | `<metric> <op> <threshold>` | `test_<what>_<condition>_<expected_result>` in `<file>` — <one-sentence assertion> |
| T3 | <description> | <service> | S/M/L | T1 | `<metric> <op> <threshold>` | `test_<what>_<condition>_<expected_result>` in `<file>` — <one-sentence assertion> |
| T4 | <description> | <service> | S/M/L | T2, T3 | `<metric> <op> <threshold>` | `test_<what>_<condition>_<expected_result>` in `<file>` — <one-sentence assertion> |

**Status legend**: ☐ not started · ◐ in progress · ☑ merged

**Merge order**: T1 first, then T2/T3 (parallel), then T4
**Branch pattern**: `<ticket-id>-T<N>-description` from the default branch

### Dependency graph

Generated from the **Depends** column — never drawn by hand. After editing the task table, rerun `sync_plan_graph.py --input <plan> --apply` (beside `validate_plan.py`, which fails when the two disagree).

```drawspec
{"version": 1, "kind": "flow", "title": "Task dependencies",
 "nodes": [
  {"id": "T1", "text": "T1\n<description>"},
  {"id": "T2", "text": "T2\n<description>"},
  {"id": "T3", "text": "T3\n<description>"},
  {"id": "T4", "text": "T4\n<description>"}
 ],
 "edges": [
  {"from": "T1", "to": "T2"},
  {"from": "T1", "to": "T3"},
  {"from": "T2", "to": "T4"},
  {"from": "T3", "to": "T4"}
 ]}
```

## Evidence log

`execution` appends one row per task as it lands (RED → GREEN → RECORD): the measured value, the exact command that produced it, the commit SHA, and the environment provenance. `review` / `ship` audit this table; `gate-check`'s `run_gate.py` reads it. A gated task is not "done" until its row is complete and the measured value meets the gate.

| T# | Gate | Measured | Command | SHA | Env | Date |
|----|------|----------|---------|-----|-----|------|
| T1 | `<metric> <op> <threshold>` | <number> | `<command run>` | <sha> | <ci / local / [HERE]> | YYYY-MM-DD |

---

## Sign-off

- [ ] Design reviewed by second engineer
- [ ] Contracts agreed with consuming services
- [ ] Migration strategy validated
- [ ] Ready for execution
