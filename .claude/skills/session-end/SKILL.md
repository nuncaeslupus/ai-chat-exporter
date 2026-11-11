---
name: session-end
description: Wraps up a session — optional handoff, skill-update proposals from repeated errors, a PR audit. Use when the user signals the job is done. Not for mid-job checkpoints.
metadata:
  type: workflow
---

# session-end

End-of-job wrap-up in three steps: an opt-in handoff, a retrospective that proposes
skill updates from recurring friction, and a report on the session's PRs.

CANARY: session-end-loaded-2026-05-20-4896c0a5-8ca7505c91dc34e6

## When to load

- The user types `/session-end` or says "wrap up", "we're done", "close this session".
- The opt-in auto-fire `SessionStart` hook runs (about once a week).
- The github skill is about to open a PR and the handoff marker is `yes`, so
  `status/handoff.md` is regenerated before the PR commit.

Mid-job is too early: the retrospective needs a complete arc to scan.

## Step 1 — handoff (opt-in)

First, if this session adopted or locked an architecture decision, make sure the
spec and plan say so (`arsenal/project/<WORKSPACE>/spec.md` + `plan.md`, or
`status/specification.md` + `status/plan.md`), or seed a queue task for it. A
blocking spec divergence found this session becomes a queue task too. An idea or
decision raised this session but missing from `status/ideas.md` is a handover item.
The handoff is a snapshot the next session overwrites; the spec, plan and queue are
the ledger.

Then read the host repo's `CLAUDE.md` for the marker:

| Marker | Behavior |
|---|---|
| `<!-- session-end: handoff=yes -->` | Generate `status/handoff.md` from the session, commit it. |
| `<!-- session-end: handoff=ticket -->` | Skip (one session = one ticket; the PR description suffices). |
| `<!-- session-end: handoff=no -->` | Skip (the project does not use handoffs). |
| (no marker) | Ask the user once which mode this repo uses, then write the marker. |

When the mode is `yes`, load [handoff-mode](references/handoff-mode.md) for the template, then:

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/create_handoff.py" --output status/handoff.md
```

The script renders the template; fill in the session-specific content (done, to do,
repro, do-not-touch) from the conversation, then write the file.

## Step 2 — retrospective

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/query_session_history.py" --days 7 --limit 10
```

The JSON report lists mechanical signals: repeated tool errors, throwaway scripts in
`tmp/`, repeated user corrections, repeated failing commands. Judge which are
recurring friction rather than normal noise, and offer the user a short list of
skill-update proposals. Once they accept one, load
[retrospective-rubric](references/retrospective-rubric.md) for the block format and
append each accepted proposal to:

| Where the session runs | Target file |
|---|---|
| This marketplace repo (`plugins/<plugin>/skills/<skill>/` exists) | `plugins/<plugin>/skills/<skill>/IMPROVEMENTS.md` |
| Anywhere else | `~/.claude/proposed-skill-improvements/<YYYY-MM-DD>.md` |

## Step 3 — PR audit (when a queue exists)

Before the audit, render the review digest and hand it over in this reply
(`claude-arsenal:core:init § references/digest.md` § 2), so what waits on the user
reaches them even after a long unattended run.

This step reports and repairs nothing: merged task PRs already closed their tasks,
and the queue workflow releases abandoned claims, so a session that ends abruptly
still leaves a correct queue.

Task issues carry no PR link, so map open PRs to tasks by branch:
`open_task_pr.sh` names each `arsenal/<task-id>-<slug>`. Take the open PRs on such
branches, plus every claimed task (no PR yet shows as escalated or in progress),
and check each PR:

```bash
gh pr list --state open --json number,headRefName --jq '.[] | select(.headRefName | startswith("arsenal/"))'
```

```bash
gh pr view <pr-url> --json title,state,mergeable,reviewDecision,statusCheckRollup \
  --jq '{title,state,mergeable,reviewDecision,ci:([.statusCheckRollup[]?|.conclusion]|unique)}'
```

Print a table for the user to review before the session closes:

| Task | PR | CI | Reviews | Mergeable | Action needed |
|---|---|---|---|---|---|
| t-a3f8 | #NNN | ✓ passing | approved | yes | — |
| t-b2c1 | #NNN | pending | — | CONFLICTING | Rebase required |

Mark a PR **BLOCKED** when CI fails, a review requests changes, or the branch
conflicts. Without `gh`, list task id, PR URL and title for a manual check. Always
list escalated tasks (retry cap exhausted, no PR) separately: they need a human
reset, not a PR review.

## Auto-fire (opt-in)

A detached `SessionStart` hook can run this skill about once a week without an
explicit `/session-end`. The user installs it through the update-config skill; this
skill never edits `settings.json` itself. Load
[auto-fire-setup](references/auto-fire-setup.md) when the user wants to wire it up,
skip the next run, or asks why an installed auto-fire is not firing.

## Workspace-aware paths

When `arsenal/project/<WORKSPACE>/` exists, Step 1 writes
`arsenal/project/<WORKSPACE>/handover.md` and refreshes `arsenal/session/handover.md`
instead of `status/handoff.md`. The marker still decides whether Step 1 runs.
