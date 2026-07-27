# Claude Arsenal

<!-- claude-arsenal v0.20.5 — imported via @claude-arsenal/AGENTS.md -->

This file is imported by the host repo's `CLAUDE.md` via the session-protocol block
that `/init` injects. It provides the mechanics behind the proactive directives
in that block: queue seeding, worker dispatch, credit guards, and state layout.

---

## Session-start protocol

At the start of every session (fresh start, context compaction, or cold restart):

0. **Check for upstream updates then refresh bundle**:
   a. If `claude-arsenal/bin/check_update.sh` exists, run `bash claude-arsenal/bin/check_update.sh`.
      This compares the installed bundle version against the latest version tag on the
      `arsenal` remote (if configured). When behind, it pulls the updated subtree automatically.
      It is a no-op when no `arsenal` remote is configured or the bundle is already current.
   b. Run `python3 .claude/skills/init/scripts/init.py --repo-path . --silent`.
      Silently refreshes any `claude-arsenal/bin/` or other bundle script whose
      checksum differs from the plugin source, and prints an upgrade banner when the
      installed bundle version (`claude-arsenal/.bundle-version`) is behind the plugin.
      If anything is refreshed, report it to the user before continuing. Skip steps (a)
      and (b) when `.claude/skills/init/scripts/init.py` is not present (the skill is
      not installed).
1. **Set up the coordination worktree** —
   `export ARSENAL_QUEUE_DIR="$(claude-arsenal/bin/queue_branch.sh)"`.
   This creates (or reuses) a side git worktree checked out to `arsenal-queue`,
   syncs it with the latest `main` merges, and returns its path. The **main
   working tree never changes branch** — web servers, editors, and other
   consumers always see the host default-branch content. Export `ARSENAL_QUEUE_DIR`
   so every subsequent `claim.sh` and `release.sh` call inherits it.
   See **Queue coordination branch** below for why a dedicated branch is mandatory.
1b. **Sync tasks from the default branch** —
    `ARSENAL_QUEUE_DIR="${ARSENAL_QUEUE_DIR}" claude-arsenal/bin/queue_sync.sh`.
    Idempotently ports any task rows (and payload files) present on the default
    branch but absent from `arsenal-queue`.  Tasks authored via `/queue-add` during
    a feature-branch session (outside an orchestrator context) land on the default
    branch — not on the coordination branch — and are invisible to the orchestrator
    until this step runs.  Safe to skip when offline or when no remote is configured.
2. **Read handover.md** — if `claude-arsenal/session/handover.md` has content beyond the
   template placeholder, read it for the previous session's last task, queue
   snapshot, and continuation instructions.
   > **The handover is a snapshot at compaction time, not the current state.**
   > Do NOT resume work on any task mentioned in the handover without first
   > completing the post-compaction check (step 2a) and running `queue_eval.sh`
   > (step 3).  The queue is always the source of truth.

2a. **Post-compaction in-progress scan** — scan `claude-arsenal/queue/tasks.jsonl`
    for any rows where `status == "in_progress"`. For each one, run:
    ```bash
    ARSENAL_QUEUE_DIR="${ARSENAL_QUEUE_DIR}" claude-arsenal/bin/verify_claim.sh <task_id>
    ```
    Act on the result:
    - `done` — the queue already records the task as complete; skip it.
    - `pushed:<ref>` — a prior context pushed work but the orchestrator did not
      record the release. Close the gap, but **never mark `done` from a bare
      branch ref** (a pushed branch is not an opened PR — that is the false-`done`
      vector). If `<ref>` is a PR URL, record it:
      ```bash
      ARSENAL_QUEUE_DIR="${ARSENAL_QUEUE_DIR}" claude-arsenal/bin/release.sh <task_id> done --pr <pr-url>
      ```
      If `<ref>` is `branch:<name>`, open the PR for that branch first (github
      skill / MCP), then record `done` with the resulting URL. If you cannot open
      a PR, leave the task `in_progress` — `release.sh` refuses `done` without a
      PR URL.
    - `in_progress` — no pushed branch found; the task is truly mid-flight.
      Leave it for the worker loop; do not re-claim or re-do it — another
      context or session may own it.
    - `open` / `unknown` — no action needed.

    This step is safe to skip when the queue has no `in_progress` rows.

