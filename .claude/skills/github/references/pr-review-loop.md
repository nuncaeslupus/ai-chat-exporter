# PR review loop — bot state machine + handling rubric

The agile review loop, triggered after `gh pr create`, runs `query_pr_state.py` on a 90-second cadence (via `/loop`). The script emits a JSON snapshot of the PR's review state and exits with a code that drives the next step.

## State machine

| Snapshot state | Trigger conditions | Exit | Next action |
|---|---|---|---|
| `merged` | `gh pr view`'s `state` field is `MERGED` | 0 | Exit the loop. Nothing to act on. |
| `closed` | `gh pr view`'s `state` field is `CLOSED` (closed without merge) | 0 | Exit the loop. Nothing to act on. |
| `waiting` | No watched-bot positive signal yet, OR bot opened `CHANGES_REQUESTED` with no line-comments | 1 | Loop continues. Bounded: a silent bot becomes `bot_absent` after `bot-wait-min` (plus one more wait after a trigger). |
| `bot_eyeing` | A watched bot has reacted `:eyes:` on the PR header AND has not since thumbed/approved | 1 | Loop continues. The bot owns clearing the eyes — *unless* `--unresolved-only` is on and "everything addressed" fires (see below), in which case the script promotes to `bot_approved`/`ready_to_merge`. |
| `ci_running` | At least one CI check is `in_progress` / `queued` | 1 | Loop continues. |
| `ci_failed` | At least one CI check is `failure` | 2 | Fetch `gh run view --log-failed <run-id>`, fix, commit, push. Reply on any related comments. Loop resumes on next tick. |
| `bot_commented` | At least one (unfiltered, under `--unresolved-only`) watched-bot line-level comment exists on the PR | 0 | Address each comment per the rubric below. The reply on the thread is what causes `--unresolved-only` to drop it from the next tick. |
| `bot_approved` | CI green + explicit positive signal (thumb / APPROVED review) **OR** `--unresolved-only` "everything addressed" promotion + quiet anchor not yet elapsed | 1 | Loop continues. Quiet anchor = later of (last bot event, head commit). |
| `bot_skipped` | Every watched bot is out on this head, at least one by a skip or pause notice | 0 | Exit loop. Run the local review the `decision` field names (see below). |
| `bot_rate_limited` | As above, at least one by a rate-limit or quota notice | 0 | Same. Do not re-request the review on a short cadence. |
| `bot_absent` | As above, by silence past `bot-wait-min` (after the one trigger, when `bot-triggers` has one) | 0 | Same. |
| `ready_to_merge` | Same as `bot_approved` + quiet window of `--min-quiet-seconds` (default 60) has elapsed; or a `bot_*` state whose decision is `none`, or with `--local-review-done` | 0 | Exit loop. Tell the user `PR #N ready to merge`. |

**Terminal states short-circuit.** `merged` and `closed` are checked first, before anything else — once the PR is no longer open the loop has no work and exits.

**Eyes is a hard block — with one exception.** Without `--unresolved-only`, a watched bot's `:eyes:` reaction blocks `ready_to_merge` indefinitely; the bot owns clearing it. With `--unresolved-only`, if the filter dropped at least one comment AND no watched-bot comments remain AND the bot did engage at some point (line-commented or submitted a review), the script promotes the case to `bot_approved`/`ready_to_merge`. Rationale: the loop has provably addressed every concern the bot raised; the stale eyes can no longer block. This is the "**everything addressed**" path.

**No timestamp filter on comments.** By default the script returns ALL watched-bot line-level comments and leaves the judgment of "addressed vs not" to Claude per-comment. The previous heuristic ("addressed if older than head commit") was wrong — a later commit may fix something unrelated, leaving the original comment still outstanding. With `--unresolved-only`, GH-side resolution + human-reply detection moves the filtering into the script (see "How the script tracks 'addressed'" below).

**A bot's check conclusion is not its finding list.** A review bot reports a
check run (`gh pr checks` shows it as `pass` / `Review completed`) separately
from the comments it leaves, and the two disagree: a PR can show a green bot
check while carrying unresolved line comments that name real defects. This loop
is not exposed to that — `query_pr_state.py` reads the comments endpoint
directly and never consults the rollup — but a session checking PR status by
hand between ticks is. Read the comments, not the check.

**CI-only mode**: when invoked with `--watch-bots ""` (no bots configured), the script skips bot tracking. Green CI plus the quiet window past the head commit is enough to reach `ready_to_merge`.

**Silent approval requires a positive signal.** A bot that commented and then went silent is not silent approval. Approval is a `:+1:` / `:rocket:` reaction, an `APPROVED` review, or — under `--unresolved-only` — every comment the bot wrote being addressed. Silence never merges on its own: it ends the wait as `bot_absent`, which asks for a local review instead.

