---
name: github
description: Use whenever the user is creating commits, opening pull requests, or waiting on PR review/CI feedback — applies Conventional Commits + branch naming, then polls the open PR for review-bot reactions and CI status, addresses each comment inline or replies, and reports when the PR is ready to merge. Triggers — "open a PR", "address review comments", "wait for Gemini / CodeRabbit", "is CI done?". Owns scripts — query_pr_state.py, query_project_type.py. Do NOT use for engineering review of a diff (see review), generic git mechanics like branching/worktrees (see execution), or hardcoding a Co-Authored-By model name (refused — the harness supplies model identity).
metadata:
  type: workflow
---

# github

Apply Conventional Commits + PR conventions, then run a tight, automated review loop instead of asking the user to relay bot comments by hand. After a PR is opened, this skill keeps an eye on the four things that gate a merge — **CI status, review-bot reactions (agents signal `:eyes:` → comments → `:+1:`/`:rocket:`), human/bot review comments, and merge-conflict state**; it addresses or pushes back on each comment, flags a conflicted branch for a rebase, then tells the user when the PR is ready to merge.

CANARY: github-loaded-2026-05-20-d436255c-54a7f770e04e4983

## When to load

After activation, confirm the task fits:

- The user asks to make a commit, open a PR, or amend a PR body.
- The user asks "is CI done?", "what did Gemini say?", or "address the review".
- A `/loop` cycle is checking PR state — see [pr-review-loop](references/pr-review-loop.md).

If the task is the *substance* of the review (judging whether a diff is correct, designing the fix), defer to the review or execution skill — this skill owns the *mechanics* of the review-bot dance, not the semantics of the change.

## Commit conventions

Conventional Commits: `<type>(scope): description`. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`. Scope is the module or domain. Imperative voice, no trailing period, first line ≤72 chars. Body separated by a blank line; explain *why*, not *what*.

Always end the commit with `Co-Authored-By: <ACTIVE-MODEL-NAME> <noreply@anthropic.com>`. **Never hardcode a model name** in skill prose, scripts, templates, or examples. The active model identity is supplied by the harness's git commit instructions — use that value verbatim. If a port from an older skill shows `Claude Opus 4.5` / `4.6` etc., strip the literal and replace with the live identity at commit time.

## PR conventions

Body template:

```
## Summary
<1-3 bullets>

