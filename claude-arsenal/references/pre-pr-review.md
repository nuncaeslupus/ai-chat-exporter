# Pre-PR adversarial review

Load this when a change is finished and a PR is about to be opened, or when an
open PR needs its review decided — from `execution`, `github`, `ship`, or a
worker before `open_task_pr.sh`. This page is the one description of the
protocol; the skills point here.

## Contents

- [The protocol](#the-protocol) — decide, run a round, record the verdict, publish it
- [Rounds](#rounds) — follow-ups, the cap, and the three ways out
- [Tests during review](#tests-during-review)
- [Handling BLOCK](#handling-block)
- [Where it binds](#where-it-binds) — which paths enforce this and which only ask
- [In a repo without the bundle](#in-a-repo-without-the-bundle)

---

Lint and tests catch what is broken; they cannot catch a change that works and
is not what was asked for, because the only reader so far shares the assumption
that produced it. The review is one reader that has never seen the work, given
the diff and the stated intent and nothing else.

## The protocol

### 1. Decide whether a round runs

**Before the PR exists** there are no external signals yet. Run one round on the
diff, with two exceptions: a docs-only or config-only diff gets none, and the
`strict` profile or a high-risk diff (`risk-paths`, more than `risk-lines`
changed lines) gets a full one, where the reviewer may also run the full suite.

**Once the PR exists**, ask what already covers it:

```bash
python3 claude-arsenal/scripts/review_sources.py --pr <N>
```

It prints one line per source (CI, each configured bot) and a `decision` line —
`local-review=none|diff|full  full-suite=skip|run  reason=…`. Follow that line:
it applies the `verification` profile (`fast | balanced | strict`) to what CI and
the bots actually did on this head. A bot that said it will not review this
head (rate limit, free-tier cap, "fewer than N stars", paused) is `unavailable`,
never `pending`, and the decision falls through to a local round at once. When a
bot is unavailable because it skipped, or is silent, run once with `--trigger`,
which posts the bot's configured trigger comment a single time per head; a
second silence is final. The decision line goes in the PR body.

### 2. Run a round

```bash
bash claude-arsenal/bin/adversarial_review.sh emit [--task <id>] [--intent <file>] [--checks <file>] [--base <ref>]
# spawn one cold reviewer subagent on the path emit printed
bash claude-arsenal/bin/adversarial_review.sh verdict [--task <id>]
```

`emit` captures the diff (committed, uncommitted and untracked together), the
intent, the rubric from `claude-arsenal/agents/reviewer.md` and a budget line
(`round R of M · B min · profile P`), and prints the packet's absolute path. The
directory ignores itself, so nothing the review writes lands in the PR.

- **`--task <id>`** on both commands when there is a task: it gives the round
  its own slot, so two workers sharing a tree keep their own verdicts.
- **`--base <parent-branch>`** on a stacked branch; the default base is
  `merge-base(default branch, HEAD)`, which would present the whole stack as new.
- **`--intent <file>`** when the intent is not `status/specification.md`.
  Auto-discovery falls back to that file, then `status/plan.md`, and says on
  stderr which it used; an archived spec there produces confident, irrelevant
  findings.
- **`--checks <file>`** to record lint and test results the author already ran
  on this tree, so the reviewer does not re-run them. Format and the rules for
  it: `references/performance-tuning.md` § Making a review round cheaper.

The reviewer's whole prompt is the packet path:

> Read `<the path emit printed>` and follow it. Write your full reply to
> `verdict.md` in the same directory.

Dispatch it with `models.reviewers` (falling back to `models.workers`) as the
dispatch's own `model` argument — `references/worker-loop.md` § Credit guards has
the snippet; a dispatch that names no model inherits the caller's. Pass nothing
else: no summary, no account of the approach, no conversation history. Each of
those hands the reviewer the author's blind spot, and the packet is complete
without them. The reviewer may read the repository freely.

Stop waiting at twice `review-budget-min` (default 10). Run `verdict` anyway; with
no reply it exits 2, and the round is recorded as timed out in the PR body.

### 3. Record the verdict

`verdict` reads `verdict.md`, which must end with exactly one `VERDICT:` line,
and writes a receipt bound to the digest of the reviewed tree.

| Exit | Meaning | Do |
|---|---|---|
| 0 | CLEAR | Open the PR, then record it for the digest (`references/digest.md` § 1). |
| 1 | BLOCK — a reviewer objected, and only that | Show the findings verbatim, fix the BLOCKERs, run a follow-up round (§ Rounds). |
| 2 | No usable verdict, or `emit` refused the round | Not a pass and not a BLOCK. Ask again, or read what `emit` printed. |
| 3 | The tree moved during the review | Re-emit and review the tree you have. |

`emit` exits 3 when there is nothing to review and 2 on a real error. The rubric
is read from the working tree, so a change that edits `agents/reviewer.md` is
judged by the edited rubric; review such changes with that in mind.

### 4. At ship time

`ship` reuses the verdict already on record: `adversarial_review.sh check`
exits 0 for a CLEAR receipt on the current tree. A new round runs only when
commits landed after the last reviewed tree (`check` exits 3) or none is on
record.

### 5. Publish the verdict on the PR

A receipt lives in one checkout; a merge decided elsewhere cannot see it. When
the verdict is about an open PR's head, publish it:

```bash
bash claude-arsenal/bin/adversarial_review.sh marker [--task <id>] --post <N>
```

It refuses unless the receipt is fresh and the reviewed tree is exactly the
committed `HEAD` (exit 2 on uncommitted changes, 3 when stale), then posts
`<!-- arsenal-review: verdict=… head=<sha> session=<id> -->` as a PR comment
(exit 5 with the body and the call to make when there is no GitHub channel).
`merge_ready.sh` reads it for the review half of `merge-policy`: under
`after-review` and `after-ci-and-review`, a CLEAR for the head SHA **is the
review** when no bot or human review is available on that head, and a BLOCK
blocks it. A bot review that lands later is still handled — fix or answer its
findings, in a follow-up PR if the change has merged. When the comment
is posted with the PR author's login, `[review] reviewer-identity` decides
whether a CLEAR counts: run this in the **reviewer's own session**, since a
subagent reports its parent's session id —
`references/github-automation.md` § A second reader that cannot approve.

## Rounds

`review-max-rounds` (default 2) bounds the rounds per branch. The count survives
rebases and base moves; it resets on a different branch or with `emit --reset`.
A round counts when `verdict` records it.

From round 2 the packet carries the previous reply verbatim, the delta since the
tree it read (`git diff-tree -p`), and a narrowed brief: is each prior BLOCKER
resolved, and does the delta add anything new. The full diff is not inlined;
the packet prints the commands to pull it.

- **A second round is only for BLOCKERs.** RISK and NOTE findings do not earn
  one: fix what is cheap and list the rest in the PR body.
- **`emit` refuses an unchanged tree** with exit 2. Re-reviewing identical code
  is asking for a different verdict, not a second opinion.
- **After the cap**, `emit` refuses with exit 2. Rounds that did not converge
  say the change carries more disagreement than one PR settles. Choose one:

| Exit | What it looks like |
|---|---|
| **split** | Drop the disputed part, open the rest, file the remainder as its own task. Usually the right one. |
| **override** | Open the PR, naming in its body which finding you judge a false positive, what you checked, and why. Not available under `pre-pr-review = "required"`, which refuses a tree with no CLEAR receipt. |
| **raise** | Set `review-max-rounds` higher in `arsenal/config.toml`, if this change genuinely needs it. On a cloud surface only the owner can: park the task with `bin/park_task.sh` and move on. |

## Tests during review

- The reviewer runs targeted tests only — the files covering the change, plus
  anything a finding of its own depends on. Mutation runs are for `strict`.
- The full suite runs once per tree. `fast_gate.sh --full` and
  `open_task_pr.sh`'s host gate write a receipt under
  `tmp/arsenal-gate/receipts/<tree-hash>` and reuse it while the tree is
  unchanged and clean.
- When CI is green on the PR head, the full suite does not run locally at all,
  except under `strict`; CI's run is the evidence.

## Handling BLOCK

Show the findings as written; paraphrasing makes them easier to dismiss, and the
findings are the record of what a cold reader saw. A finding can be wrong — the
reviewer works without your context. When you are confident it is a false
positive, say in the PR body which finding, why the repository already answers
it, and what you checked, then proceed. `ship` may do the same, since exit 1
always carries a reviewer's findings.

## Where it binds

`open_task_pr.sh` runs `adversarial_review.sh check` before it opens a task PR,
ahead of the host and task gates (their artifacts would otherwise move the tree
under the receipt), and writes the outcome — CLEAR, BLOCK, stale, or never run —
into the PR body. The receipt proves a verdict was recorded for the tree the
author produced. Two things are outside it and stated in the body: files a gate
leaves behind (gitignore them), and the task-file archive the helper adds itself.

`pre-pr-review` in `arsenal/config.toml` sets how hard it binds on that path:

| `pre-pr-review` | Effect |
|---|---|
| `warn` (default) | The task PR opens either way; the outcome is stated in its body. |
| `required` | No clearing verdict for the author's tree, no task PR. |
| `off` | Not checked, no line written in the body. |

On the `execution`, `github` and `ship` paths the review is a step of the skill's
own workflow: nothing wraps `gh pr create`, so it holds only as long as the
session follows the step. `review-max-rounds` applies on every path.

A worker on a surface that cannot spawn a subagent skips the review and says so
rather than reviewing its own work. Under `warn` the skip is recorded and the
queue moves on; under `required` that surface opens no task PRs.

## In a repo without the bundle

Where `claude-arsenal/bin/` does not exist, do the same by hand: put the diff
(`git diff <base>` plus untracked files) and the stated intent in one file,
spawn the reviewer on it with the rubric from `agents/reviewer.md` — in short,
*find every reason this should not merge; anchor each finding to `path:line`
with its trigger; report every finding with severity and confidence; no style;
end with `VERDICT: BLOCK — reason` or `VERDICT: CLEAR — reason`* — and apply the
same exits. Nothing checks freshness or counts rounds for you: re-review after
further edits, keep the previous reply for the follow-up, and stop at two rounds.