## Which bots are watched

None by default (since 5.19.0): the loop runs CI-only until the repo names its bots.

Name them once, in `arsenal/config.toml`:

```toml
review-bots = ["reviewer[bot]"]
```

`--watch-bots reviewer[bot],custom-bot[bot]` still overrides it per call.

**Name only bots that actually review here.** A listed bot that never posts is
the expensive failure: every tick waits for a signal nothing will ever send, and
the loop sits at `waiting` until someone reads the JSON and works out why. The
empty default is the same CI-only mode as
`--watch-bots ""` — green CI plus the quiet window is enough to reach
`ready_to_merge`, and nothing ever reports `bot_commented`.

Know what that costs before setting it: the bot half of the gate is the half
that reads the diff. With it off, `ready_to_merge` means the machines agree and
nobody looked. If the repo has a human reviewer instead, `merge-policy =
"after-ci-and-review"` is where that goes — this key only governs what the loop
waits on, not what the merge requires.

## Comment-handling rubric

When `query_pr_state.py` returns `bot_commented`, its JSON payload includes a `bot_line_comments` array. Under `--unresolved-only` this only contains comments still needing attention; without the flag it contains every watched-bot line-comment on the PR. Each entry carries `id`, `user`, `path`, `line`, `body`, `created_at`.

Claude's job is to judge, for each comment, one of four outcomes:

| Claude's stance | Action |
|---|---|
| **Already addressed** | The current code already does what the comment asks (or the comment refers to a deleted file/line). Reply once via `gh api repos/<owner>/<repo>/pulls/<N>/comments/<comment-id>/replies -f body="addressed in <commit-sha>"`. The reply is what makes `--unresolved-only` filter the comment on the next tick. |
| **Agrees, not yet addressed** | Edit the file, stage, commit (`fix(<scope>): address review on <path>:<line>`). After the round's last fix, run the fast gate once (`fast_gate.sh`, never the full suite) and push once, **then reply** "addressed in `<sha>`" on each thread via the same `pulls/<N>/comments/<id>/replies` endpoint. One commit per logical fix, one push per round: every push is a CI run wherever CI fires per push. |
| **Disagrees** | Reply to the line-level comment with a one-paragraph rationale via `gh api repos/<owner>/<repo>/pulls/<N>/comments/<comment-id>/replies`. Cite the specific line. A disagreement is still a reply — it satisfies the human-reply heuristic and filters the thread out of the next tick. |
| **Ambiguous** (need user input) | Reply on the thread saying "asking the author for clarification" (or similar), then surface the comment to the user with the proposed options. Resume after they answer. The reply is mandatory — without it, the comment will re-fire on every tick. |

**Pair every fix or dismissal with a reply on the thread.** This is the contract that lets `--unresolved-only` work: it filters comments whose latest thread author is a `User`. A push without a reply does NOT count — the bot's comment stays the most recent, and the loop re-triggers on the next tick.

Never silently skip a comment. Every comment gets *some* response — code change + reply, reply alone, or escalation to user + holding reply.

## How the script tracks "addressed"

By default the script does not — it returns ALL bot line-comments and pushes the judgment to Claude per-comment. The previous timestamp-based heuristic ("addressed if older than the head commit") was wrong: a later commit may fix something unrelated, leaving the original comment still outstanding.

Pass `--unresolved-only` and the script filters comments via a GraphQL fetch of the PR's review threads. A comment is considered **addressed** (and dropped from the output) when its thread satisfies either:

- `isResolved: true` on the GH-side — someone (you or the bot) clicked "Resolve conversation"; or
- the most recent comment in the thread is from a `User` (i.e., a human replied — the canonical "addressed in `<sha>`" pattern).

Bot replies do NOT count as resolution — only human follow-ups or explicit GH-side resolution do. This matches what `/loop` consumers actually want: each tick stays focused on comments the bot is still waiting on, and a single `gh api .../comments/<id>/replies -f body="addressed in <sha>"` is enough to take a comment out of the next tick's output.

The fetch costs one extra GraphQL call per tick (~50 ms typical), well under the rate-limit budget at the documented `/loop 90s` cadence.

## Loop control

