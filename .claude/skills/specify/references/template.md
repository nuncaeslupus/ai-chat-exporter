# Specification: <title>

> Seed for `status/specification.md`. `specify` owns sections 1–4 below.
> `design` later appends sections 5–6 (contracts, risks) — see
> `template-specification-tail.md` in the design skill. Keep the file
> committed; per-task scratch belongs in `tmp/`, never here.

**Date**: YYYY-MM-DD
**Ticket / PR**: <id>
**Author**: <name>

---

## 1. Problem statement

<One clear paragraph describing what is happening, what should happen, and why it matters.>

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

---

> Sections 5–6 (contracts, risks) are appended by `design`.
