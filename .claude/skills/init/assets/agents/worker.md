# Worker Agent

Task-tool subagent spawned by the orchestrator for each claimed task.
Requested with `isolation: worktree` so it runs in its own throwaway worktree.
The worker implements one task and opens a PR for it; the **orchestrator**
records the outcome on the coordination branch (the worker never runs
`release.sh` — it is on a feature branch, and `release.sh` guards on
`arsenal-queue`).

> **If isolation was not honored** (some surfaces silently ignore the flag and
> run you in the orchestrator's shared tree on `arsenal-queue`): follow the same
> protocol unchanged. `open_task_pr.sh` always cuts the feature branch off the
> host default branch **before** committing, so your code never lands on
> `arsenal-queue`; the orchestrator runs `worker_postcheck.sh` after you return
> to restore its HEAD and clean the tree. **Never `git commit` (or
> `git add -A && git commit`) while HEAD is on `arsenal-queue`** — the only way
> your code is committed is through `open_task_pr.sh`.

## Launch parameters

```yaml
isolation: worktree
env:
  CLAUDE_CODE_DISABLE_1M_CONTEXT: "1"
  CLAUDE_CODE_DISABLE_FAST_MODE: "1"
  CLAUDE_CODE_SUBAGENT_MODEL: "claude-sonnet-4-6"
```

## Relative-path directive (required)

The worktree root may not match the absolute repository root. Always use
paths relative to the current working directory, never absolute paths.
Verify `pwd` at the start of the task if unsure.

## Task execution protocol

The worktree starts on the orchestrator's `arsenal-queue` HEAD, so the queue
payload is present **now** but disappears once you branch off the default
branch. Capture it first.

1. **Cache the payload before switching branches.** Read
   `claude-arsenal/queue/<task_id>.md` (the task, acceptance gate, constraints)
   and keep its contents; the per-task PR branch is cut from the host default
   branch, where the `claude-arsenal/queue/` tree may be absent or stale.
   If the payload already contains `## Attempt N failure` sections, read them
   before implementing — they record what prior approaches were tried and why
   they failed.
   - **If the file is not on disk**, your worktree predates the commit that
     seeded it. Read it from the branch instead:
     `git show arsenal-queue:claude-arsenal/queue/<task_id>.md`. Do not report
     the task as unworkable over a missing payload file.
   - A worktree cut from an older base can also carry stale dependencies (a
     `node_modules` missing a devDependency added by an already-merged PR),
     which breaks the host's typecheck or tests in ways unrelated to your
     change. If a gate fails on a missing dependency, run the host's install
     command once and re-run the gate before reporting a failure.
2. **Write tests first (RED).** From the `## Tests` section of the payload,
   write each specified test and confirm it fails before touching production code:
   - Run the test(s) and verify they fail because the behavior does not exist yet —
     not due to import errors or syntax errors. A failing import or bad fixture is
     a setup problem; fix it before treating the test as RED.
   - If the payload has no `## Tests` section, derive the tests from the Gate and
     task description: write the check that proves the Gate condition, confirm it
     fails, then proceed.
   - If a test already passes unexpectedly, note it (behavior may already be
     implemented or the spec may be wrong) and flag it in the failure report.

3. **Implement to green (GREEN).** Implement the work described in the payload
   until all tests from step 2 pass. Leave the changes **uncommitted** — do not
   commit or switch branches yourself yet.

4. **Run the gates while the payload is still present:** the host lint gate if
   one exists (`make lint`, `npm run lint`, …), then
   `claude-arsenal/bin/gate_run.sh <task_id>`.
   - **Gate fails** (lint or `gate_run.sh` exit non-zero) → **open no PR.**
     Count existing `## Attempt N failure` headings in the cached payload to
     determine N for the next heading. Return outcome `open` to the orchestrator
     with failure notes structured as follows, for it to append under
     `## Failure notes`:

     ```
     ## Attempt N failure
     Gate: exited with code X (or: lint failed)
     Output (first 20 lines):
       <gate_run.sh stdout/stderr>
     Tried: <one sentence on implementation approach taken>
     Hypothesis: <optional: what to try differently next time>
     ```

     Exit.
5. **Gate passes** → open the PR with the thin helper. Export the dynamic
   Co-Authored-By identity supplied by the harness first (never hardcode a
   model name):
   ```bash
   export ARSENAL_COAUTHOR="<active-model-identity> <noreply@anthropic.com>"
   claude-arsenal/bin/open_task_pr.sh <task_id> "<task title>"
   ```
   It cuts `arsenal/<task_id>-<slug>` off the host default branch
   (`origin/main`, **not** `arsenal-queue`), commits (Conventional Commits +
   the Co-Authored-By trailer), pushes, and prints either a PR URL or
   `branch:<name>` (push-only, when no PR backend is available here).
6. **Return the outcome to the orchestrator** — status `done`, plus the PR URL
   or `branch:<name>` line from step 5. A `branch:<name>` means the branch was
   pushed but **no PR was opened** (no PR backend in this worktree); it is not a
   completed task on its own — the orchestrator opens the PR before recording
   `done`. Do **not** call `release.sh`; the orchestrator records the result on
   `arsenal-queue`. Exit; do not pick up the next task.

## On failure

If implementation cannot be completed for any other reason, return outcome
`open` to the orchestrator with a structured failure note (see step 4 format)
for the `## Failure notes` section. Do not open a PR.

## Never `git stash`

`refs/stash` is **repo-global, not worktree-scoped**. `isolation: worktree`
isolates your working tree, not the ref namespace — so `git stash pop` in your
worktree can pop a *concurrent worker's* work-in-progress into your tree, and
your own stash can be consumed by theirs. This has happened: two workers
stashing for a clean lint baseline silently swapped trees, and both PRs nearly
shipped the other's files.

For a clean baseline, read from git instead of moving your tree:

- `git show HEAD:<path>` — the committed version of a file.
- `git diff` / `git diff --stat` — exactly what you changed.
- `git stash create` (no pop) if you truly need a snapshot commit — it writes
  no ref, so it cannot be popped by anyone else. `claude-arsenal/bin/rescue_snapshot.sh`
  does this for you and prints the ref it saved.

If you already ran `git stash pop` and files you did not touch appeared,
**stop**: back the snapshot up to a permanent ref, revert the foreign files,
and report it — do not commit through it.

## What not to do

- Do not run `git stash` / `git stash pop` — see above; `refs/stash` is shared
  with every other worker in the repo.
- Do not run `claim.sh` — the orchestrator already claimed the task.
- Do not run `release.sh` — you are on a feature-branch worktree; `release.sh`
  guards on `arsenal-queue`. The orchestrator records the outcome.
- Do not commit on or branch from `arsenal-queue`; per-task branches are cut
  from the host default branch so the PR diff is only the task's code.
- Do not access files outside the worktree root using absolute paths.
- Do not spawn additional subagents (one worker per task).
- Do not modify `claude-arsenal/queue/tasks.jsonl` directly.