3. **Run queue_eval** — `claude-arsenal/bin/queue_eval.sh`.
   - Returns task JSON → go to **Worker loop algorithm**.
   - Returns empty + workspace plans exist → go to **Queue seeding from workspace plans**.
   - Returns empty + `status/plan.md` exists → go to **Queue seeding from plan.md**.
   - Returns empty + no plan → report done or ask user.
4. **Reconcile merged PRs** (when `gh` is available) —
   `claude-arsenal/bin/reconcile_merged.sh`. Flips every `done` task whose PR has
   landed to the terminal `merged` status, so the board distinguishes
   opened-but-unmerged from merged. Safe to skip when offline / no `gh`.
4b. **Queue consistency check** —
    `ARSENAL_QUEUE_DIR="${ARSENAL_QUEUE_DIR}" claude-arsenal/bin/queue_doctor.sh`.
    Read-only audit of `tasks.jsonl` and its payloads: orphaned payloads,
    broken / cyclic deps, crashed `in_progress` claims (no assignee), stale or
    `branch:`-only `pr` fields, a payload secret-scan, and — when `gh` is
    available — `done` / `merged` rows whose PR is closed-unmerged (the
    false-`done` detector). **Report any ERROR / WARN findings to the user.** At
    session start it is advisory and never halts the loop; run it standalone to
    enforce it as a gate (CI / `make`), where a non-zero exit means findings
    at/above `--fail-on` (default `warn`). Safe to skip when offline.

5. **After any session with open tasks**: before ending the session —
   a. **PR audit**: collect every `done`/`in_progress` task carrying a `pr` URL from
      `claude-arsenal/queue/tasks.jsonl`. For each URL, check CI status, review comments,
      and merge-conflict state (use `gh pr view <url> --json title,state,mergeable,reviewDecision,statusCheckRollup`
      when `gh` is available; otherwise print the URL list). Print a review table with
      CI / reviews / mergeability for human approval. Also list any `escalated` tasks
      with their attempt counts and recovery command. The `/session-end` skill (Step 3)
      runs this audit in full; when loaded, defer to it.
   b. **Write handover**: write `claude-arsenal/session/handover.md` using the template
      in that file, including the PR audit summary.

---

## Queue seeding from workspace plans

When `claude-arsenal/queue/tasks.jsonl` is empty and workspace plans exist (per
`claude-arsenal/project/overview.md`), seed the queue from each workspace's plan
without asking the user first.

For each workspace listed in the overview:
1. Read `claude-arsenal/project/<workspace>/plan.md` for the implementation-tasks table.
2. Seed tasks for that workspace using `--workspace <NAME>` flag on `create_task.py`.

The table columns are: `T# | Description | Location | Size | Depends | Gate | Tests`

**Steps:**

1. Add tasks with no dependencies first, capturing each printed ID
   (priority: S=10, M=5, L=1):
   ```bash
   python3 .claude/skills/queue-add/scripts/create_task.py \
     --title "T1: <Description>" \
     --priority 10 \
     --workspace FRONTEND \
     --queue claude-arsenal/queue/tasks.jsonl
   # → prints e.g. lo-a3f8
   ```

2. Add tasks whose deps are now in the queue:
   ```bash
   python3 .claude/skills/queue-add/scripts/create_task.py \
     --title "T3: <Description>" \
     --priority 5 \
     --workspace FRONTEND \
     --deps lo-a3f8 \
     --queue claude-arsenal/queue/tasks.jsonl
   ```

3. For each task, create its payload file at `claude-arsenal/queue/<id>.md`:

   ```markdown
   # T1: <Description>

   ## Acceptance gate
   <Gate column content — prose describing what must be true.>

   If the check is mechanically runnable, also add a bash block:
   ```bash
   bash tests/my_feature_test.sh
   ```
   gate_run.sh executes this block before release.sh done — and `release.sh
   done` re-runs it as a hard precondition, so a `done` whose gate fails (or
   was never run) is refused at the choke point, not just by convention.
   Prose-only gates are verified by worker judgment with no script run.

   ## Tests
   <Tests column content>

   ## Location
   <Location column content>
   ```

   > **Gate blocks run verbatim.** `gate_run.sh` executes the bash block as
   > code in the worker's tree (hardened by default: throwaway HOME + a PATH
   > without `$HOME` shims; `ARSENAL_GATE_INHERIT_ENV=1` opts back in). Treat a
   > gate block from an untrusted plan/payload as you would any code to run —
   > review it.

