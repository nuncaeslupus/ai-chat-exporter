# PR review loop — bot state machine + handling rubric

The agile review loop, triggered after `gh pr create`, runs `query_pr_state.py` on a 90-second cadence (via `/loop`). The script emits a JSON snapshot of the PR's review state and exits with a code that drives the next step.

## State machine

| Snapshot state | Trigger conditions | Exit | Next action |
|---|---|---|---|
| `merged` | `gh pr view`'s `state` field is `MERGED` | 0 | Exit the loop. Nothing to act on. |
| `closed` | `gh pr view`'s `state` field is `CLOSED` (closed without merge) | 0 | Exit the loop. Nothing to act on. |
| `waiting` | No watched-bot positive signal yet, OR bot opened `CHANGES_REQUESTED` with no line-comments | 1 | Loop continues. |
| `bot_eyeing` | A watched bot has reacted `:eyes:` on the PR header AND has not since thumbed/approved | 1 | Loop continues. The bot owns clearing the eyes — *unless* `--unresolved-only` is on and "everything addressed" fires (see below), in which case the script promotes to `bot_approved`/`ready_to_merge`. |
| `ci_running` | At least one CI check is `in_progress` / `queued` | 1 | Loop continues. |
| `ci_failed` | At least one CI check is `failure` | 2 | Fetch `gh run view --log-failed <run-id>`, fix, commit, push. Reply on any related comments. Loop resumes on next tick. |
| `bot_commented` | At least one (unfiltered, under `--unresolved-only`) watched-bot line-level comment exists on the PR | 0 | Address each comment per the rubric below. The reply on the thread is what causes `--unresolved-only` to drop it from the next tick. |
| `bot_approved` | CI green + explicit positive signal (thumb / APPROVED review) **OR** `--unresolved-only` "everything addressed" promotion + quiet anchor not yet elapsed | 1 | Loop continues. Quiet anchor = later of (last bot event, head commit). |
| `ready_to_merge` | Same as `bot_approved` + quiet window of `--min-quiet-seconds` (default 60) has elapsed | 0 | Exit loop. Tell the user `PR #N ready to merge`. |

**Terminal states short-circuit.** `merged` and `closed` are checked first, before anything else — once the PR is no longer open the loop has no work and exits.

**Eyes is a hard block — with one exception.** Without `--unresolved-only`, a watched bot's `:eyes:` reaction blocks `ready_to_merge` indefinitely; the bot owns clearing it. With `--unresolved-only`, if the filter dropped at least one comment AND no watched-bot comments remain AND the bot did engage at some point (line-commented or submitted a review), the script promotes the case to `bot_approved`/`ready_to_merge`. Rationale: the loop has provably addressed every concern the bot raised; the stale eyes can no longer block. This is the "**everything addressed**" path.

**No timestamp filter on comments.** By default the script returns ALL watched-bot line-level comments and leaves the judgment of "addressed vs not" to Claude per-comment. The previous heuristic ("addressed if older than head commit") was wrong — a later commit may fix something unrelated, leaving the original comment still outstanding. With `--unresolved-only`, GH-side resolution + human-reply detection moves the filtering into the script (see "How the script tracks 'addressed'" below).

**CI-only mode**: when invoked with `--watch-bots ""` (no bots configured), the script skips bot tracking. Green CI plus the quiet window past the head commit is enough to reach `ready_to_merge`.

**Silent approval requires a positive signal.** A bot that commented and then went silent is NOT silent approval. Silent approval requires either a `:+1:` / `:rocket:` reaction, an `APPROVED` review submission, OR — under `--unresolved-only` — every comment the bot wrote being addressed (replied to + filtered out). If none of those hold, the state stays `waiting` indefinitely. This is intentional: ambiguous silence should not auto-merge.

## Default watched bots

```
gemini-code-assist[bot]
coderabbitai[bot]
claude[bot]
```

Override with `--watch-bots gemini-code-assist[bot],custom-bot[bot]`. Empty list → no bots watched (CI-only mode).

## Comment-handling rubric

When `query_pr_state.py` returns `bot_commented`, its JSON payload includes a `bot_line_comments` array. Under `--unresolved-only` this only contains comments still needing attention; without the flag it contains every watched-bot line-comment on the PR. Each entry carries `id`, `user`, `path`, `line`, `body`, `created_at`.

