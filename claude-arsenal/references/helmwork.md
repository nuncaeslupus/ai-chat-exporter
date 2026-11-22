# Helmwork — the working method behind this bundle

Open this when planning a milestone, building or changing a tool, deciding what to put in
front of the person, or after the person corrects something. It is principles and rules,
not procedure: the skills and the other references carry the procedure.

**In one sentence:** the person brings ideas, decides and corrects; the AI builds, tests
everything it can, and shows what is doubtful with evidence; tools make both fast,
repeatable and checkable.

## The pieces

| Piece | What it is | Where it lives |
|---|---|---|
| **Helmwork** | This file: how to work with AI on any project. Text only. | `claude-arsenal/references/helmwork.md`, summarised in `AGENTS.md`. |
| **Review pages** | One self-contained HTML page per review: the person comments in place, compares side by side, gives verdicts, and exports the notes back. Deliberately light. | The annotatable reader today (`claude-arsenal/references/annotatable-reader.md`), growing into a planned `proofsheet` skill (not shipped yet). |
| **Rich review tool** | Region drawing, pixel-level marking, audio spans, an issue system: what a page should not attempt. | Its own project, outside this bundle. |
| **Domain kits** | Skills, checks and small viewers for one domain. | Optional bundle sections, switched on only where needed; heavy code stays in its own repository and the section drives it. |

## Principles

1. The person ideates, decides and corrects; the AI does and verifies.
2. Every result reaches the person with evidence and a concrete improvement, where they
   are looking at it.
3. Every mistake teaches: what was corrected does not happen again.
4. Context and cost (tokens, compute, money, human time) are measured and reduced without
   losing quality.
5. Generic tools with domain plugins, not one-off tools.

## The work cycle

1. **Idea.** Stated however it comes; the AI asks the minimum and logs decisions
   (`explore-idea`).
2. **Specification.** What and why, approved through an annotatable page (`specify`).
3. **Plan and tasks.** Each task has an executable acceptance gate (`design`).
4. **Build.** Tests are mandatory (`execution`).
5. **Evidence review.** Mandatory like tests. The AI uses the finished result the way a
   person would, at scale: runs it, walks through it, tries to break it, samples outputs.
   What works is summarised; each doubtful case carries proof (screenshot, audio, excerpt
   or diff), severity and a proposed fix.
6. **Verdict.** The person marks each item fine / fix / not a bug. Verdicts are stored and
   feed the checks.

**Cadence — evidence review does not interrupt agent work.** Agents iterate freely inside
a task; automatic checks run every iteration. Each PR carries only what the checks could
not decide. A consolidated evidence page goes out at milestones (end of a plan phase, a
release candidate) or on request. Only a milestone waits for verdicts; ordinary tasks keep
merging with their open items queued.

**Where open items wait — in the repository, never only in a conversation.** Each PR
appends its open items, in the shared issue format, to one file in the repository with
their evidence beside it, so they merge with the PR. The milestone page is generated from
that file, verdicts are written back and close the items, and the board shows the open
count. A GitHub-issue copy is optional, never the source of truth.

No milestone closes without a reviewed evidence page, as no task closes without green tests.

## Rules for the person and the AI

1. **Human time is the scarce resource.** Decide what a reasonable, reversible default
   covers, write it down, continue. Ask only about irreversible actions and taste.
2. **Decisions in batches, options side by side** — never an open question when options
   can be shown.
3. **Decision log.** Every taste or direction decision is written down with its reason and
   read before proposing, so nothing decided is asked twice.
4. **Preferences become rules**, personal (the user's global instructions or memory) or
   project (a style profile in the repository, checked by tools). A correction made twice
   moves out of conversation into one of them.
5. **Prototype fast, produce properly.** Anything used repeatedly becomes a tested tool.
6. **Periodic step back.** At milestones, ask whether the work still serves the goal, and
   say so when it does not.
7. **Comment in place, not afterwards** — where the person is looking, never a long report
   written from memory.
8. **Learn from every mistake.** Every failure (AI, tool or process) leaves a test, a check,
   a rule or a skill change. Triggers: the person corrects something; a PR is opened or
   merged; a milestone closes. A repeated mistake is a system failure, not a personal one.

## Rules for software

**Built for an AI to use, shown to a person.**
- Library first, CLI on top, UI as a viewer: anything possible in a UI is possible from the
  CLI. An MCP server is an optional thin adapter, never the only way in.
- Non-interactive CLI: arguments only, stable `--json` output, meaningful exit codes,
  `--dry-run` for anything that changes state, idempotent.
- Self-describing: commands and schemas listed as JSON, an agent guide of workflows, doc
  examples that run as tests.
- Errors say what failed, where, and the command that probably fixes it.
- Headless: runs without a screen; when something must be seen, the tool renders it.

**State as text, changes with history.** Text formats in git; no operation destroys
without history; versioned schemas with automatic migration.

**Reproducible and regenerable.**
- Provenance on everything generated: inputs, tool and version; model, prompt, seed and
  settings; the agent and model that produced or approved it, with session id — so later
  models can re-audit past work.
- One command regenerates, rebuilding only what changed. Deterministic where possible;
  what is not is marked.

**The quality ladder.** Script → automatic checks → the AI fixes → the person approves or
edits. Each rung only receives what the previous one could not resolve. Providers (local
compute, a paid API, a person) are swappable and each step's cost is recorded.

**Checks and evidence.**
- Every quality rule is an executable check with severity, location and evidence, tested
  against known good and bad examples.
- One issue format for every tool: what, where, evidence, severity, confidence, proposed
  fix, human verdict.
- Verdicts teach: "not a bug" suppresses the case and tunes the check; "fix" becomes a
  regression test.
- What the person approves becomes the baseline; later changes reach them as a diff.

**Generic core, project by configuration.** The core knows no project; style, rules and
paths are configuration. Standard interchange formats. Small tools that compose through a
manifest and the shared issue format. Extensible by documented plugin contracts.

**Speed.** Checks and previews take seconds; long jobs are asynchronous, show progress,
resume and block nothing. Previews look like the final product in its real context.

**Context and cost.**
- On-demand information: what is always loaded is minimal and justified; the rest lives in
  references with a "read it when" index.
- Measure that skills work: trigger evals, result evals, token cost, and a report of what
  was loaded but unused, so it can be pruned.
- Tokens are budgeted like compute: scripts before AI, cheap models for mechanical work,
  summaries not dumps, nothing already known re-read.

**Quality of the software itself.** Tests, executable gates, a PR for everything. No secrets
in repositories; model and asset licences checked and recorded; no user data sent to
external services without permission.

## Naming

Only what is cited on its own gets a name. Inside this bundle things are named by what
they do, like every other skill; domain kits are sections named for their domain.
