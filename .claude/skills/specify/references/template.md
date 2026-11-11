# Specification: <title>

> Seed for `status/specification.md`. `specify` owns sections 1–4 below.
> `design` later appends sections 5–6 (contracts, risks) — see
> `template-specification-tail.md` in the design skill. Keep the file
> committed; per-task scratch belongs in `tmp/`, never here.

**Date**: YYYY-MM-DD
**Ticket / PR**: <id>
**Author**: <name>
**Revision**: 1
**Status**: draft
**Revision log**:
- r1 — first draft

> Review record. Each round of reviewer notes makes a new revision: bump
> **Revision**, add a log line naming the export it applied
> (``- r2 — applied `<repo>-spec-v1-<date>-notes.md` ``), and commit that
> export beside this file in the same commit. On approval set
> **Status** to `approved (YYYY-MM-DD, revision N)` and, when the reviewer sent
> no notes for that revision, add `— without annotations`.

---

## 1. Problem statement

<One clear paragraph describing what is happening, what should happen, and why it matters.>

**Ideas covered**: <I-N ids from `status/ideas.md`, when the work came from `explore-idea`; otherwise delete this line>

**Success criteria (measurable)** — the objective conditions that define "done"; each seeds a task **Gate** in the plan (`design`), and `review` / `ship` verify them:

- [ ] `<metric> <op> <threshold>` (e.g. `p95_latency_ms <= 200`, `line_coverage >= 0.90`)
- [ ] `<metric> <op> <threshold>`
- [ ] <condition that cannot be reduced to a number — state how it will be judged>

## 2. Systems & Impact

| System | Type | Role | Needs changes? | Impact | Severity |
|--------|------|------|----------------|--------|----------|
| <service> | Primary | <what it does in this context> | Yes / No | <description> | Low / Med / High |
| <service> | Dependent | <what it does in this context> | Yes / No | <description> | Low / Med / High |
| <database> | Shared resource | <what it stores> | Yes / No | <description> | Low / Med / High |
| <frontend> | UI | <what it surfaces> | Yes / No | <description> | Low / Med / High |
| <infra-component> | Infrastructure | <if applicable> | Yes / No | <description> | Low / Med / High |

**Impact dimensions to consider**: Data, API contracts, Performance, User-facing, Operational, Risk of inaction.

## 3. Options

### Option A: <name> (Conservative)

- **Description**: ...
- **Scope**: ...
- **Effort**: Small / Medium / Large
- **Tradeoffs**: ...
- **Compatibility**: ...

### Option B: <name> (Recommended)

- **Description**: ...
- **Scope**: ...
- **Effort**: Small / Medium / Large
- **Tradeoffs**: ...
- **Compatibility**: ...

### Option C: <name> (if applicable)

- **Description**: ...
- **Scope**: ...
- **Effort**: Small / Medium / Large
- **Tradeoffs**: ...
- **Compatibility**: ...

### Comparison

| | Option A | Option B | Option C |
|---|---|---|---|
| Effort | | | |
| Risk | | | |
| Completeness | | | |
| Compatibility | | | |
| Maintenance | | | |

## 4. Recommendation

**Recommended option**: Option X — <reason>

**Immediate next action**: <specific first step>

**Open questions**:
- [ ] ...

**Decisions log** (carried unchanged from `explore-idea`; delete this block when the spec did not start there):

| ID | Decision | Status | Date |
|----|----------|--------|------|
| D-1 | <what was decided> | agreed / open / superseded by D-N | YYYY-MM-DD |

---

> Sections 5–6 (contracts, risks) are appended by `design`.
