---
name: specify
description: Investigates a problem or an unclear-impact feature and proposes options. Use when the user has a problem to understand before building. Not for scoped work (design).
metadata:
  section: workflow
  type: workflow
---

# Specify Workflow

CANARY: specify-loaded-2026-06-01-7f9501625b833979

Owns sections 1–4 of `status/specification.md`: problem statement, affected systems, options, recommendation. Creates the file if it does not exist; appends/updates these sections if it does. Per-task scratch goes in `tmp/` (not committed); never in `status/`.

## Steps

### Step 1: Understand the problem

Clarify what is actually being asked. Separate symptoms from root causes. When the work
started in the `explore-idea` skill, take its decisions log as input: each agreed decision is
a constraint here, not a question to reopen. Cite the `I-N` ids from `status/ideas.md` the
spec covers in section 1.

- **What is happening?** — Observable behavior, errors, or gaps
- **What should be happening?** — Expected behavior or desired outcome
- **Since when?** — Timeline, triggers, or recent changes that may be related
- **Who is affected?** — End users, internal teams, other services, clients
- **What is the urgency?** — Blocking production, degrading performance, or planned improvement?

Output: a clear, one-paragraph **problem statement**.

Then list **success criteria (measurable)**: each a metric and threshold where one exists (`p95_latency_ms <= 200`, `error_rate < 0.01`), because `design` turns them into per-task Gates and `review` / `ship` verify them. Where a condition cannot be a number, state how it will be judged.

### Step 2: Identify affected systems

Map which parts of the codebase and infrastructure are involved.

- **Primary service(s)/component(s)**: where the change or fix will happen
- **Dependent systems**: services, modules, or components that consume from or feed into the primary
- **Shared resources**: databases, queues, caches, external APIs
- **Infrastructure**: cloud resources, deployment configs
- **Frontends/clients**: any UI or API consumer that surfaces the affected functionality

Output: a **dependency map** listing each system, its role, and whether it needs changes or just validation.

### Step 3: Explain impact

For each affected system, assess what happens if the change ships — and what happens if it doesn't.

- **Data impact**: stored data, integrity, or data flows?
- **API impact**: public or internal API contracts? Requires versioning?
- **Performance impact**: latency, throughput, or resource usage?
- **User impact**: will end users or API clients notice? Will they need action?
- **Operational impact**: deployment coordination, monitoring changes, runbook updates?
- **Risk if nothing changes**: cost of inaction?

Output: an **impact assessment** with severity (Low / Medium / High) per dimension.

### Step 4: Propose options

Present 2-3 viable approaches. For each:

- **Description**: what the approach does in plain language
- **Scope**: which services and files are touched
- **Effort**: Small / Medium / Large
- **Tradeoffs**: pros and cons (technical debt, risk, maintainability)
- **Compatibility**: backwards compatible? Requires API versioning?
- **Dependencies**: infrastructure changes, team coordination, client notification?

Always include at least one conservative option (minimal change, lowest risk)
and one option that addresses the root cause more thoroughly.

Output: a **comparison table** of options.

### Step 5: Recommend next step

- **Recommended option**: which and why
- **Immediate next action**: first thing to do (e.g., "create branch, start with migration in service X")
- **Gates check**: if the host repo has an engineering-standards skill, verify against its gates (objective, scope, impacted services, compatibility, risk, validation, release readiness)
- **Open questions**: anything unresolved that needs input before starting
- **Decisions log**: when the work came from `explore-idea`, carry its `D-N` rows here unchanged — superseded rows included

Output: a clear **recommendation with action item**.

---

## Abbreviation

**Abbreviated specify** = Steps 1 + 2 (one paragraph each), where the host repo's `CLAUDE.md` allows it.

## Write and check the file

Load `references/template.md` when creating or updating `status/specification.md` (sections 1–4), then confirm its structure:

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/validate_spec.py" --input status/specification.md
```

It checks shape only: sections 1–4 and the Success criteria block present and filled (5–6 stay pending until `design`). Exit 1 names what is missing.

Then self-review the spec before the reader is generated, and fix what fails:

- **No placeholders** — no `TBD`, `TODO`, `...` or template text left in any section.
- **No contradictions** — the recommendation, the options and the success criteria agree.
- **No ambiguous requirement** — each criterion reads one way; "fast" or "robust" gets a number or a stated judgment.
- **Scope fits one plan** — independent subsystems become separate specs.
- **Nothing dropped** — every decision and constraint from the source conversation, the decisions log included, is still in the spec; diff a rewrite against the conversation, not the previous draft.

Draw any picture as a fenced `drawspec` block: `claude-arsenal:core:init § references/diagrams.md`.

## Annotatable reader — before the spec is merged or built on

Once the validator passes, generate the reader and give the user the HTML in the same
reply, so their notes attach to the section they are about. Proceeding without
annotations needs the reviewer to say so.

```bash
create_reader.py   # in claude-arsenal/scripts/; run via `uv run --with markdown python3`
```

It finds the spec (`arsenal/project/*/spec.md` or `status/specification.md`), writes
`<repo>-spec-v<N>-<date>-reader.html` and `…-annotated.md` beside it, and prints both paths; commit
them. Load `claude-arsenal:core:init § references/annotatable-reader.md` when a
returned notes export arrives, when recording approval, or when another document
needs a reader.

For a user-facing problem, ask once at the start whether a screens review (annotated
screenshots, same reader) would help; when yes, or when the user asks for screenshots,
load that reference's screens section.
