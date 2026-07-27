---
name: specify
description: When the user is investigating a problem or scoping a new feature with unclear impact — analyzes it and proposes options. Owns scripts — validate_spec. Do NOT use for already-scoped work (see design), implementation (see execution), or routine code edits.
metadata:
  type: workflow
---

# Specify Workflow

CANARY: specify-loaded-2026-06-01-7f9501625b833979

Owns sections 1–4 of `status/specification.md`: problem statement, affected systems, options, recommendation. Creates the file if it does not exist; appends/updates these sections if it does. Per-task scratch goes in `tmp/` (not committed); never in `status/`.

## Steps

### Step 1: Understand the problem

Clarify what is actually being asked. Separate symptoms from root causes.

- **What is happening?** — Observable behavior, errors, or gaps
- **What should be happening?** — Expected behavior or desired outcome
- **Since when?** — Timeline, triggers, or recent changes that may be related
- **Who is affected?** — End users, internal teams, other services, clients
- **What is the urgency?** — Blocking production, degrading performance, or planned improvement?

Output: a clear, one-paragraph **problem statement**.

Then capture **measurable success criteria** — the objective, observable conditions that will mean the work is done, each as a metric and threshold where one exists (e.g. `p95_latency_ms <= 200`, `error_rate < 0.01`, `zero data loss on replay`). These goals are what `design` turns into a per-task **Gate** and what `review` / `ship` later verify; favor numbers over "it works." Where a condition genuinely cannot be reduced to a number, state how it will be judged.

Output: a short list of **success criteria (measurable)** alongside the problem statement.

### Step 2: Identify affected systems

Map which parts of the codebase and infrastructure are involved.

- **Primary service(s)/component(s)**: where the change or fix will happen
- **Dependent systems**: services, modules, or components that consume from or feed into the primary
- **Shared resources**: databases, queues, caches, external APIs
- **Infrastructure**: cloud resources, deployment configs
- **Frontends/clients**: any UI or API consumer that surfaces the affected functionality

Trace dependencies through code, configuration, and communication patterns.

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
- **Gates check**: if the engineering-core skill is available, verify against its gates (objective, scope, impacted services, compatibility, risk, validation, release readiness)
- **Open questions**: anything unresolved that needs input before starting

Output: a clear **recommendation with action item**.

---

## Abbreviation

**Abbreviated specify** = Steps 1 + 2 (one paragraph each). Whether abbreviation is allowed depends on project conventions documented in the host repo's `CLAUDE.md`.

Load `references/template.md` when creating or updating `status/specification.md` (sections 1–4).

After writing the file, confirm its structure:

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/validate_spec.py" --input status/specification.md
```

It checks that the required sections (1–4) and the measurable Success criteria block are present and filled — shape only, not content quality. Sections 5–6 are reported as pending until `design` appends them. Exit 0 clean, 1 on a missing or unfilled required section.

## Annotatable reader

When the spec is ready for stakeholder review, generate a phone-friendly, self-contained HTML reader and an annotated Markdown copy:

```bash
uv run --with markdown python3 "${CLAUDE_SKILL_DIR}/scripts/create_reader.py"
```

Auto-discovers the spec source (workspace mode: `claude-arsenal/project/*/spec.md`; single mode: `status/specification.md`). Outputs `spec-reader.html` and `spec-annotated.md` to the output directory (next to the spec in single mode, `docs/spec-reader/` in workspace mode).

The HTML reader auto-saves notes in the browser and exports them as a Markdown file the reviewer sends back. The Markdown copy has a `> ✎ Notes` slot after every section for annotation in any text editor. To re-seed a rebuilt reader with notes from a previous export, place the returned file at `{output-dir}/notes.json`.

Override defaults when needed:

```bash
uv run --with markdown python3 "${CLAUDE_SKILL_DIR}/scripts/create_reader.py" \
    --input path/to/spec.md --output-dir docs/review --name "My Project"
```

Commit the generated files so reviewers can open the HTML directly from the repo.

## Workspace-aware paths

When `claude-arsenal/project/<WORKSPACE>/` exists, write the spec to `claude-arsenal/project/<WORKSPACE>/spec.md` instead of `status/specification.md`, and in the same pass generate a ≤200-word worker brief at `claude-arsenal/project/<WORKSPACE>/context.md` (the orientation a queue worker reads before touching the task). Otherwise use `status/` as above. The validator takes the path via `--input`; point it at whichever spec file was written.
