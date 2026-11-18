# Claude Arsenal

<!-- claude-arsenal v5.26.0 — imported via @claude-arsenal/AGENTS.md -->

This file is in context on every turn, so it holds only what a session needs before it
knows what kind of session it is. The rest lives in `claude-arsenal/references/`: plain
paths, opened on demand (table at the end).

Paths starting `arsenal/` are the host-owned tree; setting `ARSENAL_HOME` relocates all of
them. `claude-arsenal/` is the vendored bundle and never moves.

---

## How to work

- **Finish the task.** On an unattended run, carry the work through to its end; put status
  notes alongside the next tool call rather than ending the turn on them. Stop only when
  blocked or before a risky or irreversible action. When the request is a question or a
  problem description, the assessment is the deliverable — answer it before changing code.
- **How often to ask** is `autonomy` in `arsenal/config.toml`: `ask-often` (confirm each step),
  `ask-when-blocked` (default), `autonomous` (never wait on the user for reversible work).
- **Reports lead with the outcome.** Add sections (done / not done / questions / next) only
  when they have content, and keep the whole report short.
- **Batch independent tool calls** into one response; sequence only calls that depend on
  each other.
- **Edit surgically.** Change the lines that need changing rather than rewriting a file.
- **Name tasks by label.** When you mention a task to the user, write its label followed by
  the id, e.g. `tag only green CI (t-1a2b3c4d)`; a bare id tells them nothing.

---

## Session-start protocol

At the start of every session (fresh start, context compaction, or cold restart):

0. **Refresh the bundle.**
   a. If `claude-arsenal/bin/check_update.sh` exists, run it with `--check-only` (without
      it the script merges and commits) and surface what it reports. An
      `UNTAGGED UPSTREAM RELEASE` is fixed upstream (`make tag`), not here. On a
      non-subtree install the report is `INERT` — the expected answer: say so once per
      session and open no work on it.
   b. Run `python3 .claude/skills/init/scripts/init.py --repo-path . --silent` and report
      anything it refreshes, and each `NEW SETTING` line once (`config-acknowledged` in
      `arsenal/config.toml` silences them). On `SETUP INTERVIEW PENDING`, ask the init skill's
      setup interview with AskUserQuestion before picking up work. If it says the installed
      bundle is newer, report that and update the plugin; never pass `--allow-downgrade`. Skip (b) if (a) reported
      `VENDORED SKILL BEHIND BUNDLE`. Skip (a) and (b) when the script is absent.
   c. Read the capability map: `python3 .claude/skills/init/scripts/init.py --list-sections`.
      When a task is squarely covered by a section this repo did not install, say so once,
      then do what was asked. → `claude-arsenal/references/capability-map.md`

1. **Establish the GitHub channel** — `bash claude-arsenal/bin/github_channel.sh --detect`
   prints `gh`, `rest`, or `none`. `none` means: perform every GitHub step below with your
   own GitHub tools. Skipping those steps is the one wrong answer.

2. **Fetch the task issues** — issues labelled `arsenal:task`, open and closed (a closed
   issue is what marks a dependency satisfied), saved as JSON (e.g.
   `/tmp/arsenal-issues.json`). Request `number,title,state,labels,assignees` and not
   `body`: the `arsenal-id:<id>` label pairs an issue to its task. Also save open issues
   carrying neither `arsenal:task` nor `arsenal:queue` (`number,title`) for `--open-issues`.

3. **Read the board** — `git fetch --quiet origin`, then
   `python3 claude-arsenal/scripts/query_status.py --issues /tmp/arsenal-issues.json \
   --open-issues /tmp/arsenal-unfiled.json`. Report everything it flags. If the fetch
   fails, say so and treat the counts as unverified.

4. **Create missing handles** —
   `python3 claude-arsenal/scripts/handle_sync.py --issues /tmp/arsenal-issues.json`;
   create each printed issue with every label the row lists and a visible
   `` `arsenal-task: <id>` `` body line. Resolve an `ambiguous` row before creating anything.
   → `claude-arsenal/references/queue-seeding.md`

4b. **Import issues filed between sessions** — fetch open issues with the import label
   (default `arsenal:queue`, set by `import-label`), **including `body`**, then
   `python3 claude-arsenal/scripts/issue_import.py --issues /tmp/arsenal-import.json --apply`.
   Apply every change each row prints and commit the new task files.
   → `claude-arsenal/references/queue-seeding.md`

5. **Read handover** — read `arsenal/session/handover.md` if it has real content; it is a
   snapshot, so re-read the board before resuming anything it names. Also
   `status/ideas.md` when the board's `ideas:` line counts exploring rows.
   **After compaction mid-task**, the task's `tmp/<id>-notes.md` and `git status` are the state.
   So keep that file on any work longer than a few steps, queue task or not
   (`tmp/<id-or-slug>-notes.md`): a `## Resume` section with Decided / Ruled out / Next step,
   refreshed after each decision. A hook re-injects that section after compaction.