4. Proceed to the **Worker loop algorithm**.

---

## Queue seeding from plan.md

When `claude-arsenal/queue/tasks.jsonl` is empty and `status/plan.md` exists, seed
the queue from the implementation-tasks table without asking the user first.

The table columns are: `T# | Description | Location | Size | Depends | Gate | Tests`

**Steps:**

1. Add tasks with no dependencies first, capturing each printed ID
   (priority: S=10, M=5, L=1):
   ```bash
   python3 .claude/skills/queue-add/scripts/create_task.py \
     --title "T1: <Description>" \
     --priority 10 \
     --queue claude-arsenal/queue/tasks.jsonl
   # → prints e.g. lo-a3f8
   ```

2. Add tasks whose deps are now in the queue:
   ```bash
   python3 .claude/skills/queue-add/scripts/create_task.py \
     --title "T3: <Description>" \
     --priority 5 \
     --deps lo-a3f8 \
     --queue claude-arsenal/queue/tasks.jsonl
   ```

3. For each task, create its payload file at `claude-arsenal/queue/<id>.md`:

   ```markdown
   # T1: <Description>

   ## Acceptance gate
   <Gate column content — prose describing what must be true.>

   If the check is mechanically runnable, also add a bash block:
   ```bash
   bash tests/my_feature_test.sh
   ```
   gate_run.sh executes this block before release.sh done — and `release.sh
   done` re-runs it as a hard precondition, so a `done` whose gate fails (or
   was never run) is refused at the choke point, not just by convention.
   Prose-only gates are verified by worker judgment with no script run.

   ## Tests
   <Tests column content>

   ## Location
   <Location column content>
   ```

4. Proceed to the **Worker loop algorithm**.

---

## Evidence gates (numeric acceptance)

A numeric gate — a Sharpe floor, a coverage floor, a latency ceiling — must be
backed by a **committed measurement**, not a worker's word. Declare it in the
payload's `## Acceptance gate` section as a fenced `gate` block:

````markdown
```gate
line_coverage >= 0.90
evidence: coverage.json
key: totals.percent_covered
```
````

Line 1 is the gate in `<metric> <op> <threshold>` grammar (the same grammar the
`gate-check` skill uses); `evidence` is a committed JSON file; `key` is a dotted
path to the measured number inside it. `gate_run.sh` asserts `measured <op>
threshold` over that file: a declared evidence gate with **no** evidence file, or
evidence that **violates** the threshold, is a hard failure — it can never pass
vacuously. This is the machine-checkable half of "`done` means the gate passed"
(closes the false-`done` hole for `[LAPTOP]`/science gates). The release-side
half is enforced by `release.sh done`, which refuses to record `done` unless:
the PR is opened (not a bare `branch:` ref) and not closed-without-merge; the
payload's mechanical gate passes (it re-runs `gate_run.sh`, so the evidence/bash
gate is a hard precondition); and — for a task tagged **`laptop`** — the session
is not a cloud session. A cloud worker (`CLAUDE_CODE_REMOTE=true`) physically
cannot satisfy a `[LAPTOP]`-only gate (model training, CPCV Sharpe, soak,
paper-trade), so tag such tasks `laptop` (`create_task.py --tag laptop`) and the
laptop session records `done`; a cloud session is refused.

---

## Worker loop algorithm (parallel fan-out)

One orchestrator claims up to `ARSENAL_MAX_WORKERS` independent tasks and
dispatches that many workers at once. Run when the queue has open tasks:

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
   - If it prints `available`, dispatch the **first batch as a single worker**
     regardless of `ARSENAL_MAX_WORKERS`, then inspect the post-worker assertion
     (step 6): if it reports `restored` rather than `ok`, the Task tool did
     **not** honor `isolation: worktree` (it ran in-place and the orchestrator's
     HEAD had to be recovered) → clamp `ARSENAL_MAX_WORKERS=1` and stay in
     serialized in-place mode for the rest of the session. Only ramp to the
     configured `ARSENAL_MAX_WORKERS` once a worker has returned with `ok`,
     confirming real worktrees are in effect.
