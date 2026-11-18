# Worker loop — parallel fan-out

Read this when you are about to dispatch workers, or when a dispatch misbehaved.
A session that never spawns a worker never needs this file.

## Contents

- [Worker loop algorithm (parallel fan-out)](#worker-loop-algorithm-parallel-fan-out) — the loop itself, steps 0–6
- [What to run while editing](#what-to-run-while-editing) — the touched suite now, the whole gate once
- [Per-task PRs](#per-task-prs) — what a worker opens, and the web caveat
- [Reading a precedent](#reading-a-precedent--shape-first-prose-on-demand) — how to follow an existing module without paying for all of it
- [Credit guards](#credit-guards--set-before-any-task-tool-dispatch) — the single home of model dispatch
- Tuning knobs — every `ARSENAL_*` / `LOOP_*` env var: `performance-tuning.md` § Tuning knobs
- [Agent definitions](#agent-definitions)

---

## Worker loop algorithm (parallel fan-out)

One orchestrator claims up to `ARSENAL_MAX_WORKERS` independent tasks and
dispatches that many workers at once. Run when the queue has open tasks:

> **Precondition — the main working tree is clean, and stays clean.** Run
> `git status --porcelain` in the host's main tree before the first dispatch;
> if it reports anything, stop and ask the user to commit it, move it to a
> worktree, or accept the risk. `worker_postcheck.sh` (step 6) runs
> `git reset --hard` + `git clean -fd` in that tree whenever HEAD is off the
> recorded host branch, and it cannot tell a worker's residue from your own
> uncommitted work. So while workers run, cut no branch and start no edit there
> (a small docs PR is the usual trigger); use a separate worktree, or commit
> first.

0. **Establish worker isolation (once per session).** Parallel fan-out is only
   safe when each worker runs in its own `git worktree`; without it, concurrent
   workers share one tree and clobber each other, and any worker moves the
   orchestrator's HEAD off its host branch. The Task tool's
   `isolation: worktree` flag is **silently ignored on some surfaces** (observed
   on Claude Code on the web), so the orchestrator must establish isolation
   empirically, not assume it:
   - Run `claude-arsenal/bin/worktree_probe.sh`. If it prints `unavailable`
     (exit 1), git worktrees do not work here at all → set
     `ARSENAL_MAX_WORKERS=1` and run **serialized in-place mode** for the whole
     session (one worker at a time; `worker_postcheck.sh` keeps the branch clean
     between them). In this mode the task's PR commits the whole checkout, so
     `claim_task.sh` refuses (exit 2) while `git status` shows changes no task
     made; relay the paths to the user rather than stashing them yourself.
   - If it prints `available`, dispatch the **first batch as a single worker**.
     You no longer have to remember to: `task_select.py` returns one task unless
     the sentinel reads a proven `available`, and the first round is always
     `unknown`, so the first batch is clamped mechanically.

     Isolation is then confirmed from the worker's own root, not from whether
     HEAD moved. Pass `ARSENAL_WORKER_TOPLEVEL` to `worker_postcheck.sh` (step
     6) and it records `available` only when that root differs from the
     orchestrator's. A `restored` result, or a worker root equal to yours, both
     mean the Task tool did **not** honor `isolation: worktree` → serialized
     in-place for the rest of the session.

     **`ok` is about the tree, not about isolation.** It says nothing had to be
     restored. The verdict that governs fan-out is the
     `arsenal/session/worktree_isolation` sentinel, and the selector reads it
     itself — which is what stops an unproven condition from licensing a
     parallel batch.
1. Apply credit guards (see below) if not already set this session.
2. **Budget check** — `claude-arsenal/bin/budget_check.sh`
   (what it reads, and why it fails open:
   `claude-arsenal/references/quota-governance.md`).
   - exit `0` → under quota (or quota unobservable; fail-open) AND under the
     per-session dispatch-round cap. Continue.
   - exit `3` → at/above `ARSENAL_QUOTA_STOP_PCT`, OR the session has dispatched
     `ARSENAL_MAX_ITERATIONS` rounds (the always-available cap). **Stop the
     loop**, write `handover.md`, and report the reason (remaining % + reset
     time, or the round cap). Do not dispatch.
3. Fetch the `arsenal:task` issues over the channel from step 1 of the
   session-start protocol (`AGENTS.md`), save them, and ask for the batch:

   ```bash
   python3 claude-arsenal/scripts/task_select.py \
       --issues "${ARSENAL_ISSUES_JSON:-/tmp/arsenal-issues.json}" \
       --max "${ARSENAL_MAX_WORKERS:-2}" \
       ${LOOP_WORKSPACE:+--workspace "$LOOP_WORKSPACE"}
   ```

   → up to N task JSON lines (JSONL), best first. Add `--tag` per `LOOP_TAGS`
   entry to narrow further.
   - Empty → loop done; report summary and write `handover.md`.
   - **No task in the batch can block another in it.** A task whose dep is not
     yet `done` is not eligible at all, so a blocked dependent cannot be
     selected alongside the dep it waits on. This needs no separate rule.
   - **Isolation clamp (mechanical).** `task_select.py` returns at most ONE task
     when worktree isolation is recorded `unavailable` (sentinel
     `arsenal/session/worktree_isolation`, written by `worktree_probe.sh` and
     `worker_postcheck.sh`; override with `ARSENAL_WORKTREE_ISOLATION`). This
     closes the double-dispatch window: once in-place mode is detected, the
     selector itself refuses to hand back a parallel batch, so two workers can
     never be dispatched in one round before the clamp takes effect. The clamp
     lives in the selector rather than in this protocol on purpose — a rule the
     caller has to remember is one it can skip exactly once, in the round that
     discovers isolation is missing.

     **Dispatching separate sessions rather than Task-tool subagents?** Then no
     worker ever returns through `worker_postcheck.sh`, which is `available`'s
     only writer — so the sentinel stays `unknown` and every batch is clamped to
     one task, permanently, on the surface where separate sessions are the only
     shape that works. Record the fact instead:
     `bash claude-arsenal/bin/record_isolation.sh separate-session`. It attests
     that isolation follows from HOW you dispatched (a container per worker
     cannot share a tree) rather than from a path comparison, which inverts
     across containers — two containers routinely check out at the same path.
     The vocabulary is closed and the provenance is written to
     `worktree_isolation.why`; an unknown mechanism is refused, not recorded.
     Not for Task-tool subagents: `worker_postcheck.sh` measures that
     case correctly, and a measurement is worth more than an attestation.
4. For each task line, `bash claude-arsenal/bin/claim_task.sh <task_id>`
   (sequential — each push is atomic):
   - `won` → keep the task in the dispatch set. `claim_task.sh` reports `won`
     only when GitHub itself created the ref, which guards against a
     restricted-push surface that silently redirects the push off the shared
     ref — the web double-claim vector.
   - `lost` → another session claimed it; drop it from this batch.
   - `error: …` (exit 2) → **stop the loop and surface to the user.** A
     misconfiguration, not a race (wrong branch, protected default branch,
     no upstream). Do **not** retry — it spins forever on a deadlock. Re-run
     the GitHub channel (`github_channel.sh --detect`), or fix the
     protection, then resume.
   - Obey a `lost` or `error`; routing around it re-creates the double claim
     the lock prevents (`AGENTS.md` § Claiming — the contract).
5. **Dispatch every won task.** Which of the two shapes you are in was decided
   back in step 3, and steps 5 and 6 differ by it — so say which one you are in
   before reading on.

   **Task-tool dispatch — spawn every won task as a worker subagent in ONE
   message** (see `agents/worker.md`) so they run concurrently:
   - `isolation: worktree`
   - Inject the relative-path directive and the task payload path.
   - Restate the two rules a worker most often misses, because your prompt is
     the last thing it reads: run gates in the foreground (ending the turn ends
     the task), and run `claude-arsenal/bin/host_setup.sh` before any test.
     Both are spelled out in `agents/worker.md`. If a worker reports that the
     repo declares no `host-setup`, declare it once in `arsenal/config.toml`
     rather than paying for the discovery per worker.
   **Separate-session dispatch — open one session per won task instead.** The
   worker never returns into this session, so there is nothing to spawn in one
   message and nothing to wait on in step 6: each session opens its own PR (or
   returns `branch:<name>`), and you pick the outcomes up off GitHub. Isolation
   was attested with `record_isolation.sh separate-session` in step 3, so the
   `worker_postcheck.sh` calls below do not apply — there is no returned worker
   to run them against, and inventing an outcome to feed one would replace a
   measurement with a guess. Everything else in step 6 — the PR, the gate
   evidence, `Closes #<issue>` — you read from the PR itself. A session that
   returns `branch:<name>` had no channel that could open one: **open it
   yourself**, with the `Closes #<issue>` line, before you count that task as
   dispatched. Step 6 writes that handoff out, and this mode skips step 6 — so
   it is named here too, because a pushed branch is not an opened PR: a task
   left at a branch holds its claim until `sweep-claims` releases it a day
   later, and its PR never opens by itself.

6. **Wait for all workers** (Task-tool dispatch only — separate sessions are
   picked up off GitHub, per step 5). Then, for each returned outcome:
   - **Assert the tree invariant first** — pass the worker's reported root so
     isolation is measured rather than inferred, and its outcome and returned
     text so a `done` is checked for the evidence a completion carries:
     `ARSENAL_WORKER_OUTCOME=done ARSENAL_WORKER_RESULT="<the worker's result>" ARSENAL_WORKER_TOPLEVEL=<worker's toplevel> claude-arsenal/bin/worker_postcheck.sh`.
     **Exit 4** → the worker reported `done` with no PR URL, no `branch:` and no
     `toplevel:`. That is an abandoned task, not a completion — usually a
     backgrounded gate whose turn ended, with its processes still alive. Nothing
     was touched: resume that worker and let it finish in the foreground. Do not
     record the task as done, and do not re-dispatch it as a fresh attempt; the
     work is intact and only needs the turn it was cut off from.
     It guarantees HEAD is back on the session's own branch and the tree is clean.
     In a real worktree this is a no-op (`ok`);
     if it prints `restored`, the worker ran in-place — clamp
     `ARSENAL_MAX_WORKERS=1` per step 0. Exit 2 (could not restore) → stop the
     loop and surface to the user.
   - `restored` is destructive (see the precondition above). If it caught
     uncommitted work, the tree was snapshotted first: the ref is on
     `worker_postcheck.sh`'s stderr and in `arsenal/session/rescue_refs`.
     Recover with `git checkout <ref> -- .` and tell the user before the loop
     continues.
   - Then record the outcome:
     - `done` + **PR URL** → nothing to record. `open_task_pr.sh` wrote
       `Closes #<issue>` and archived the task file into that PR, so merging it
       closes the task by itself.
       If the worker returned `branch:<name>` instead of a URL, no channel in its
       worktree could open a PR: **open it yourself** with the `Closes #<issue>`
       line. A pushed branch is not an opened PR, and a task whose PR never
       opened can never close. The keyword-guard check in
       `.github/workflows/arsenal-queue.yml` fails the PR if you forget it.
     - `open` (gate failed, round cap, refused review) → append the worker's
       `## Attempt N failure` notes to the task file so the next attempt can read
       them, and leave the task for a retry. Copy its `wip:` and `resume:` lines
       into those notes, into a comment on the task issue and into `handover.md`:
       the next attempt restores the work with the `resume:` command instead of
       redoing it. No `wip:` line and the worker's worktree still exists → run
       `park_task.sh <task_id>` from inside that worktree yourself before
       anything removes it, and do not end the loop until it has pushed. The next attempt claims `<id>.a<n+1>`; past `max-attempts` it stops
       being offered and needs a human.
     - Remove `arsenal:claimed` and your assignment from the issue when you are
       not continuing, so the task is visibly free again.

---

## Reading a precedent — shape first, prose on demand

Most tasks here are told to follow something that already exists: make the gate
module look like the last one, the evidence file like the last one, the tests
like the last one. That is deliberate — consistency is what lets a reviewer
check one module by reading another — but it quietly sets the default action to
"read the whole file", and a mature repo's modules are long on purpose.

Read the shape first:

```
bash claude-arsenal/bin/outline.sh src/pkg/previous_module.py
```

It prints the declarations and nothing else — the constants, the function
signatures, the naming convention, the trio of helpers a copy has to agree
with. That is almost always what "follow the existing module" actually means.
Then open only the body you need:

```
sed -n '120,180p' src/pkg/previous_module.py
```

Measured on arsenal's own sources this is a 25–33× reduction, and on a consumer
repo it was the difference between ~6k tokens and ~400 for a single precedent,
paid once per gate-writing task.

Read the whole file when the task turns on *how* something works rather than
what it looks like — a subtle interaction, a bug you are reproducing, a
docstring that records why a design was chosen. Those docstrings are the reason
a reviewer can tell a real gate from a decorative one, so they are worth reading
when the design is the question. They are simply not worth reading to copy a
function signature.

---

## What to run while editing

**While editing, run only the suite covering what you touched. Run the whole
gate once, before opening the PR.**

A worker's natural reading of "the gate is the bar" is to keep checking against
the gate, and the loop above does nothing to discourage it. But only the last
run decides anything — `open_task_pr.sh` runs the gate itself, and refuses on
its failure, so a gate run five edits earlier bought information that the final
one re-buys. On one measured task that was three whole-gate runs after edits to
one language's files, against seconds of verification that would have told
anyone the same thing.

This costs nothing and weakens nothing: the run that gates is still the full
one. It is the cheapest saving available to a worker, and the one nothing in the
tooling will make for you.

**Do not make the gate skip suites based on what changed.** The selectivity
belongs here, in the editing loop, where being wrong costs a re-run and
certifies nothing. A host that wants every run to be the whole gate just keeps
running it — there is no knob to set, and nothing in the bundle runs a suite on
your behalf while you edit. See `references/evidence-gates.md` § How often to
run the whole gate for the reasoning, and `references/performance-tuning.md`
§ Making the gate faster for what makes a gate slow.

---

## Per-task PRs

Each worker implements its task in an isolated worktree, cuts a feature branch off
the **host default branch** via `claude-arsenal/bin/open_task_pr.sh`, which runs the
pre-PR adversarial review check, the host gate (`host-gate` in
`arsenal/config.toml`) and `gate_run.sh` itself, and refuses on either gate's
failure — or, where `pre-pr-review = "required"`, on a change no independent
reviewer has cleared. It records the review outcome in the PR body under every
mode but `off`. Only then does it commit (Conventional
Commits + the dynamic `Co-Authored-By` from the `github` skill, never a hardcoded
model), pushes, and opens a PR. The PR diff is just that task's code.
Where the harness mandates one designated branch, `--branch <name>` (or
`ARSENAL_PR_BRANCH`) commits and pushes there instead of cutting a new one; with
no PR backend it prints the PR body, `Closes #<issue>` included, for the caller's
own GitHub tools.

**The PR body must carry `Closes #<issue>`.** That is the entire completion
mechanism: GitHub closes the issue when the PR merges into the default branch, so
nothing has to remember to update the queue afterwards. For a stacked PR whose base
is another branch, put the keyword in the **commit message** instead — the PR-body
form only fires on a merge into the default branch.

Workers never claim or release: the orchestrator owns the claim, and completion is
a property of merging rather than a command anyone runs.

> **Web caveat:** Claude Code on the web differs from the CLI in two ways that
> matter here, so per-task PRs and parallel fan-out are **CLI-first** — verify
> both on the web before relying on them there:
>
> 1. **Restricted pushes.** Git may be routed through a proxy that restricts
>    pushes to the session's designated branch (feature-branch pushes can return
>    HTTP 403).
> 2. **Silent worktree fallback.** The Task tool's `isolation: worktree` flag
>    may be **silently ignored** — no worktree is created and the worker runs in
>    the orchestrator's own tree, moving its HEAD onto the worker's feature branch.
>    This breaks parallelism, because concurrent workers then clobber one tree.
>    The loop guards
>    against it: it probes with `worktree_probe.sh`, dispatches a lone first
>    worker, and runs `worker_postcheck.sh` after every worker to restore the
>    invariant; when isolation turns out to be unavailable it forces
>    `ARSENAL_MAX_WORKERS=1` and runs serialized in-place (loop step 0).
>
> On the CLI both behaviours are unrestricted: pushes are unproxied and
> `isolation: worktree` is honored.

---

## Credit guards — set before any Task-tool dispatch

This is the one place model dispatch is defined; `agents/worker.md` and
`agents/reviewer.md` point here. Assign, check, then use — in the same Bash call
as the dispatch:

```bash
root="$(git rev-parse --show-toplevel)"
cfg="${root}/claude-arsenal/scripts/arsenal_config.py"
workers_model="$(python3 "${cfg}" --repo-root "${root}" --get models.workers)" \
  || { echo "arsenal: models.workers is unusable — fix arsenal/config.toml" >&2; exit 1; }
reviewer_model="$(python3 "${cfg}" --repo-root "${root}" --get models.reviewers)" \
  || { echo "arsenal: models.reviewers is unusable — fix arsenal/config.toml" >&2; exit 1; }
printf 'workers: %s  reviewer: %s\n' "${workers_model:?resolved empty}" "${reviewer_model:-${workers_model}}"
export CLAUDE_CODE_DISABLE_1M_CONTEXT=1 CLAUDE_CODE_DISABLE_FAST_MODE=1
```

Write the printed model into each dispatch's own `model` argument. Why:

- Cloud Bash calls share no shell state, so an exported
  `CLAUDE_CODE_SUBAGENT_MODEL` never reaches the dispatch.
- A dispatch with no `model` inherits the parent's model, not `models.workers`.
- `export VAR="$(cmd)"` always exits 0, so assigning first is what lets a bad
  config fail loudly instead of dispatching on an empty value.

`models.workers` defaults to `sonnet` and takes an alias (`opus`, `sonnet`,
`haiku`) or a full model id; anything else is a hard config error. Empty
`models.reviewers` means "same as workers". `models.orchestrator` is advisory:
a session cannot change its own model, so if it differs from the one you are
running, say so once before dispatching. Empty means no opinion.

---

## Agent definitions

| Agent | File | When used |
|-------|------|-----------|
| Worker | `agents/worker.md` | Spawned via Task tool per claimed task |
| Reviewer | `agents/reviewer.md` | Spawned by the worker before its PR opens, on a packet from `adversarial_review.sh` — no history of the change |

---
