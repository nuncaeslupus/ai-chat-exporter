# Worker loop — parallel fan-out

Read this when you are about to dispatch workers, or when a dispatch misbehaved.
A session that never spawns a worker never needs this file.

## Contents

- [Worker loop algorithm (parallel fan-out)](#worker-loop-algorithm-parallel-fan-out) — the loop itself, steps 0–6
- [Per-task PRs](#per-task-prs) — what a worker opens, and the web caveat
- [Reading a precedent](#reading-a-precedent--shape-first-prose-on-demand) — how to follow an existing module without paying for all of it
- [Credit guards](#credit-guards--set-before-any-task-tool-dispatch) — env to set before any Task-tool dispatch
- [Tuning knobs](#tuning-knobs) — every `ARSENAL_*` / `LOOP_*` env var
- [Agent definitions](#agent-definitions)

---

## Worker loop algorithm (parallel fan-out)

One orchestrator claims up to `ARSENAL_MAX_WORKERS` independent tasks and
dispatches that many workers at once. Run when the queue has open tasks:

> **Precondition — the main working tree must be clean.** Run
> `git status --porcelain` in the host's main tree before the first dispatch.
> If it reports anything, **stop and tell the user**: commit it, move it to a
> worktree, or explicitly accept the risk. The loop force-restores that tree
> after every worker (step 6), and uncommitted work sitting in it is exactly
> what gets caught. Keep it clean for the whole loop — do not cut branches or
> start edits there while workers are running.

0. **Establish worker isolation (once per session).** Parallel fan-out is only
   safe when each worker runs in its own `git worktree`; without it, concurrent
   workers share one tree and clobber each other, and any worker moves the
   orchestrator's HEAD off the coordination branch. The Task tool's
   `isolation: worktree` flag is **silently ignored on some surfaces** (observed
   on Claude Code on the web), so the orchestrator must establish isolation
   empirically, not assume it:
   - Run `claude-arsenal/bin/worktree_probe.sh`. If it prints `unavailable`
     (exit 1), git worktrees do not work here at all → set
     `ARSENAL_MAX_WORKERS=1` and run **serialized in-place mode** for the whole
     session (one worker at a time; `worker_postcheck.sh` keeps the branch clean
     between them).
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
4. For each task line, `bash claude-arsenal/bin/claim_task.sh <task_id>`
   (sequential — each push is atomic):
   - `won` → keep the task in the dispatch set. `claim_task.sh` reports `won`
     only when GitHub itself created the ref, which guards against a
     restricted-push surface that silently redirects the push off the shared
     ref — the web double-claim vector.
   - `lost` → another session claimed it; drop it from this batch.
   - `error: …` (exit 2) → **stop the loop and surface to the user.** A
     misconfiguration, not a race (wrong branch, protected coordination branch,
     no upstream). Do **not** retry — it spins forever on a deadlock. Re-run
     the GitHub channel (`github_channel.sh --detect`), or fix the
     protection, then resume.
   - **Never work around a `lost` or `error` by creating an upstream, pushing
     `-u`, or re-claiming on a different ref.** A `lost` means another session
     legitimately owns the task; an `error` means the lock is misconfigured.
     "Recovering" the claim by giving your branch its own pushable ref defeats
     the shared-ref lock entirely and lets two sessions both win the same task —
     the precise double-claim failure this protocol prevents. Obey the result.
5. **Spawn every won task as a Task-tool worker subagent in ONE message**
   (see `agents/worker.md`) so they run concurrently:
   - `isolation: worktree`
   - Inject the relative-path directive and the task payload path.
   - Say that the gates run in the **foreground** and that ending the turn ends
     the task. You are the one who can set that expectation before the worker
     chooses how to run a 10-minute gate; `agents/worker.md` says it too, but a
     worker deciding under time pressure reads your prompt last.
   - Say to run `claude-arsenal/bin/host_setup.sh` first, before any test. A
     worktree carries tracked files and nothing an install produces, so without
     it the first gate in each worktree fails on a missing tool and every worker
     in the fan-out diagnoses the same environmental fact separately — five of
     nine, in the session that prompted this. The script is a no-op unless the
     repo declares `host-setup` in `arsenal/config.toml`; if the worker reports
     that it does not, declare it once rather than paying for it per worker. Any
     non-zero exit — 1 the command failed, 2 the config is unreadable or this is
     not a git repository — means the tree is not set up and the worker returns
     `open`; only exit 0 continues, whether or not a command was declared.
6. **Wait for all workers.** Then, for each returned outcome:
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
   - ⚠️ **`worker_postcheck.sh` is destructive by design.** A `restored` result
     means it ran `git reset --hard` + `git clean -fd` in the tree it was
     invoked from — the host's MAIN working tree, when the orchestrator runs it.
     It restores whenever HEAD is off the recorded host branch, and it cannot
     tell a worker's residue from your own uncommitted work. So:
     - satisfy the loop precondition (step 0) — **the main working tree is
       clean before the loop starts**, and stays that way;
     - **never cut a branch in the main tree while the loop is running**
       (a small docs PR is the classic trigger: the branch moves, the next
       postcheck restores, and everything uncommitted goes with it). Do that
       work in a separate worktree, or commit first.
     - If a restore did catch uncommitted work, the tree was snapshotted first:
       the ref is on `worker_postcheck.sh`'s stderr and in
       `arsenal/session/rescue_refs`. Recover with
       `git checkout <ref> -- .`, and **surface it to the user** — do not
       silently continue the loop over rescued work.
   - Then record the outcome:
     - `done` + **PR URL** → nothing to record. `open_task_pr.sh` wrote
       `Closes #<issue>` and archived the task file into that PR, so merging it
       closes the task by itself.
       If the worker returned `branch:<name>` instead of a URL, no channel in its
       worktree could open a PR: **open it yourself** with the `Closes #<issue>`
       line. A pushed branch is not an opened PR, and a task whose PR never
       opened can never close. The keyword-guard check in
       `.github/workflows/arsenal-queue.yml` fails the PR if you forget it.
     - `open` (gate failed) → append the worker's `## Attempt N failure` notes to
       the task file so the next attempt can read them, and leave the task for a
       retry. The next attempt claims `<id>.a<n+1>`; past `max-attempts` it stops
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

Two of these are fixed. The third is the consumer's call, so it is read from
`arsenal/config.toml` rather than written here — a model id hardcoded in a
vendored file is a preference an upgrade overwrites:

```bash
export CLAUDE_CODE_DISABLE_1M_CONTEXT=1
export CLAUDE_CODE_DISABLE_FAST_MODE=1

root="$(git rev-parse --show-toplevel)"
workers_model="$(python3 "${root}/claude-arsenal/scripts/arsenal_config.py" \
    --repo-root "${root}" --get models.workers)" \
  || { echo "arsenal: models.workers is unusable — fix arsenal/config.toml" >&2; exit 1; }
export CLAUDE_CODE_SUBAGENT_MODEL="${workers_model:?models.workers resolved empty}"
```

**Assign, check, then export** — and anchor both paths on the repo root. Written
as one line, `export VAR="$(cmd)"` reports the exit status of `export`, which
always succeeds: a rejected model or a script path that did not resolve from a
subdirectory would set an empty value, `export` would return 0, and the fleet
would dispatch on whatever model Claude Code defaults to. That is the silent
fleet the hard error below exists to prevent, arriving by a different door.

`models.workers` defaults to `sonnet` and takes either an alias Claude Code
resolves (`opus`, `sonnet`, `haiku`) or a full model id. A value that is
neither is a hard config error, not a silent fallback: a worker fleet quietly
running a model nobody chose is exactly the kind of thing that is only
discovered on the invoice.

**The orchestrator half is advisory.** `models.orchestrator` says which model
this repo wants running the dispatching session, and no script can enforce it —
a session cannot change the model it is already running as. What it can do is
notice: compare the configured value against the model you are actually running
and, if they differ, say so once rather than dispatching a fleet from a session
the repo did not want driving it. Empty (the default) means no opinion.

**Version requirement**: Claude Code ≥ v2.1.172. Check with `claude --version`
before starting; older versions do not support `statusLine.rate_limits`.

---

## Tuning knobs

| Env var | Default | Effect |
|---------|---------|--------|
| `ARSENAL_MAX_WORKERS` | `2` | Workers per batch. `2` is the validated git-push concurrency ceiling; higher N raises claim-race churn and PR/merge-conflict surface. **Forced to `1` when worktree isolation is unavailable** (loop step 0): parallel workers are unsafe sharing one tree. |
| `ARSENAL_QUOTA_STOP_PCT` | `90` | Stop the loop before dispatch at/above this used-percentage on either window. |
| `ARSENAL_MAX_ITERATIONS` | `50` | Always-available per-session dispatch-round cap (quota-independent). `0` disables it. |
| `ARSENAL_GATE_INHERIT_ENV` | _(unset)_ | Set `1` to run gate blocks with the caller's full environment instead of the hardened throwaway HOME + restricted PATH. |
| `LOOP_WORKSPACE` | _(unset)_ | Workspace scope; set by `/continue` token inference. |
| `LOOP_TAGS` | _(unset)_ | Comma/space-separated tag scope (ANDed); set by `/continue` token inference. |
| `ARSENAL_QUEUE_REMOTE` | `origin` | Remote for claim refs + per-task pushes. |
| `ARSENAL_CLAIM_PREFIX` | `arsenal/claims` | Ref namespace for atomic claim refs. |
| `ARSENAL_HOME` | `arsenal` | Host-owned tree (tasks, specs, plans, config, session). |

---
---

## Agent definitions

| Agent | File | When used |
|-------|------|-----------|
| Worker | `agents/worker.md` | Spawned via Task tool per claimed task |
| Reviewer | `agents/reviewer.md` | Spawned by the worker before its PR opens, on a packet from `adversarial_review.sh` — no history of the change |

---