1. Apply credit guards (see below) if not already set this session.
2. **Budget check** — `claude-arsenal/bin/budget_check.sh`.
   - exit `0` → under quota (or quota unobservable; fail-open) AND under the
     per-session dispatch-round cap. Continue.
   - exit `3` → at/above `ARSENAL_QUOTA_STOP_PCT`, OR the session has dispatched
     `ARSENAL_MAX_ITERATIONS` rounds (the always-available cap). **Stop the
     loop**, write `handover.md`, and report the reason (remaining % + reset
     time, or the round cap). Do not dispatch.
3. `claude-arsenal/bin/queue_batch.sh --max "${ARSENAL_MAX_WORKERS:-2}"` → up to
   N task JSON lines (JSONL), respecting `LOOP_WORKSPACE` / `LOOP_TAGS` scope and
   excluding any task that blocks another in the same batch.
   - Empty → loop done; report summary and write `handover.md`.
   - **Isolation clamp (mechanical).** `queue_batch.sh` emits at most ONE task
     when worktree isolation is recorded `unavailable` (sentinel
     `claude-arsenal/session/worktree_isolation`, written by `worktree_probe.sh`
     and `worker_postcheck.sh`; override with `ARSENAL_WORKTREE_ISOLATION`). This
     closes the double-dispatch window: once in-place mode is detected, the
     selector itself refuses to hand back a parallel batch, so two workers can
     never be dispatched in one round before the clamp takes effect.
4. For each task line, `ARSENAL_QUEUE_DIR="${ARSENAL_QUEUE_DIR}" claude-arsenal/bin/claim.sh <task_id> <session_id>`
   (sequential — each push is atomic):
   - `won` → keep the task in the dispatch set. A win is only reported after
     `claim.sh` confirms the coordination ref actually advanced to its claim
     commit (guarding against a restricted-push surface that silently redirects
     the push off the shared ref — the web double-claim vector).
   - `lost` → another session claimed it; drop it from this batch.
   - `error: …` (exit 2) → **stop the loop and surface to the user.** A
     misconfiguration, not a race (wrong branch, protected coordination branch,
     no upstream). Do **not** retry — it spins forever on a deadlock. Re-run
     `queue_branch.sh` to refresh `ARSENAL_QUEUE_DIR`, or fix the branch
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
6. **Wait for all workers.** Then, for each returned outcome:
   - **Assert the coordination-branch invariant first** —
     `claude-arsenal/bin/worker_postcheck.sh`. It guarantees HEAD is back on
     `arsenal-queue` and the tree is clean **before** `release.sh` runs (which
     otherwise exits 2 off-branch). In a real worktree this is a no-op (`ok`);
     if it prints `restored`, the worker ran in-place — clamp
     `ARSENAL_MAX_WORKERS=1` per step 0. Exit 2 (could not restore) → stop the
     loop and surface to the user.
   - Then record the outcome on `arsenal-queue` yourself (the worker is on a
     feature branch and cannot run `release.sh` — see **Per-task PRs** below):
     - `done` + **PR URL** → `ARSENAL_QUEUE_DIR="${ARSENAL_QUEUE_DIR}" claude-arsenal/bin/release.sh <task_id> done --pr <pr-url>`.
       `done` means "PR opened + gate passed", NOT "merged" — `reconcile_merged.sh`
       later flips it to the terminal `merged` once the PR lands.
       If the worker returned `branch:<name>` instead of a URL (no PR backend was
       available in its worktree), **open the PR for that branch first** (github
       skill / MCP), then record `done` with the URL. `release.sh` refuses `done`
       without a PR URL, so a pushed-but-unopened branch is never recorded as
       complete; if you cannot open the PR, leave the task `in_progress`.
     - `open` + failure notes → append the structured `## Attempt N failure`
       section (see `agents/worker.md` step 3 format) under `## Failure notes`
       in `claude-arsenal/queue/<task_id>.md`, then
       `ARSENAL_QUEUE_DIR="${ARSENAL_QUEUE_DIR}" claude-arsenal/bin/release.sh <task_id> open`
       (which commits the payload edit too). `release.sh` increments `attempts`
       and auto-escalates to `escalated` when the cap is reached — check
       `queue-status` after; an `escalated` task needs human recovery
       (`ARSENAL_QUEUE_DIR="${ARSENAL_QUEUE_DIR}" release.sh <id> open --reset-attempts`).
7. **Sync main, then return to step 2.** Run
   `export ARSENAL_QUEUE_DIR="$(claude-arsenal/bin/queue_branch.sh)"` before
   looping back. This merges any PRs that landed on `main` into the
   coordination worktree while the main working tree stays untouched — web
   servers, config files, and other host content always reflect the default
   branch across iterations.
