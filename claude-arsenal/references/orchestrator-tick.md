# The orchestrator tick — one pass of the unattended loop

Read this when running the board unattended: on a schedule, from a routine, or
whenever a session is asked to "keep the queue moving" without a human watching
each step.

`references/worker-loop.md` documents the **worker** half — how one task gets
implemented. This is the other half: what the session that dispatches, reviews
and merges does, once, per tick.

## Contents

- [What a tick is, and what owns the clock](#what-a-tick-is-and-what-owns-the-clock)
- [The tick, in order](#the-tick-in-order)
- [Merge preconditions — all three, every time](#merge-preconditions--all-three-every-time)
- [Reporting — say nothing when nothing changed](#reporting--say-nothing-when-nothing-changed)
- [A tick is not portable](#a-tick-is-not-portable)
- [Dispatching a worker to another session](#dispatching-a-worker-to-another-session)
- [What a scheduler cannot do](#what-a-scheduler-cannot-do)

---

## What a tick is, and what owns the clock

A tick is **one bounded pass over the board**: fetch, open PRs for finished work,
review what came back, merge what qualifies, report. It starts, it finishes, and
it leaves the queue in a state the next tick can read. It is not a session that
runs forever.

The split matters because only one half belongs in a repository:

| | Owns |
|---|---|
| **This reference** | what a tick does, in what order, and where it stops |
| **The surface** | when a tick happens — a routine's cron, a CI schedule, a human typing "continue" |

Nothing in a repository can create an account-scoped trigger, so nothing here
tries. Write the contract once, here, where it is versioned and reviewed; supply
the clock from wherever your surface supplies clocks.

That division is the fix for a real failure: a fleet whose entire protocol lived
in the prompt text of one trigger object on one account — not in any repo, so not
reviewed, not diffable, and retyped by hand into each successive trigger until the
copies had drifted from one another. Deleting the routine would have deleted the
contract.

## The tick, in order

1. **Fetch.** `git fetch --quiet origin`, then re-read the board
   (`query_status.py --issues …`, per `AGENTS.md` § Session-start protocol steps
   2–3). Everything below is decided against what the remote says right now, never
   against what the last tick remembered.

2. **Open a PR for any pushed worker branch that has none.** A worker that cannot
   reach the GitHub API pushes and stops — that is the correct shape on surfaces
   where a spawned session has no API channel. The branch is the handoff. Open its
   PR with `Closes #<issue>` naming the task's own issue.

3. **Review what came back.** Verify every review-bot finding **against the code**
   before accepting or rejecting it. A bot finding is a bug report, not a verdict:
   confirm it reproduces, then fix it or say precisely why it does not hold. Do not
   accept a batch on its summary, and do not dismiss one on its reputation.

4. **Merge what qualifies** — see the preconditions below. Nothing else.

5. **Regenerate evidence after each merge**, with the tooling that owns it. Never
   hand-edit an evidence file to match a merge you just made; a number written by
   hand is a number nothing measured.

6. **Report.** See the reporting shape below.

7. **Stop.** A tick ends. If work remains, it is the next tick's, not this one's
   excuse to keep running.

**Where a tick defers to the owner and does not decide:** a merge conflict whose
two sides changed the same logic; a review finding that asks for a design change
rather than a fix; a task whose gate cannot pass as written (the gate is fixed for
the life of the task — see `references/evidence-gates.md`); and anything that would
widen a permission or change the merge policy. Report these and move on to the rest
of the tick. A blocked item is not a reason to stop the pass.

## Merge preconditions — all three, every time

This restates `AGENTS.md`'s `merge-policy` rule at the moment it is applied, which
is the moment it is actually at risk of being skipped.

Merge only when **all** of these hold:

- **The task is not held.** No `arsenal:hold` label, no unresolved blocker on its
  issue.
- **Every review thread is resolved.** Not "addressed in a later commit" — resolved.
- **You ran the host gate yourself and saw exit 0.** Not the worker's report of it.
  A worker saying its gate passed is a claim; the orchestrator running the gate is
  the evidence. This is the precondition most likely to be quietly dropped at 3am,
  and it is the one the whole arrangement rests on.

`merge-policy` in `arsenal/config.toml` may require more (a human review, CI). It
never requires less. Read it each tick rather than remembering it — it is a host
setting and hosts change it.

## Reporting — say nothing when nothing changed

**At most six lines, or the literal words "no change".**

An hourly loop that narrates itself burns the orchestrator's context on its own
transcript, and a session that runs out of context mid-tick leaves the board in a
state nobody described. Terseness here is not style; it is what keeps the loop able
to run again.

What earns a line: a PR opened, a PR merged, a finding rejected and why, a blocked
item and what blocks it. What does not: a tick that fetched and found nothing, a
restatement of the board's counts, a plan for next time.

## A tick is not portable

A tick bound to a schedule is addressed to **one live session** and dies with it.
Say this out loud to anyone building one, because the alternative design looks
obviously better and does not work.

A trigger created to spawn a **fresh session per firing** stores no MCP connectors —
the API says so at creation time, and the fired session's allowed tools carry no
`mcp__*` entry. On a surface where REST is also refused, such a session has no
channel to the GitHub API at all and blocks on step 1 of the tick. Binding to an
already-open interactive session is the only way a tick inherits the grant.

So: a fresh-orchestrator-per-tick design cannot work, and it fails an hour later
rather than immediately.

## Dispatching a worker to another session

A spawned session is not a smaller copy of you. It has **no `mcp__*` tools** — this
holds both for a routine firing a fresh session and for a directly created child,
and neither warns you — so on a surface where REST is also refused, its only channel
to GitHub is plain `git`. That is enough to fetch, to read claim refs over
`ls-remote`, and to **push a branch**. It is not enough to read issues, label or
assign one, open a PR, or merge.

So the capability split is forced, not stylistic:

| | GitHub API | Does |
|---|---|---|
| Orchestrator | yes | board, claim, dispatch, **open each PR**, merge |
| Worker | no | worktree, implement, host gate, `open_task_pr.sh` **through the push**, then stop |

`open_task_pr.sh` supports that ending: when no channel here can open a PR, it
pushes and prints `branch:<name>` on stdout with exit 0. That is a completed
handoff, not a failure — the orchestrator opens the PR for that branch on its next
tick (step 2 above).

**Three things every dispatch must carry.** Each of these is a measured failure, not
a precaution:

1. **The repository, explicitly.** Inheritance is not a substitute. Of four workers
   dispatched without it, two got containers with no sources at all — and the create
   call returned **201** for all four, so nothing in the response distinguished them.
   The orchestrator waits for branches that never arrive, and finding out means
   reading each child's summary one at a time. Attaching the repository is also what
   authorises the push: a worker without it has nowhere to push either.

2. **`ARSENAL_TASK_ISSUE`.** `open_task_pr.sh` resolves the task's issue number over
   the same API the worker does not have, and it refuses **before touching git**
   rather than opening a PR whose merge closes nothing. In this mode that variable is
   mandatory, not an optimisation. Do not tell a worker to retry with
   `ARSENAL_ALLOW_UNLINKED_PR=1` — that opens a PR that completes no task.

3. **Evidence the assignment is real.** A worker's first turn is now, routinely, *an
   unfamiliar sender telling it to go edit files* — and a worker that judges that
   blind will sometimes judge it prompt injection and refuse. That refusal is
   **correct behaviour**, which is exactly why it cannot be the signal you rely on;
   it also reads like an over-cautious model rather than a missing argument. Give it
   something checkable instead: the issue number, the claim ref the orchestrator
   already created (`arsenal/claims/<id>`, readable over plain `git ls-remote`), and
   the dispatching session's id. A worker that can verify the claim exists does not
   have to guess.

**Dispatch one worker per message.** A batch of session-creation calls in a single
message reads as one refusable action and is refused as one; the same calls sent one
per message go through. → `references/github-automation.md`

## What a scheduler cannot do

`.github/workflows/arsenal-queue.yml` already carries a cron trigger and can run
board hygiene unattended — `handle_sync.py`, `issue_import.py`, the five transitions
GitHub owns. That is worth using.

It can never do the reviewing or merging half, because an Actions job has no Claude
session in it. The tick above needs judgement at steps 3 and 4; a workflow can only
do the mechanical parts. Do not try to move the tick into CI, and do not read a
green `arsenal-queue` run as evidence that the tick ran.
