# GitHub automation — merging, and the upkeep GitHub does

Read this when a merge did not close its task, when a PR check about the closing
keyword fails, when an unattended run stopped on a permission prompt, or when
deciding whether to install / remove `.github/workflows/arsenal-queue.yml`.

---

## Why an unattended run stops on a permission prompt

An orchestrator on a cloud surface can sit for hours waiting on a prompt nobody
is there to answer. `/init` deliberately writes **no** `permissions.allow` block
to try to prevent that, because a seeded block does not fix it — and shipping one
would look like a fix while changing nothing.

**The GitHub tools are not the problem.** On the surfaces where this was
measured, `mcp__github__*` calls — listing issues, creating a branch, opening and
updating a PR, commenting, merging — passed silently already: the account's
GitHub connector grants them, outside `settings.json` entirely. Seeding grants
that are already held buys nothing and widens the file for no reason.

**The session tools are the problem, and an allow rule cannot clear them.**
`create_session`, `get_session` and their siblings prompted in a repo whose
committed `.claude/settings.json` carried them spelled exactly right, and
prompted again on the next call — no sticky approval. Two mechanisms produce
that, and both are outside a repository's reach:

- A tool the server marks as requiring user interaction prompts on **every**
  call, in every permission mode, and a matching allow rule does not skip it.
- Project `permissions.allow` entries grant capability, so they apply only after
  the workspace is **trusted** — a per-user acceptance stored outside the clone.
  Until then the entries are ignored and the prompts continue. Look for a startup
  line reading `Ignoring N permissions.allow entries … this workspace has not
  been trusted` to tell the two apart.

Neither is reachable from a committed file, which is why this is documentation
and not a `/init` step.

**What actually helps: dispatch one session per message.** Three `create_session`
calls sent in a single message were refused together — a batch reads as one
refusable action — while the same three sent one per message were each approved.
An orchestrator that fans out serially gets through; one that fans out in a
single turn stops on the first refusal and loses the whole round.

Do not try to route around any of this by having a session widen its own
permissions. Writing to `.claude/` is checked before allow rules are read, on
purpose, and that check is load-bearing. A permission a fleet needs is a decision
its owner makes once, not something a session grants itself at 3am.

---

## Completion — merging is the update

The failure the previous design could not fix: merging a PR and updating the queue were
two separate acts, and the second got forgotten. Worse, `reconcile_merged.sh` — the script
meant to catch that — was `gh`-gated and so never ran on the web at all.

Merging is now the whole of it, and **no step in this protocol asks anyone to finish a
task**. `open_task_pr.sh` resolves the task's issue number, writes `Closes #<issue>` into
the PR body *and* the commit message, and moves the task file into `tasks/_history/` with
`status: merged` inside the same diff. So one merge closes the issue, archives the file,
and unblocks the dependents.

Writing the keyword in both places is not belt-and-braces for its own sake — each covers
a case the other does not. The body form fires on a merge into the **default** branch; the
commit form survives a squash and is what closes the issue for a **stacked** PR whose base
is another branch, when that commit eventually lands.

> The keyword used to be prose here and in `worker.md` — "make sure the body carries
> `Closes #<issue>`" — while nothing anywhere computed which issue that was and
> `open_task_pr.sh` wrote a body without it. An instruction with no data path behind it is
> a step that does not happen, so every task PR merged closing nothing. If you are reading
> a protocol that asks you to remember a completion step, that is the bug.

**When the helper refuses.** No resolvable issue handle means a PR that would merge
without closing anything, so it stops before touching git, leaving the worker's edits
intact. Pass `ARSENAL_TASK_ISSUE=<n>` (the orchestrator has the number from step 2 of the
session-start protocol in `AGENTS.md`) or create the handle with `handle_sync.py`. Do not reach for
`ARSENAL_ALLOW_UNLINKED_PR=1` to get past it — that is the old silent failure, opted into.

---

## Ending a session is reporting, not repair

`AGENTS.md` step 7 asks a session with open work to audit it and write a
handover before ending. That step is a **report for the human**, not a repair
the queue depends on.

Nothing the next session needs is produced by it. A merged PR has already closed
and archived its task — GitHub did that, per the transitions above. An abandoned
PR has already released its claim. So a session that ends abruptly, on a quota
stop, a crash, or a closed window, leaves the queue correct anyway.

**With one window, and it is worth knowing where it is.** A session that dies
*after* claiming and *before* opening its PR leaves a claim behind that no PR
transition will ever release, because there is no PR. What repairs it is the
`sweep-claims` job — `queue_hooks.py sweep-claims --max-age-hours 24` on the
daily cron — so the queue is self-correcting there rather than immediately
correct, and the task is unavailable until the sweep runs. Without
`.github/workflows/arsenal-queue.yml` installed, nothing sweeps at all: the next
session repairs stale claims and unhandled task files itself before starting.

That is the property the whole design is aiming at, and it is worth stating as a
rule for anything added later:

> If you find yourself writing "remember to X before the session ends", X belongs
> in a workflow or a script, not in a protocol. The sessions that most need
> cleaning up are exactly the ones that ended badly and will never read it.