8. **Post-loop housekeeping (mandatory).** Run once when the loop exits — either
   because step 3 returned empty (all open tasks exhausted) or step 2's budget
   check exited 3. For every workspace that had at least one task reach `done` or
   `merged` status during this session:
   a. **Update the workspace handover.** Prepend a new status block to
      `claude-arsenal/project/<WORKSPACE>/handover.md` with today's date in ISO
      8601 format (`YYYY-MM-DD`), what was completed, what (if anything) remains
      open or blocked, and the next recommended action. Keep it to ≤ 10 lines —
      enough for a cold-start worker to orient without reading the full queue.
   b. **Update the status doc.** Reflect completed work in
      `docs/status/<part>.md` (or wherever the host project tracks board
      fragments). Mark finished items done; update the "remaining" count.
   c. **Pull latest main.** The orchestrator's main working tree is already on
      the default branch (the coordination branch lives in a side worktree, so
      the main tree never moves). Just run `git pull origin main` before staging
      the edits — no branch switch needed.
   d. **Bundle and commit.** Include all handover and status edits in a single
      `chore: update workspace handovers and status docs` commit on the default
      branch (or open a small housekeeping PR if main is protected). Do **not**
      batch this with task code — keep it separate so the diff is reviewable.
      After committing, refresh the coordination worktree:
      `export ARSENAL_QUEUE_DIR="$(claude-arsenal/bin/queue_branch.sh)"`.

   > **Why this step exists.** The queue ledger (`tasks.jsonl`) tracks machine
   > state; `handover.md` and `docs/status/*.md` are the human-readable
   > continuation brief. The `/session-end` skill writes these for single-workspace
   > sessions, but multi-workspace orchestrator sessions span the whole loop and
   > never call `/session-end` per workspace — these files fall through unless the
   > orchestrator does it explicitly at loop exit.

---

## Divergence handling

A **spec divergence** is code that contradicts what `spec.md` / `plan.md`
require — wrong labels, wrong scope, a missing step, a wrong constant. Noting one
in `handover.md` prose is **insufficient**: the handover is a snapshot the next
session overwrites, so a prose-only divergence never shows up in `queue-status`,
is never ordered or blocked against other tasks, and silently persists across
context compactions while workers keep building on the wrong inputs.

**Rule: any blocking spec divergence found during a session MUST be seeded as a
queue task before the session ends.** The queue is the source of truth, not the
handover.

Minimum task — title it `D-N` (the Nth divergence this session):

```bash
python3 .claude/skills/queue-add/scripts/create_task.py \
  --title "D-N: <short description>" \
  --queue claude-arsenal/queue/tasks.jsonl
```

In a workspace-structured project, add `--workspace <WORKSPACE>` to file the
divergence under the right workspace; solo / single-workspace repos omit it.
Give it a payload stub at `claude-arsenal/queue/<id>.md` that names three things:
what the spec requires, what the code does, and the fix location.

This applies to workers and solo sessions alike. A worker that spots a divergence
outside its own task's scope flags it in its returned outcome; the orchestrator —
the single queue writer — seeds the task (it never lets a worker push to the
coordination branch). A solo session seeds the task directly.

---

## Per-task PRs

Each worker implements its task in an isolated worktree, cuts a feature branch
off the **host default branch** (`origin/main`, never `arsenal-queue`) via
`claude-arsenal/bin/open_task_pr.sh`, runs the host lint gate + `gate_run.sh`,
and — only if the gate passes — commits (Conventional Commits + the dynamic
`Co-Authored-By` from the `github` skill, never a hardcoded model), pushes, and
opens a PR. The PR diff is just that task's code.

Workers do **not** run `release.sh`: they are on a feature-branch worktree and
`release.sh` guards on `arsenal-queue`. Instead a worker **returns its outcome**
(status, PR URL or `branch:<name>`, failure notes) and the orchestrator — the
single writer on `arsenal-queue` — records it (loop step 6). This keeps one
queue writer and collapses release contention.

The queue row carries an optional `"pr"` field once recorded.
`release.sh … --pr <url>` sets it and also stages the payload file so
`## Failure notes` / PR-URL edits land on the coordination ref.

