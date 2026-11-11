# Claims — stale claims, retries and lost races

Load when a claim is refused, looks stale, or a task needs a retry attempt.

## Why `lost` is final

A claim is a ref created through a compare-and-swap that GitHub arbitrates, so
exactly one agent proceeds. Claiming a different ref or re-running with another
attempt number to get past a `lost` recreates the double-claim the ref exists to
prevent. Take the next task instead.

## Stale claims

`arsenal:claimed` left by a session that crashed would otherwise keep a task
visible but unclaimable. `queue_hooks.py sweep-claims --max-age-hours 24`
releases those after confirming no open PR is behind the claim; where
`.github/workflows/arsenal-queue.yml` is installed it runs on a schedule. Leave
the release to the sweep, because a live session's claim and a dead one look
identical from inside another session. After a sweep the task is simply
unclaimed again and the loop picks it up normally.

## Retries

Attempt 2 claims `<id>.a2`, and `claim_task.sh` requires
`ARSENAL_CLAIM_STALE_OK=1` to acknowledge the first attempt is stale. Stale
means the sweep released the claim or the owning session is known to have
stopped. A closed PR is not proof: the session behind it may still be running,
and joining it is a double-claim.

Past `max-attempts` the task stops being offered and needs a person. Read the
task file's `## Failure notes` before re-dispatching it.

## The claim comment

The comment names the owning session from `CLAUDE_CODE_REMOTE_SESSION_ID` (a
`cse_…` value that doubles as a session URL), or `CLAUDE_CODE_SESSION_ID` on a
local session. When neither is set, say so in the comment rather than writing a
made-up id, since the comment exists to show who holds the task.