6. **Pick up work** — `claude-arsenal/references/worker-loop.md`. If the selector returns
   nothing and a plan exists, seed the queue from it
   (`claude-arsenal/references/queue-seeding.md`); otherwise report done or ask the user.
   Pass each dispatch the model from `arsenal_config.py --get models.workers` as its own
   `model` argument; if `models.orchestrator` names a different model than yours, say so
   once. → `claude-arsenal/references/worker-loop.md` § Credit guards

7. **Before ending a session with open work** — audit every claimed task and open PR (CI,
   reviews, mergeability), print the table, then write `arsenal/session/handover.md`.
   `/session-end` does this in full. → `claude-arsenal/references/github-automation.md`

---

## Task format

A task is a file — `arsenal/tasks/<id>.md` — with front matter (`id`, `title`, optional
`label`, `priority`, `deps`, `requires`, `tags`, `workspace`, `max-attempts`) and an
`## Acceptance gate` section. `/queue-add` writes one; a full example is in
`claude-arsenal/references/state-layout.md` § Task format.

Task files are read from the **default branch**, so every agent computes the same order.
`deps` is the build order; `priority` encodes task size only (S=10, M=5, L=1, larger runs
sooner). The gate must be a fenced ` ```bash ` block — prose and inline commands never run
— and it is fixed for the life of the task: a task's own PR cannot amend it.
→ `claude-arsenal/references/evidence-gates.md`

---

## Claiming — the contract

GitHub decides a claim: creating a ref is a compare-and-swap, so exactly one caller wins.

```bash
bash claude-arsenal/bin/claim_task.sh <task-id>
#   won <ref>   → yours; proceed
#   lost        → someone else has it; take the next task (normal, not an error)
#   manual …    → no scriptable channel: make that exact call with your GitHub tools;
#                 201 = won, 422 = lost
#   error:      → misconfiguration; stop and surface it
```

Obey the result: claiming another ref, pushing `-u`, or bumping the attempt number to win
recreates the double-claims this prevents. After winning, self-assign, add
`arsenal:claimed`, and comment with the session id from `CLAUDE_CODE_REMOTE_SESSION_ID`
(falling back to `CLAUDE_CODE_SESSION_ID`); never invent one.
→ `claude-arsenal/references/claiming-internals.md`

---

## Completion — merging is the update

Every change reaches the default branch through a PR, ad hoc work included; never push to
it directly. Open a task's PR with `open_task_pr.sh`: it writes `Closes #<issue>` and
archives the task file in the same diff, so the merge alone finishes the task. If it
refuses for want of an issue, pass `ARSENAL_TASK_ISSUE=<n>` or run `handle_sync.py` —
not `ARSENAL_ALLOW_UNLINKED_PR=1`.

Before merging, run `bash claude-arsenal/bin/merge_ready.sh <pr>`: it checks what the
host's `merge-policy` requires against the head SHA. Exit 0 means merge, without asking
the user a question the host already answered.
→ `claude-arsenal/references/github-automation.md`

---

## Specs and plans

Idea work goes through `explore-idea`, spec work through `specify`, plan work through
`design`; another plugin's brainstorming or planning skill does not replace them, and no
plan is written before the annotated spec is approved. Hand every spec or plan to the user
as the HTML from `create_reader.py`. A diagram is a ```drawspec fence, not hand-drawn SVG
or ASCII art → `claude-arsenal/references/diagrams.md`.

---

## References — read the one you need, when you need it

| File | Read it when |
|---|---|
| `references/worker-loop.md` | Dispatching workers |
| `references/orchestrator-tick.md` | Running the board unattended |
| `references/queue-seeding.md` | The queue is empty, or filed issues need importing |
| `references/evidence-gates.md` | Writing or trusting a gate |
| `references/claiming-internals.md` | A claim misbehaves |
| `references/github-automation.md` | Completing work or ending a session (Actions minutes short → `references/ci-minutes.md`) |
| `references/quota-governance.md` | The loop stopped before dispatch |
| `references/pre-pr-review.md` | About to open a PR |
| `references/lean-code.md` | Implementing a task, or reviewing a diff for code it did not need |
| `references/digest.md` | A PR opened or got a new head; ending a session; digest decisions came back |
| `references/performance-tuning.md` | The loop feels slow, or an `ARSENAL_*` knob is needed |
| `references/state-layout.md` | Looking up where a file lives, what a task state means, or the task-file format |
| `references/repo-housekeeping.md` | Choosing a license, or publishing a package |
| `references/annotatable-reader.md` | Handing over a spec or plan |
| `references/capability-map.md` | A task looks like something a skill would do |
