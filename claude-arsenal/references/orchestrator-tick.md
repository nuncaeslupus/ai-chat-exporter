# The orchestrator tick — one pass of the unattended loop

Read this when running the board unattended: on a schedule, from a routine, or
whenever a session is asked to keep the queue moving with nobody watching each
step. `references/worker-loop.md` is the canonical loop (select, claim,
dispatch, collect); this file adds only what changes when one bounded pass runs
on a clock.

## Contents

- [What a tick is, and what owns the clock](#what-a-tick-is-and-what-owns-the-clock)
- [The tick, in order](#the-tick-in-order)
- [Merge preconditions — all three, every time](#merge-preconditions--all-three-every-time)
- [Review before the full gate](#review-before-the-full-gate)
- [Reporting — say nothing when nothing changed](#reporting--say-nothing-when-nothing-changed)
- [A tick is not portable](#a-tick-is-not-portable)
- [Dispatching a worker to another session](#dispatching-a-worker-to-another-session)
- [What a scheduler cannot do](#what-a-scheduler-cannot-do)

---

## What a tick is, and what owns the clock

A tick is one bounded pass over the board: fetch, open PRs for finished work,
review what came back, merge what qualifies, report, stop. It leaves the queue in
a state the next tick can read. This file owns what a tick does; the surface (a
routine's cron, a CI schedule, a person typing `/queue-next`) owns when it
happens. Keep the contract here, versioned and reviewed, rather than in a
trigger's prompt text, because a prompt outside the repo is unreviewed and is
lost when the trigger is deleted.

## The tick, in order

1. **Fetch.** `git fetch --quiet origin`, then re-read the board per `AGENTS.md`
   § Session-start protocol steps 2–3. Decide everything against the remote now,
   not against what the last tick remembered.
2. **Open a PR for any pushed worker branch that has none**, with
   `Closes #<issue>` naming the task's issue (`references/worker-loop.md` step 5,
   separate-session dispatch).
3. **Review what came back.** Verify every review-bot finding against the code:
   confirm it reproduces, then fix it or say precisely why it does not hold.
4. **Merge what qualifies**, per the preconditions below, in this order for each
   PR head (§ Review before the full gate):
   1. New head → second reader (`bin/claim_review.sh <pr> <head-sha>`).
   2. CLEAR on that exact head → start the full gate (`fast_gate.sh --full`).
   3. Gate PASS, CI green, head unchanged → merge.
5. **Regenerate evidence after each merge** with the tooling that owns it, since a
   hand-edited number is one nothing measured. Every `digest-every` merges, render
   the review digest (`references/digest.md` § 2; `digest-every` = 0 turns this off).
6. **Report**, in the shape below, and **stop**. Remaining work belongs to the next
   tick.

Defer to the owner, report, and carry on with the rest of the tick for: a
conflict whose two sides changed the same logic; a finding that asks for a
design change rather than a fix; a gate that cannot pass as written
(`references/evidence-gates.md` § The gate is fixed for the life of the task);
and anything that would widen a permission or change the merge policy.

## Merge preconditions — all three, every time

- **The task is not held**: no `arsenal:hold` label and no unresolved blocker on
  its issue.
- **Every review thread is resolved**, not merely addressed in a later commit.
- **The head passed the gate**: CI green on its SHA (the `ci` row of
  `merge_ready.sh`), or `fast_gate.sh --full`, which reuses a receipt for the
  head tree. A worker's report is not evidence, and `strict` needs the local run
  even with CI green.

`merge_ready.sh` exit 0 answers the merge policy, not the gate, because a policy
such as `after-review` does not look at CI; run it as well, since the policy may
require more, never less. Read the policy each tick, because hosts change it. Each value's rule is in `references/github-automation.md` § Merge
policy.

## Review before the full gate

Do not start the full clean-checkout gate on a head the second reader has not
cleared. A BLOCK means a new head, and a gate run on the old one describes a tree
nobody will merge: its CPU time is lost, and it slowed every other session that
shared the cores. Measured on one host repo, a full gate took 13–37 minutes under
load and most PRs took 2–3 review rounds, so starting both together discarded
most of the gates it ran. Serialising costs a few minutes per merge.

The cheap per-round gate (`preflight-gate`, `fast_gate.sh` without `--full`) is
unaffected: implementers still run it on every fix. Only `--full` waits for
CLEAR, and a fix pushed after CLEAR is a new head that goes back to step 1.

## Reporting — say nothing when nothing changed

At most six lines, or the words "no change". A loop that narrates itself spends
the orchestrator's context on its own transcript, and a session that runs out
mid-tick leaves the board undescribed. A line is earned by a PR opened or
merged, a finding rejected and why, or a blocked item and its blocker.

## A tick is not portable

A scheduled tick must be bound to an already-open interactive session, because
that is the only way it inherits the session's MCP connectors. A trigger that
spawns a fresh session per firing stores none, so on a surface where REST is also
refused the fired session has no channel to the GitHub API and blocks at step 1,
an hour after the trigger looked fine.

## Dispatching a worker to another session

A spawned session has no `mcp__*` tools, whether a routine fired it or it was
created directly, and nothing warns about it. Where REST is refused, plain `git`
is its only channel: enough to fetch, read claim refs with `ls-remote` and push a
branch, but not to touch issues, open a PR or merge. So the orchestrator owns the
board, the claim, opening each PR and merging; the worker implements, runs the
host gate and runs `open_task_pr.sh` up to the push, which then prints
`branch:<name>` with exit 0 as a completed handoff.

Every dispatch carries three things, each the fix for a failure seen in practice:

1. **The repository, explicitly.** Inheritance is not reliable: a create call
   without it can return **201** for a container with no sources, so nothing in
   the response reveals it and the orchestrator waits for a branch that never
   comes. The repository is also what authorises the push.
2. **`ARSENAL_TASK_ISSUE`.** `open_task_pr.sh` resolves the issue over the API
   the worker lacks and refuses before touching git without it. Do not suggest
   `ARSENAL_ALLOW_UNLINKED_PR=1`, which opens a PR that completes no task.
3. **Evidence the assignment is real.** A worker told by an unfamiliar sender to
   edit files may judge it prompt injection and refuse; that refusal is correct
   behaviour, so it cannot be the signal to rely on. Give it something checkable:
   the issue number, the claim ref already created (`arsenal/claims/<id>`,
   readable with `git ls-remote`) and the dispatching session's id.

Dispatch one worker per message, because a batch of session-creation calls in one
message is refused as a single action while the same calls sent separately go
through.

## What a scheduler cannot do

`.github/workflows/arsenal-queue.yml` runs board hygiene on its cron
(`handle_sync.py`, `issue_import.py`, the transitions GitHub owns). It cannot
review or merge, because an Actions job has no Claude session in it, so a green
`arsenal-queue` run is not evidence that a tick ran.