> **Web caveat:** Claude Code on the web differs from the CLI in two ways that
> matter here, so per-task PRs and parallel fan-out are **CLI-first** — verify
> both on the web before relying on them there:
>
> 1. **Restricted pushes.** Git may be routed through a proxy that restricts
>    pushes to the session's designated branch (feature-branch pushes can return
>    HTTP 403).
> 2. **Silent worktree fallback.** The Task tool's `isolation: worktree` flag
>    may be **silently ignored** — no worktree is created and the worker runs in
>    the orchestrator's shared tree on `arsenal-queue`, moving the orchestrator's
>    HEAD onto the worker's feature branch and leaving the worker's pre-PR edits
>    transiently on the append-only ledger (tripping host Stop hooks). This
>    breaks parallelism (concurrent workers clobber one tree) and can make
>    `release.sh` fail until HEAD is back on `arsenal-queue`. The loop guards
>    against it: it probes with `worktree_probe.sh`, dispatches a lone first
>    worker, and runs `worker_postcheck.sh` after every worker to restore the
>    invariant; when isolation turns out to be unavailable it forces
>    `ARSENAL_MAX_WORKERS=1` and runs serialized in-place (loop step 0).
>
> On the CLI both behaviours are unrestricted: pushes are unproxied and
> `isolation: worktree` is honored.

---

## Quota governance — token-budget stop

`statusline_capture.sh` (registered by `/init` as the host `statusLine` command)
writes `claude-arsenal/session/rate_limits.json` (gitignored) from the
`rate_limits` block Claude Code feeds a statusLine on stdin — the only channel
that data arrives on. Before every dispatch, the loop runs `budget_check.sh`:

- Either window (`five_hour` / `seven_day`) at/above `ARSENAL_QUOTA_STOP_PCT`
  (default 90) → exit `3`: stop, write `handover.md`, report the reset time.
- File missing / fields absent (non-Pro/Max plan, before the first response,
  older Claude Code) → exit `0`, **fail-open**: the loop runs where quota is not
  observable.

`rate_limits` is a snapshot at the last message and is **Pro/Max only**; on
API/metered usage the quota check always fails open. So `budget_check.sh` also
enforces an **always-available** per-session dispatch-round cap
(`ARSENAL_MAX_ITERATIONS`, default 50; `0` disables) that does not depend on
observable quota — the real ceiling for an auto-dispatching loop on metered
billing. The counter resets per `CLAUDE_SESSION_ID` and lives in the gitignored
`claude-arsenal/session/budget_iterations.json`.

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
| `ARSENAL_QUEUE_BRANCH` | `arsenal-queue` | Coordination branch (must stay unprotected + pushable). |
| `ARSENAL_QUEUE_REMOTE` | `origin` | Remote for queue + per-task pushes. |
| `ARSENAL_QUEUE_WORKTREE` | `<repo-root>/../<repo-name>-arsenal-queue-wt` | Path for the side worktree that hosts the coordination branch. Name-scoped by repo so sibling clones never collide — **never** override this to a fixed path shared across repos (see warning below). |
| `ARSENAL_QUEUE_DIR` | _(set by `queue_branch.sh`)_ | Active worktree path; export once, then pass to `claim.sh`/`release.sh`. |

---

## Queue coordination branch

The queue's cross-session safety is built on **optimistic git-push concurrency**:
`claim.sh` flips a task to `in_progress`, commits the one-line change to
`claude-arsenal/queue/tasks.jsonl`, and pushes. Two sessions can both commit a
claim locally, but only one push can fast-forward the shared remote ref — the
other is rejected non-fast-forward and reports `lost`, then re-evaluates. The
**remote ref is the lock.** There is no other channel between sessions.

`claim.sh` and `release.sh` rewrite `tasks.jsonl` with a write-temp-then-rename
(atomic `os.replace`), so a crash mid-write can never leave a half-written,
corrupt ledger. And `claim.sh` only reports `won` after confirming the push
actually advanced the shared ref to its claim commit — a restricted-push surface
that redirects the push off the coordination ref fails loud instead of letting
two sessions both "win".

That guarantee holds **only** when every orchestrator session pushes to **one
shared, pushable ref**. So the queue lives on a dedicated branch
(`ARSENAL_QUEUE_BRANCH`, default `arsenal-queue`). `queue_branch.sh` creates
a side git worktree for it (path exported as `ARSENAL_QUEUE_DIR`); `claim.sh`
and `release.sh` cd into that worktree when `ARSENAL_QUEUE_DIR` is set, so
the main working tree never leaves the default branch. Requirements:

- **Unprotected.** A protected branch (e.g. `main` with required PRs/reviews)
  rejects every claim push → `claim.sh` returns `error:` and the loop stops. It
  must never be the coordination branch.
- **Shared, not per-session.** If two sessions push to different branches, both
  "win" the same task → duplicate work. `claim.sh`/`release.sh` guard against
  this: they exit `error` (2) if HEAD is not the coordination branch.
- **Never merged into mainline.** It is an append-only ledger of `claim:` /
  `release:` commits (≈2 one-line commits per task; lost races leave nothing on
  the remote). Keeping it off `main` keeps mainline history clean. The branch
  needs no cleanup — only the current state of `tasks.jsonl` matters, so its
  history is disposable and can be squashed any time without loss of meaning.
- **One coordination worktree per repo clone — never a path shared across
  repos.** `ARSENAL_QUEUE_WORKTREE` defaults to
  `<repo-root>/../<repo-name>-arsenal-queue-wt`, name-scoped so sibling clones
  of *different* repos (e.g. `~/dev/project-a` and `~/dev/project-b`) never
  compute the same path. If you override `ARSENAL_QUEUE_WORKTREE` (or hand-set
  `ARSENAL_QUEUE_DIR`) to a fixed, non-namespaced path — including the old
  shared default `<repo-root>/../arsenal-queue-wt` from before this scoping
  existed — two unrelated repositories can end up pointed at the exact same
  worktree, whose `origin` belongs to only ONE of them. Both projects then
  silently coordinate through that one repo's `arsenal-queue` branch: their
  task ledgers merge, and a worker in project A can claim and "complete" a
  task that actually belongs to project B. `queue_branch.sh` will reuse an
  existing worktree it finds already checked out elsewhere in *this* repo, but
  it cannot protect you from an override that points at a *different* repo's
  worktree — don't set one unless the path is still unique per repo.