## Merge policy — the host's standing answer to "may I merge this?"

`arsenal/config.toml` carries `merge-policy`, and this is the step that reads it:

```bash
python3 claude-arsenal/scripts/arsenal_config.py --get merge-policy
```

One bare word, one of five. It is a decision the host already made and wrote down, so
both directions are failures: merging past what it allows, and stopping to ask a
question the file answers.

| Value | Merge when |
|---|---|
| `always` | The PR is open and `open_task_pr.sh`'s gates passed. Nothing further to wait for. |
| `after-ci` | Every required check on the head commit has **reported**, and is green. |
| `after-review` | A review has landed **and** every comment it raised is fixed or answered. CI is **not** consulted — this is the value for a repo with no CI, or whose CI is unavailable rather than failing. |
| `after-ci-and-review` | Both rows above: green checks **and** a review whose comments are all addressed. What "wait for green, answer the bot, then merge" means. |
| `never` | Never, by an agent. Report the PR as ready and stop; the human merges. |

**What counts as a review.** Whatever GitHub reports on the PR itself: a review submitted
by a human collaborator, or by any review bot installed on the repo. Read the PR's
reviews — do not match a name. A policy that names its reviewer in prose goes stale the
day the repo swaps one bot for another, and then blocks forever on a reviewer nobody has
installed. A PR with no reviews at all does not satisfy `after-review`, and waiting is the
correct behaviour.

"Fixed or answered" is the bar the review loop already enforces: a fix paired with a reply,
or a reply explaining the disagreement. An unresolved thread is an unmet policy, not a
judgement call.

**Who fixes, and who merges.** The findings are the session's work, not a handoff. Read
every finding the review raised, verify each against the code, fix the real ones, and reply
saying what changed and what was rejected and why. Under `after-review` that closing loop
is the whole gate: merge on it, with no further human sign-off. Under
`after-ci-and-review` the CI row above must be satisfied too. Under `never` the human
merges whatever the threads say. Stopping to ask permission once the active policy's
conditions are met is the same failure as merging before they are — the file already
answered the question.

**A summary line is not the finding list.** A review bot can report an overall status of
"passed" or "review completed" on the PR while leaving unresolved comments on individual
lines. Read the review comments themselves, not the rollup — merging on a green summary
with open threads breaks the policy while appearing to satisfy it.

**When CI cannot report at all.** Absent is not green. A repo out of runner minutes, with
no workflows, or whose jobs die in seconds with no runner assigned has produced no
evidence — so `after-ci` and `after-ci-and-review` are unsatisfied, and stay that way for
as long as the outage lasts. Do not read "no failures" as success. Say what is missing and
stop: that state is precisely why `after-review` exists, and the fix is the host changing
one line in `arsenal/config.toml`, not an agent deciding at merge time that today the gate
did not mean anything.

**The same shape shows up on the review side.** A review-bot vendor that caps how many
reviews it runs per hour is a second, independent kind of platform quota — not a defect in
the PR, just an external usage limit, same as the CI case above but affecting the review
half of `after-review` / `after-ci-and-review` instead of the CI half. See
`plugins/core/skills/github/references/pr-review-loop.md`, section "When the review bot
rate-limits itself", for the retry pattern. Neither kind of quota is a reason to weaken the policy or to merge
past what it requires — it is a reason to wait, requeue, and keep working whatever PRs have
already cleared the bar while the clock runs out on the rest.

---

## Upkeep GitHub does — `.github/workflows/arsenal-queue.yml`

Merging covers a task that finished. Four things it cannot cover happen when **no session
is running**, and each used to be a line asking an agent to tidy up at the end — the least
reliable place to put anything, since the sessions that most need cleaning up are the ones
that ended badly:

| Event | What GitHub does |
|---|---|
| Task PR merged, keyword never fired | Closes the issue as completed, archives the task file |
| Task PR closed **without** merging | Removes `arsenal:claimed` + the assignee, and supersedes the claim ref, so the task returns to the board genuinely claimable |
| Task file lands on the default branch | Opens its `arsenal:task` issue handle immediately |
| Claim held >24h with no open PR | Releases it — the session holding it crashed. This sweep is the only sanctioned way a claim is released; nothing else should decide a claim looks abandoned |
| Task PR opened with no closing keyword | Fails its check **before** the merge |

`/init` installs the workflow and prints what it does and what it can touch. It never runs
code from a pull request, and only a merge into the **default** branch completes a task —
a stacked PR merging into another branch is not done yet, exactly as the keyword itself
behaves. Deleting the file opts out for good: `/init` records `queue-automation = false` in
`arsenal/config.toml` rather than reinstalling it on the next session start.

A repo without the workflow still works — the merge path is unchanged — but a session there
has to expect stale claims and unhandled task files, and fix them before starting.

So the session-start protocol's job is genuinely to read the board and pick up work. If
step 3 or 4 reports problems in a repo that has the workflow, that is a signal something
is wrong, not the normal cost of starting.
