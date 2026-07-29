# Payload: D-16 — the release-side gate silently does not run

## Acceptance gate

**Gate**: `release.sh <id> done` either runs the task's mechanical gate or refuses
to record `done`. It must never record `done` having silently skipped the gate.

## The defect

`claude-arsenal/bin/release.sh:125`:

```bash
if [[ "${NEW_STATUS}" == "done" && -f "claude-arsenal/queue/${TASK_ID}.md" && -f "${GATE_RUN}" ]]; then
```

When the payload file is **absent from the tree release.sh runs in**, the whole
gate block is skipped and `done` is recorded unconditionally. The orchestrator's
main tree sits on the default branch, where payloads seeded during a session live
only on `arsenal-queue` — so this is not hypothetical.

**Measured on the 2026-07-28/29 session: 14 of 20 `done` releases had their gate
skipped this way** (`lo-3900`, `lo-8e3d`, `lo-f827`, `lo-a7ac`, `lo-db20`,
`lo-7372`, `lo-c39f`, `lo-a748`, `lo-e6b9`, `lo-656b`, `lo-1789`, `lo-18d4`,
`lo-f1e6`, `lo-19c0`). Each was still verified — the worker ran `gate_run.sh` in
its own worktree and the orchestrator confirmed green CI before merging — but the
*release-side enforcement*, which exists precisely so verification does not depend
on convention, was a no-op.

This is the same false-`done` family as `lo-19c0` (D-14) and `lo-2416`, arrived at
from the third direction: D-14 was "the gate could not run and said pass", this is
"the gate was never invoked at all".

## What changed that makes the fix possible

`lo-19c0` (PR #123) taught `gate_run.sh` to resolve a payload from the coordination
ref (`git show arsenal-queue:claude-arsenal/queue/<id>.md`) into a temp file
outside the repo when it is not on disk. So the `-f` precondition is now obsolete
— `gate_run.sh` can find the payload itself.

## The care needed

Simply deleting the `-f` guard makes **every** task without a payload fail `done`.
Decide what a payload-less task should mean:

- A task with no payload has no declared gate — arguably `done` is meaningless for
  it, and refusing is correct.
- Or: no payload → no mechanical gate → allow, but **say so on stdout**, so a
  skipped gate is visible rather than silent. Silence is the actual bug.

Either is defensible; silence is not. Whichever you choose, `gate_run.sh`'s new
exit 3 ("could not run") must stay distinct from "gate failed".

## Upstream

`claude-arsenal/bin/` is vendored bundle code that `/init` refreshes by checksum.
This fix, like D-14's, is reverted on the next `/init` unless it also lands in the
upstream claude-arsenal plugin repo — which is not reachable from a worktree. Say
so in the PR body.

## Tests

Extend `tests/gate_run_test.sh` (added by PR #123) or add a sibling: `done` with a
payload present runs the gate; `done` with the payload only on `arsenal-queue`
resolves and runs it; a failing gate refuses `done` in both cases.

## Location

`claude-arsenal/bin/release.sh`, `tests/gate_run_test.sh`.