- **Project identity is stamped and checked on every run.** Because
  `ARSENAL_QUEUE_BRANCH` (`arsenal-queue`) is a generic literal name,
  `queue_branch.sh` writes `claude-arsenal/queue/.project-id` (a normalized
  form of `ARSENAL_QUEUE_REMOTE`'s URL) onto the coordination branch the
  first time it creates it, independent of the worktree-path check above —
  this also catches contamination that happens purely at the remote (a stale
  `origin` left over from a template/fork, a copy-pasted
  `ARSENAL_QUEUE_REMOTE`, or two projects that briefly share a remote), not
  just a local path collision. Every later run compares the fetched branch's
  stamp against this repo's own remote and **refuses to proceed (exit 1)** on
  a mismatch instead of silently absorbing another project's task rows.

Per-task **code** work is unaffected: workers run in `isolation: worktree` on
their own feature branches → PRs → protected `main`, exactly as before. Only the
queue-state commits live on the coordination branch.

---

## Credit guards — set before any Task-tool dispatch

```
CLAUDE_CODE_DISABLE_1M_CONTEXT=1
CLAUDE_CODE_DISABLE_FAST_MODE=1
CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6
```

**Version requirement**: Claude Code ≥ v2.1.172. Check with `claude --version`
before starting; older versions do not support `statusLine.rate_limits`.

---

## Agent definitions

| Agent | File | When used |
|-------|------|-----------|
| Worker | `agents/worker.md` | Spawned via Task tool per claimed task |

---

## Queue format

Each line of `claude-arsenal/queue/tasks.jsonl` is a JSON object:

```json
{
  "id": "lo-a3f8",
  "title": "T1: ...",
  "status": "open|in_progress|done|merged|blocked|escalated",
  "priority": 0,
  "requires": [],
  "deps": [{"id": "lo-b2c1", "type": "blocks"}],
  "assignee": null,
  "claimed_at": "2026-06-21T12:00:00+00:00",
  "workspace": "FRONTEND",
  "tags": ["CLI"],
  "pr": "https://github.com/owner/repo/pull/123",
  "payload": "lo-a3f8.md",
  "issue": 42,
  "max_attempts": 3,
  "attempts": 0
}
```

`claimed_at` (ISO-8601 UTC) is the **lease stamp**: `claim.sh` sets it when a
task flips to `in_progress`, and `release.sh` clears it when the task leaves
`in_progress`. It exists so a crashed/abandoned claim — which strands a task
`in_progress` forever — can be detected by age and reclaimed:
`queue_doctor.py --lease-ttl <seconds>` flags any `in_progress` row whose lease
is older than the TTL (`stale-lease`), and recovery is
`release.sh <id> open --reset-attempts`. The age check is off by default
(`--lease-ttl 0`); pick a TTL longer than your slowest task.

`workspace`, `tags`, `pr`, and `issue` are optional and append-compatible — older
readers ignore them. `tags` is a free-form label axis (`/queue-add --tag CLI`) that
`/continue` scopes on via `LOOP_TAGS` (ANDed), orthogonal to `workspace` and the
surface-capability `requires` filter. `pr` is set by `release.sh … --pr <url>`
when a per-task PR is opened. `issue` links a task to a GitHub issue number; with
`queue_doctor.sh --closed-issues` a task whose linked issue is already closed is
flagged (prune it or mark it done) — useful when the backlog mirrors issues.

`max_attempts` (default 3) and `attempts` (default 0) control the per-task retry
cap. `release.sh` increments `attempts` on each `open` release (worker gate
failure); when `attempts >= max_attempts` the status is auto-overridden to
`escalated`. Rows written before this field was added are treated as
`max_attempts=3, attempts=0`. Set a custom cap with `/queue-add --max-attempts N`.

`done` and `merged` are both **terminal** and both satisfy blocking deps:
`done` = PR opened + gate passed; `merged` = that PR landed on the default
branch. `reconcile_merged.sh` performs the `done`→`merged` flip by querying
`gh pr view <pr> --json state` for each `done` task carrying a `pr` URL.

`escalated` is a non-terminal failure state: the task has exhausted its attempt
cap and needs human intervention. It does **not** satisfy blocking deps. It is
skipped by `queue_batch.sh` (status is not `open`) and visible in `queue-status`
with attempt counts. Recover with:
`claude-arsenal/bin/release.sh <id> open --reset-attempts` then `/continue`.

### Task lifecycle states

```
open → (claimed) → in_progress → (gate pass) → done → (PR merged) → merged
in_progress → (gate fail, attempts < max_attempts) → open
in_progress → (gate fail, attempts >= max_attempts) → escalated
escalated → (human resets: release.sh <id> open --reset-attempts) → open
```

---

## State directory layout

```
claude-arsenal/
  AGENTS.md           ← this file; imported via @claude-arsenal/AGENTS.md
  agents/
    worker.md         ← worker subagent definition
  bin/                ← shell scripts; refreshed by /init on re-run
    queue_branch.sh   ← creates/reuses a side worktree for the coordination branch; main tree never moves
    queue_sync.sh     ← ports task rows from the default branch to the coordination branch (idempotent)
    queue_eval.sh     ← next single task (thin wrapper over queue_batch.sh)
    queue_batch.sh    ← up to N independent tasks (parallel fan-out)
    worktree_probe.sh ← probes whether git worktrees work here (fan-out safety)
    claim.sh
    release.sh        ← orchestrator-side; accepts --pr, stages the payload
    verify_claim.sh   ← post-compaction probe: checks pushed branch vs queue state
    worker_postcheck.sh ← orchestrator-side; restores HEAD→queue branch + clean tree post-worker
    reconcile_merged.sh ← done→merged flip via `gh` PR merge-state check
    queue_doctor.sh   ← read-only consistency audit (orphans, deps, false-done, secret-scan)
    open_task_pr.sh   ← worker-side; branch off default → commit → push → PR
    gate_run.sh
    budget_check.sh   ← quota stop + always-available per-session round cap
    statusline_capture.sh ← host statusLine; writes rate_limits.json
    detect_surface.sh
    workspace_list.sh
  project/            ← host-owned; never touched by /init re-run
    overview.md       ← workspace index
    <WORKSPACE>/
      spec.md
      plan.md
      context.md
      handover.md
  queue/              ← host-owned; never touched by /init re-run
    tasks.jsonl       ← the DAG queue
    <id>.md           ← task payloads
  session/            ← host-owned; never touched by /init re-run
    handover.md       ← live; updated each session
    surface_profile.json  ← gitignored; written by detect_surface.sh hook
    rate_limits.json      ← gitignored; written by statusline_capture.sh
    budget_iterations.json ← gitignored; per-session dispatch-round counter
```