## Test plan
- [ ] <verifiable check>
```

Branches: `feat/<short-description>`, `fix/<short-description>`. Main branch is `main`. The same dynamic Co-Authored-By rule applies inside the PR body (do not hardcode a model name there either).

## Pre-PR gate — always run host lint before `gh pr create`

Before any `gh pr create` invocation, run the host repo's full lint/format/test gate (whatever the project's Makefile / package.json exposes — e.g. `make lint`, `make smoke`, `npm run lint`). Pre-commit hooks do not always cover the same checks CI runs; relying on them alone is how PRs land red. Treat a clean local lint as a non-negotiable precondition for opening the PR — the agile review loop assumes CI was green at push time.

If the host project has no lint target, document that gap (propose a Makefile addition to the user) and proceed; but the omission is the proposal, not a license to skip.

## The agile review loop

After `gh pr create` returns the PR number, immediately enter the polling loop. **Inline the action rubric in the `/loop` prompt** — a bare `query_pr_state.py` invocation produces a JSON snapshot each tick and forces the LLM to re-derive what to do every time. Pass `--unresolved-only` so the loop does not re-trigger on already-addressed comments.

```bash
/loop 90s python3 "${CLAUDE_SKILL_DIR}/scripts/query_pr_state.py" --pr <PR_NUMBER> --unresolved-only — if state is bot_commented, address per the rubric (agree → fix + push + reply "addressed in <sha>" via gh api repos/<owner>/<repo>/pulls/<PR_NUMBER>/comments/<id>/replies; disagree → reply with rationale on the same endpoint; ambiguous → reply asking for clarification + ping the user). If conflicts, rebase onto (or merge) the base branch, resolve, and push; loop continues. If ci_failed, fetch the failing job log and fix + reply on any related comments. Every fix or dismissal MUST be paired with a reply on the thread — that is what makes --unresolved-only filter the comment on the next tick. Only stop the loop on ready_to_merge, merged, or closed — bot_approved still waits for the quiet window. When stopping, CronDelete <job-id> and hand back to user to merge.
```

`/loop` rounds `90s` up to `*/2 * * * *` (every 2 min) because cron has no sub-minute granularity. Stop early with `CronDelete <job-id>` — `/loop` prints the ID at scheduling time, and `CronList` recovers it later.

The script returns JSON to stdout and exits with:

| Exit | State |
|---|---|
| 0 | `bot_commented` (any bot line-comments — Claude judges per-comment) OR `ready_to_merge` OR `merged` / `closed` (PR no longer open — short-circuit, nothing to do) |
| 1 | `waiting` / `bot_eyeing` / `ci_running` / `bot_approved` (loop continues) |
| 2 | `conflicts` (merge conflict — rebase/resolve) OR `ci_failed` (Claude must act) |

Handle each state per the rubric in [pr-review-loop](references/pr-review-loop.md):

- `bot_eyeing` → loop continues. Bot owns clearing `:eyes:` by acting again. Exception: with `--unresolved-only`, when every comment the bot wrote is filtered out and the bot did review at some point, the script promotes the state to `bot_approved` / `ready_to_merge` — the loop has done its part and stale eyes lose their blocking force.
- `bot_commented` → for each comment in `bot_line_comments`, judge: **already addressed** (reply "addressed in <sha>"), **agree** (fix + push + **reply** "addressed in <sha>" — the reply is what `--unresolved-only` anchors on), **disagree** (reply with rationale via `gh api .../pulls/<N>/comments/<id>/replies`), or **ambiguous** (reply asking for clarification + ping the user). Loop continues after action. **Every fix or dismissal MUST be paired with a reply on the thread.**
- `conflicts` → the PR branch conflicts with its base. Rebase onto (or merge) the base branch, resolve the conflicts, and push. Loop continues. A conflicted PR cannot merge regardless of CI/review state, so this is surfaced first.
- `ci_failed` → fetch the failed log via `gh run view --log-failed <run-id>`, fix, push. Reply on any comments the fix relates to. Loop continues.
- `ready_to_merge` → exit the loop, tell the user "PR #N ready to merge".
- `merged` / `closed` → exit the loop immediately. PR is no longer open; nothing to do.

## Multi-PR stacking — autonomous sequential work

When a plan produces **N PRs that will be merged in sequence**, stack the branches from the start: each branch based on the previous (`fix/iss-B` branched from `fix/iss-A`), not all branched from `main`.

Rationale: if all branches share the same base, every PR that bumps `.bundle-version` creates a merge conflict for every subsequent PR — the three-way merge base is an ancestor commit that predates the previous PR's bump, so both sides appear to have changed the version. With stacking, only the first PR ever conflicts with `main`; the rest inherit the correct version from their parent.

**Version bump rule**: only the **last** PR in a stack bumps `.bundle-version`. Intermediate PRs ship content at the current version; the bump rides on the final PR so there is exactly one version-bump commit per release, never one-per-PR.

After each merge, immediately rebase the next waiting branch onto `main` to skip the now-merged commits:

```bash
# After fix/iss-A merges into main:
bash "${CLAUDE_SKILL_DIR}/../../init/assets/bin/rebase_stack.sh" fix/iss-B fix/iss-A
```

`rebase_stack.sh <branch> <old-base>` computes the fork point, runs `git rebase --onto origin/main`, and force-pushes with lease in one step. Cascade it down the remaining stack (B→C, C→D, …) after each merge.

## Project type — Classic vs v2

GitHub's Projects Classic silently breaks a few `gh` paths (notably `gh pr view --comments` and `gh pr edit --body`). On first use in a repo, run the detector:

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/query_project_type.py" --write-claude-md
```

Output: `classic` / `v2` / `none`. With `--write-claude-md`, the detector appends `<!-- github-skill: projects=v2 -->` (or `classic`) to the repo's `CLAUDE.md` if no such marker exists. Future sessions read the marker and skip re-detection. When the marker says `classic`, follow the workarounds in [projects-detection](references/projects-detection.md).

## References

- [projects-detection](references/projects-detection.md) — Projects Classic detection signal + Classic-only `gh` gotchas (load when the detector returns `classic`).
- [pr-review-loop](references/pr-review-loop.md) — bot state-machine table, default watched-bot list, comment-handling rubric (load when entering the loop).