- Cadence: `/loop 90s …`. Lower than 60s risks hitting `gh` rate limits on long-running PRs; higher than 120s slows the user.
- **Cron's floor is 1 minute.** `/loop` converts `Ns` to `ceil(N/60)m`, so `90s` schedules as `*/2 * * * *` (every 2 min) — it does NOT poll sub-minute. Treat the `90s` figure as user-facing intent; the underlying cron cadence is 2 min. If you genuinely need every-minute polling, write `/loop 1m …` and accept the higher API load.
- **Pass `--unresolved-only` and let the `next` field drive each tick.** A bare `/loop 90s python3 .../query_pr_state.py --pr <N>` forces the LLM to re-derive what to do from the skill body every time. `query_pr_state.py` prints, with each state, the action for it in `next` (the agree/disagree/ambiguous rubric below for `bot_commented`), so the loop prompt stays one line:

  ```text
  /loop 90s python3 "${CLAUDE_SKILL_DIR}/scripts/query_pr_state.py" --pr <N> --unresolved-only --trigger — do what its "next" field says for the printed state (bot_approved still waits for the quiet window); on ready_to_merge, merged or closed, CronDelete <job-id> and hand back to the user.
  ```

- Termination: the loop exits as soon as `query_pr_state.py` returns `ready_to_merge` (exit 0 with `state: "ready_to_merge"`). Call `CronDelete <job-id>` to stop early — the `/loop` skill prints the job ID at scheduling time, and `CronList` recovers it later.
- Abort: Claude stops the loop if `query_pr_state.py` returns exit 2 with a state other than `ci_failed` (e.g. authentication error, repo not found). Surface the error to the user.

## When no bot will review this head

`query_pr_state.py` asks `review_sources.py` (the bundle's `scripts/` folder; `claude-arsenal/scripts/` in a consumer) what each watched bot did on the current head. It reads the bots' reviews, their check runs and statuses by description (some bots report a green status that says "Review skipped"), and their comments as they read now (some bots edit one summary comment in place). The notice phrases live in one table at the top of that script; add a row when a vendor rewords one.

The wait is bounded. A bot silent for `bot-wait-min` (default 20) after the head push is `absent`. With `--trigger` and a `bot-triggers` entry for it, the loop first posts that command once for this head (a paused bot gets its resume command) and waits once more; silence after that is final. Whatever the bot posts after that trigger on the same head is read as its answer to it, so an acknowledgement ("Review triggered", even one explaining when the command applies) keeps it pending for that one wait instead of ending the loop as skipped; only a rate limit is final there. A rate-limited bot is not pinged: its notice is the answer for this head. Running `review_sources.py --pr <N> [--trigger]` by hand prints the same classification.

When every watched bot is out, the loop ends with `bot_skipped`, `bot_rate_limited` or `bot_absent`, and the payload's `decision` names what replaces the bot: `local_review` (`none`, `diff`, `full`) and `full_suite` (`skip`, `run`), from the `verification` profile and the change's risk. Run that review through the review protocol; once its verdict is CLEAR (`adversarial_review.sh check` exits 0), rerun with `--local-review-done` and the state becomes `ready_to_merge` when CI is green. A decision of `none` needs no flag.

Some bots allow only a few on-demand reviews per hour (one, on some free tiers). The quota is per account, not per PR: the next PR triggered inside the hour gets a rate-limit notice and falls through to the local review, which is correct but spends the bot on whichever PR the loop happened to tick first. With several PRs open, trigger the one where a bot review is worth most — the riskiest or largest change — first.

Some bots also gate automatic reviews on the repository itself. CodeRabbit, if a repo uses it, does not auto-review a repo with fewer than 10 GitHub stars; on a public repo it still reviews when asked with `@coderabbitai review` (about one on-demand review per hour per account), so give it that `bot-triggers` entry. On a private repo on its Free plan it posts only a summary or walkthrough, never a line review, so the local review the loop falls through to is the review there.

Trigger commands are set once in `arsenal/config.toml`, for example `bot-triggers = ["yourbot[bot]=@yourbot review"]`; the value `request-reviewer` requests the bot as a reviewer instead of commenting. Some bots ignore commands posted by bot accounts such as `github-actions[bot]`, so post triggers as a user.

## Caveats

- **`:eyes:` reactions are sticky.** GitHub does not remove a bot's `:eyes:` automatically when the bot finishes its review; the bot owns the lifecycle. The script treats any present `:eyes:` from a watched bot as `bot_eyeing` (a hard block on `ready_to_merge`) unless the bot has also thumbed or approved, or has since been classified skipped, rate-limited or absent.
- **Priority-badge convention.** Some bots prefix comments with `![critical](...)`, `![high](...)`, `![medium](...)`, `![low](...)`. The script preserves the body verbatim; Claude reads the badge to triage which comment to address first.
- **CI-only mode.** `--watch-bots ""` skips bot tracking; only CI status drives the state machine. Useful for solo branches where no bots are configured.