Claude's job is to judge, for each comment, one of four outcomes:

| Claude's stance | Action |
|---|---|
| **Already addressed** | The current code already does what the comment asks (or the comment refers to a deleted file/line). Reply once via `gh api repos/<owner>/<repo>/pulls/<N>/comments/<comment-id>/replies -f body="addressed in <commit-sha>"`. The reply is what makes `--unresolved-only` filter the comment on the next tick. |
| **Agrees, not yet addressed** | Edit the file, stage, commit (`fix(<scope>): address review on <path>:<line>`), push, **then reply** "addressed in `<sha>`" via the same `pulls/<N>/comments/<id>/replies` endpoint. One commit per logical fix; bundling acceptable when ≥2 comments hit the same diff (reply on each thread, citing the same SHA). |
| **Disagrees** | Reply to the line-level comment with a one-paragraph rationale via `gh api repos/<owner>/<repo>/pulls/<N>/comments/<comment-id>/replies`. Cite the specific line. A disagreement is still a reply — it satisfies the human-reply heuristic and filters the thread out of the next tick. |
| **Ambiguous** (need user input) | Reply on the thread saying "asking the author for clarification" (or similar), then surface the comment to the user with the proposed options. Resume after they answer. The reply is mandatory — without it, the comment will re-fire on every tick. |

**Every fix or dismissal MUST be paired with a reply on the thread.** This is the contract that lets `--unresolved-only` work: it filters comments whose latest thread author is a `User`. A push without a reply does NOT count — the bot's comment stays the most recent, and the loop re-triggers on the next tick.

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
- **Always include the agree/disagree/ambiguous rubric inline in the `/loop` prompt** AND pass `--unresolved-only` to the script. A bare `/loop 90s python3 .../query_pr_state.py --pr <N>` produces a JSON snapshot each tick and forces the LLM to re-derive what to do from the skill body every time. `--unresolved-only` filters out comments whose review thread is GH-side resolved OR has a human reply (the "addressed in <sha>" pattern) so each tick stays focused on what actually still needs attention. The rubric-inlined form keeps each tick self-contained:

  ```
  /loop 90s python3 "${CLAUDE_SKILL_DIR}/scripts/query_pr_state.py" --pr <N> --unresolved-only — if state is bot_commented, address per the rubric (agree → fix + push + reply "addressed in <sha>" via gh api repos/<owner>/<repo>/pulls/<N>/comments/<id>/replies; disagree → reply with rationale on the same endpoint; ambiguous → reply asking for clarification + ping the user). If ci_failed, fetch the failing job log and fix + reply on any related comments. Every fix or dismissal MUST be paired with a reply on the thread — that is what makes --unresolved-only filter the comment on the next tick. Only stop the loop on ready_to_merge, merged, or closed — bot_approved still waits for the quiet window. When stopping, CronDelete <job-id> and hand back to user to merge.
  ```

- Termination: the loop exits as soon as `query_pr_state.py` returns `ready_to_merge` (exit 0 with `state: "ready_to_merge"`). Call `CronDelete <job-id>` to stop early — the `/loop` skill prints the job ID at scheduling time, and `CronList` recovers it later.
- Abort: Claude stops the loop if `query_pr_state.py` returns exit 2 with a state other than `ci_failed` (e.g. authentication error, repo not found). Surface the error to the user.

## Caveats

- **`:eyes:` reactions are sticky.** GitHub does not remove a bot's `:eyes:` automatically when the bot finishes its review; the bot owns the lifecycle. The script treats any present `:eyes:` from a watched bot as `bot_eyeing` (a hard block on `ready_to_merge`) unless the bot has also thumbed or approved.
- **Silent approval requires a positive signal.** A bot that posted a COMMENTED review and then went silent is NOT silent approval. Approval requires `:+1:` / `:rocket:` reaction or `APPROVED` review submission.
- **Priority-badge convention.** Some bots prefix comments with `![critical](...)`, `![high](...)`, `![medium](...)`, `![low](...)`. The script preserves the body verbatim; Claude reads the badge to triage which comment to address first.
- **CI-only mode.** `--watch-bots ""` skips bot tracking; only CI status drives the state machine. Useful for solo branches where no bots are configured.
