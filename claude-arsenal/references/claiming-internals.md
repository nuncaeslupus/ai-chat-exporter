# Claiming — why ref creation is the lock

Read this when a claim misbehaves, when you are tempted to work around a `lost`,
or when claim refs start showing up in CI. The contract a session actually
follows — the four outcomes — is in `AGENTS.md`; this is the mechanism behind it.

Two different problems, and conflating them is what made the old design complicated.

**Someone else already holds it.** A human assigned themselves the issue, or a worker is
on it. This is not a race — it happened long before — so it is a precondition check:
refuse to claim a task whose issue is closed, has an assignee, or carries
`arsenal:claimed`.

**Two agents want the same free task.** This *is* a race, and note that an assignee
cannot settle it: every session authenticates as the same GitHub identity, so
"is it assigned?" cannot tell two agents apart. Only the claim ref can.

```
POST /repos/{owner}/{repo}/git/refs   →  201 for exactly one caller
                                      →  422 "Reference already exists" for the rest
```

Creating a ref is a compare-and-swap decided by GitHub. There is no settle interval, no
tie-break, and no window in which two agents both believe they won. It needs no worktree,
no shared branch, and no push — which is why it works on a sandbox that only permits
pushing the session's own working branch.

**Marking the issue.** After winning, self-assign, add `arsenal:claimed`, and comment
with the session id from `CLAUDE_CODE_REMOTE_SESSION_ID`, falling back to
`CLAUDE_CODE_SESSION_ID`. Do not invent an id — the old code read `CLAUDE_SESSION_ID`,
which is not set on any current surface, so every claim was attributed to a process id.

**Retries and crashes.** A claim ref cannot be deleted from a sandboxed session, so it is
never released — it is superseded. Attempt *n* claims `<prefix>/<id>.a<n>`, bounded by the
task's `max-attempts`. A crashed session therefore blocks nothing.

A suffixed attempt is not a free pass around a live claim, so `claim_task.sh` refuses any
attempt above 1 unless `ARSENAL_CLAIM_STALE_OK=1` says the caller has *checked* that the
previous attempt is dead. That acknowledgement is the whole safety property here: a
running session and a crashed one present identically from outside, and the ref is the
only thing standing between them and two agents on one task.

**Two costs to know about.** Claim refs accumulate, roughly one per task ever claimed,
grouped under `arsenal/claims/` — prune them from a CLI session occasionally, but only
refs whose task is finished or whose claim has been swept. The ref *is* the lock: deleting
a live one lets a second session claim a task the first is still working. Confirm the
owner and confirm the claim is stale before deleting anything under `arsenal/claims/`. And creating
a ref fires GitHub's `push`/`create` events, so a repository whose workflows trigger on an
unfiltered `on: push` will run CI on every claim; scope them with
`branches-ignore: ['arsenal/**']`.
