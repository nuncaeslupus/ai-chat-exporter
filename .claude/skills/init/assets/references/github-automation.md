# GitHub automation — merging, and the upkeep GitHub does

Read this when a merge did not close its task, when a PR check about the closing
keyword fails, when an unattended run stopped on a permission prompt, or when
deciding whether to install or remove `.github/workflows/arsenal-queue.yml`.

## Contents

- [Why an unattended run stops on a permission prompt](#why-an-unattended-run-stops-on-a-permission-prompt)
- [Completion — merging is the update](#completion--merging-is-the-update)
- [Ending a session is reporting, not repair](#ending-a-session-is-reporting-not-repair)
- [Merge policy — the host's standing answer to "may I merge this?"](#merge-policy--the-hosts-standing-answer-to-may-i-merge-this)
- [A fleet that stopped — `scripts/pr_audit.py`](#a-fleet-that-stopped--scriptspr_auditpy)
- [Reviewing the same head twice — `bin/claim_review.sh`](#reviewing-the-same-head-twice--binclaim_reviewsh)
- [Upkeep GitHub does — `.github/workflows/arsenal-queue.yml`](#upkeep-github-does--githubworkflowsarsenal-queueyml)

---

## Why an unattended run stops on a permission prompt

`/init` writes no `permissions.allow` block, because a seeded block would not
stop these prompts. The `mcp__github__*` tools already pass silently where the
account's GitHub connector grants them. The session tools (`create_session`,
`get_session` and siblings) are what prompt, for two reasons a committed file
cannot reach:

- A tool the server marks as requiring user interaction prompts on every call, in
  every permission mode, whatever the allow rules say.
- Project `permissions.allow` entries apply only once the user has trusted the
  workspace, which is stored outside the clone. A startup line reading
  `Ignoring N permissions.allow entries … this workspace has not been trusted`
  identifies this case.

What does help is dispatching one session per message
(`references/orchestrator-tick.md` § Dispatching a worker to another session).
Do not have a session widen its own permissions: writes to `.claude/` are checked
before allow rules on purpose, and a permission a fleet needs is its owner's
decision.

## Completion — merging is the update

No step asks anyone to finish a task. `open_task_pr.sh` resolves the task's issue,
writes `Closes #<issue>` into the PR body and the commit message, and moves the
task file into `tasks/_history/` with `status: merged` in the same diff, so one
merge closes the issue, archives the file and unblocks dependents. The body form
fires on a merge into the default branch; the commit form survives a squash and
closes the issue for a stacked PR when that commit lands. When it refuses for
want of an issue, follow `AGENTS.md` § Completion.

## Ending a session is reporting, not repair

`AGENTS.md` step 7 (audit open work, write a handover) is a report for the human;
nothing the next session needs depends on it. A merged PR has already closed and
archived its task, and an abandoned PR has released its claim, so a session that
ends abruptly still leaves the queue correct.

The one gap is a session that dies after claiming and before opening its PR: no
PR transition will release that claim. The `sweep-claims` job in
`arsenal-queue.yml` (`queue_hooks.py sweep-claims --max-age-hours 24`, daily)
does. Without the workflow nothing sweeps, and `query_status` counts the task
`claimed`, indistinguishable from live work. Release it by hand:

```bash
python3 claude-arsenal/scripts/queue_hooks.py sweep-claims \
    --repo <owner>/<name> --dry-run     # then drop --dry-run to apply
```

It needs `GH_TOKEN` or `GITHUB_TOKEN`; without one it says so and does nothing.
The rule for anything added later: a step that must happen before a session ends
belongs in a workflow or a script, because the sessions that most need it are the
ones that ended badly.

## Merge policy — the host's standing answer to "may I merge this?"

`arsenal/config.toml` carries `merge-policy`, and this is the step that reads it:

```bash
bash claude-arsenal/bin/merge_ready.sh <pr>     # 0 ready · 1 not · 3 policy is `never`
bash claude-arsenal/bin/merge_ready.sh <pr> --body   # ...and the merge commit body
python3 claude-arsenal/scripts/arsenal_config.py --get merge-policy   # the bare word
```

`merge_ready.sh` fetches the PR, the check runs for its head SHA and the reviews,
and hands them to `scripts/pr_audit.py` for the verdict. Use it rather than a
hand-written query, which tends to read an absent check as green or a summary
line as the finding list. Without a scriptable GitHub channel it prints the exact
calls to make and the command to pipe them into.

Run it last: second reader on the head, then the full gate once that reader
returns CLEAR on the same head, then `merge_ready.sh` (`references/orchestrator-tick.md`
§ Review before the full gate).

The host already decided, so both merging past the policy and asking a question
it answers are failures:

| Value | Merge when |
|---|---|
| `always` | The PR is open and `open_task_pr.sh`'s gates passed. Nothing further to wait for. |
| `after-ci` | Every required check on the head commit has **reported**, and is green. |
| `after-review` | A review has landed **and** every comment it raised is fixed or answered. CI is not consulted — this is the value for a repo with no CI, or whose CI is unavailable rather than failing. |
| `after-ci-and-review` | Both rows above: green checks on the head **and** either a bot/human review whose comments are all addressed, or — when none is available on the head — a clearing adversarial-review verdict recorded for the head SHA. |
| `never` | Never, by an agent. Report the PR as ready and stop; the human merges. |

On a private repo with metered Actions minutes, or no CI, `after-ci` waits
forever once checks stop reporting; the local-gates setting for that case is in
`references/ci-minutes.md`.

**Risk tiers — who approves.** With `[review] preset` set, `merge_ready.sh` also
asks `scripts/review_policy.py` what the PR's tier requires; `review_policy.py
explain` prints the effective flow. The tier comes from the changed files: `high`
on a `risk-paths` or `always-human-paths` match or more than `risk-lines` lines,
`low` when every file is in `low-paths` (default: docs/config), else `medium`.

| preset | low | medium | high |
|---|---|---|---|
| `solo-trust` | auto | agent | human-after |
| `solo-gated` | auto | human:1 | human:1 |
| `team` | agent | human:1 | human:2 |
| `manual` | — no agent merges — | | |

`agent` is a review clear on the head (bot review or adversarial CLEAR marker);
`human:N` adds N approvals **on the head SHA** from distinct trusted non-bot users
other than the author — a bot's or the author's approval counts zero, and an
approval of an older commit is stale (so when the agent opens PRs with the
owner's own account, `human:N` needs the agent on a separate GitHub identity);
`human:N` also needs the agent review itself, not just N humans; `human-after` merges on the agent review and
writes `Ratify: pending` for the human to confirm later. `approval-<tier>`
overrides one row; an `always-human-paths` match always needs one human.
`merge_ready.sh --body` carries the verdict as trailers on the merge commit:
`Risk-tier`, `Reviewed-by`, `Approved-by`, `Ratify`. A waiting PR is not a
blocked worker: report it and take the next task that does not depend on it.

**Branch protection is the other half.** `merge-policy` governs what an agent
waits for; it cannot stop a push that skips the PR. `/init` protects the default
branch once (`scripts/branch_protection.py`, recorded as `branch-protection`),
requiring only checks that reported on recent PRs, so both agree on "required".

**What counts as a review.** Whatever GitHub reports on the PR: a review from a
human collaborator or from any review bot installed on the repo. Read the PR's
reviews rather than matching a name, because a named reviewer goes stale when the
repo changes bots. **When no bot or human review is available** — the bot is
rate-limited, over a free-tier cap, skipped the repo ("fewer than N stars"), or
silent past `bot-wait-min` — the pre-PR adversarial review is the review: a
CLEAR published for the head SHA (§ A second reader that cannot approve)
satisfies `after-review` and `after-ci-and-review`. A PR with neither does not. "Fixed or
answered" means a fix paired with a reply, or a reply explaining the
disagreement; an unresolved thread is an unmet policy.

**A second reader that cannot approve.** GitHub refuses an approval from the PR's
author, so a reviewer posting with the author's credential (every session in a
one-account fleet) records its verdict as a marker comment instead:
`adversarial_review.sh marker --post <pr>`, run in the reviewer's own checkout of
the head after its `verdict`. It writes
`<!-- arsenal-review: verdict=CLEAR head=<sha> session=<id> -->` for the
committed head. Only markers from an OWNER/MEMBER/COLLABORATOR commenter or an App
are read; a BLOCK on the head blocks. Whether a CLEAR from the author's own login
counts is `[review] reviewer-identity`:

| Value | A CLEAR from the PR author's login |
|---|---|
| `distinct-login` | never counts — the marker must come from another login |
| `distinct-session` (default) | counts when its `session=` is none of the `Claude-Session:` trailers on the PR's commits; no session, a match, or no trailer to compare against is `unresolvable`, never clear, and the reason says the head was cleared via distinct-session |

Known gap: a subagent reports its parent's session id, so a reviewer spawned as a
subagent of the implementing session is refused. Run the reviewer as its own
session (claim the head with `claim_review.sh`).

**Who fixes, and who merges.** The findings are the session's work: verify each
against the code, fix the real ones, and reply with what changed and what was
rejected and why. Under `after-review` that loop is the whole gate, so merge
without further sign-off; `after-ci-and-review` needs the CI row too; under
`never` the human merges. Once the policy's conditions hold, stopping to ask is
as wrong as merging early.

**A summary line is not the finding list.** A bot can report "passed" or "review
completed" while leaving unresolved line comments. Read the comments themselves.

**When CI cannot report at all.** Absent is not green. A repo out of runner
minutes, with no workflows, or whose jobs die with no runner has produced no
evidence, so `after-ci` and `after-ci-and-review` stay unsatisfied. Say what is
missing and stop; the remedy is the host switching to `after-review` in
`arsenal/config.toml`, not an agent deciding at merge time.

**A conflicting PR produces no run either, and that is not an outage.** A
workflow on `pull_request` builds `refs/pull/<n>/merge`, which cannot be computed
while the PR conflicts, so no run, check or status appears at all. Ask before
concluding CI is unavailable:

```bash
gh pr view <n> --json mergeable,mergeStateStatus
# {"mergeable":"CONFLICTING","mergeStateStatus":"DIRTY"}
```

Waiting does not help here and `after-review` is not the escape hatch: merge the
base and resolve. `pr_audit.py` and `merge_ready.sh` already read `mergeable`;
do not read their blank CI column as an outage.

**Resolve the conflict last.** Merging the base moves the head, and every piece
of evidence (the review claim, the checks) is bound to a head. On a PR under
review, take the reader reports, fix the findings, then resolve the conflict, then
run the gate and re-read once on the final head.

**A rate-limited review bot is the same shape on the review side**: an external
quota, not a defect in the PR. `review_sources.py --pr <N>` reports such a bot as
`unavailable`, never `pending`, so the decision goes straight to the local
review; that review's published CLEAR is the review for the merge
(`references/pre-pr-review.md` § 5). Neither quota is a reason to weaken the
policy. **A bot review that arrives after the merge still counts as findings**:
fix or answer each one in a follow-up PR, as you would have before merging.

---

## A fleet that stopped — `scripts/pr_audit.py`

The policy answers "may I merge this PR?" but cannot see a stalled fleet: PRs
open with CI green, claims held and issues assigned, and no session working on
any of them.

```bash
python3 claude-arsenal/scripts/pr_audit.py --prs open-prs.json --claims claims.json
```

One row per open PR (head SHA, age, CI, review, and the one next action), plus
the claim refs with no open PR behind them, since a sandboxed session cannot
delete a claim ref and nothing else reports one that outlived its work. `--json`
for a machine, `--pr <n> --require-ready` for one PR's exit code. It does no
network I/O: hand it the payload GitHub returned, as with `query_status.py`, so it
works where `gh` does not.

## Reviewing the same head twice — `bin/claim_review.sh`

```bash
bash claude-arsenal/bin/claim_review.sh <pr> <head-sha>   # 0 won · 1 lost · 5 manual
```

The same compare-and-swap as `claim_task.sh`, under `arsenal/reviews/<pr>-<sha>`,
so two sessions do not both pay for a review of one tree. The head SHA is part of
the key because a review is about one tree: a new push is a new unit of work,
claimable by whoever gets there first.

## Upkeep GitHub does — `.github/workflows/arsenal-queue.yml`

These events happen when no session is running, so the workflow handles them:

| Event | What GitHub does |
|---|---|
| Task PR merged, keyword never fired | Closes the issue as completed, archives the task file |
| Task PR closed **without** merging | Removes `arsenal:claimed` + the assignee, and supersedes the claim ref, so the task returns to the board genuinely claimable |
| Task file lands on the default branch | Opens its `arsenal:task` issue handle immediately |
| Claim held >24h with no open PR | Releases it — the session holding it crashed. This sweep is the only sanctioned way a claim is released; nothing else should decide a claim looks abandoned |
| Task PR opened with no closing keyword | Fails its check **before** the merge |

`/init` installs the workflow and prints what it does and can touch. It never runs
code from a pull request, and only a merge into the default branch completes a
task, as with the keyword itself. Deleting the file opts out for good: `/init`
records `queue-automation = false` rather than reinstalling it.

Without the workflow the merge path still works, but stale claims and unhandled
task files must be fixed by hand (§ Ending a session is reporting, not repair).
In a repo that has it, problems reported at session-start steps 3–4 signal that
something is wrong, not the normal cost of starting.
