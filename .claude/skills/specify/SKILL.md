---
name: specify
description: When the user is investigating a problem or scoping a new feature with unclear impact — analyzes it and proposes options. Owns scripts — validate_spec. Do NOT use for already-scoped work (see design), implementation (see execution), or routine code edits.
metadata:
  section: workflow
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

## Annotatable reader — required before the spec is merged or built on

Generate the reader once the validator passes, and hand both files to the user in the
same reply. This is not optional and chat is not a substitute: a spec the reviewer cannot
annotate ends up reviewed in chat, where the notes scroll away unattached to the section
they were about. Proceeding without annotations needs the reviewer to say so, explicitly
— it is never an inference from their silence or from the reader being inconvenient:

Run `create_reader.py` (in `claude-arsenal/scripts/`; it imports `markdown`, which
`uv run --with markdown python3` supplies):

```bash
create_reader.py
```

It auto-discovers the source (workspace mode: `arsenal/project/*/spec.md`; single mode:
`status/specification.md`) and writes `spec-reader.html` and `spec-annotated.md` beside it
— `docs/spec-reader/` in workspace mode. Both paths are printed; the step is done when
those two paths exist and the user has been given the HTML, not merely told where it is.
Add `--name "My Project"` to override the reader title.

The HTML reader auto-saves notes in the browser and exports them as a Markdown file the
reviewer sends back, named `<project>-spec-notes-<date>.md` so it stays findable among
whatever else is in a Downloads folder. The Markdown copy has a `> ✎ Notes` slot after
every section for annotation in any text editor. To re-seed a rebuilt reader with notes
from a previous export, pass `--notes <the returned file>` — the export carries its own
note data, so hand back the file the reviewer sent, unrenamed.

When a returned export arrives — a path in `~/Downloads`, an upload, a paste — move it
into the spec's directory beside the reader and commit it. The annotations are review
history for this spec; left in Downloads they are gone by the next session.

Commit the generated files so reviewers can open the HTML directly from the repo.

Full rules — which documents need one, the naming, and why the work that
consumes the document waits for the annotations:
`claude-arsenal:core:init § references/annotatable-reader.md`.
