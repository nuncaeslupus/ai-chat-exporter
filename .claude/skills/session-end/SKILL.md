---
name: session-end
description: Use whenever the user signals end-of-job, invokes /session-end, or the opt-in SessionStart auto-fire hook runs — three steps. (1) write status/handoff.md if host repo opts in; (2) retrospective scan for repeated errors and proposed skill updates; (3) PR audit — checks CI, review comments, and merge conflicts on session PRs, prints a review table. Triggers — "wrap up", "we're done", "/session-end", "end-of-job". Do NOT use mid-job or for cross-session memory.
metadata:
  type: workflow
---

# session-end

End-of-job ritual. Three steps run unconditionally when this skill is invoked:

1. **Handoff** (opt-in per-project): if the host repo's `CLAUDE.md` has the marker `<!-- session-end: handoff=yes -->`, write/update `status/handoff.md` from the current session state and stage it so it lands in the next PR.
2. **Retrospective** (always): scan the last N session transcripts for pain signals (repeated errors, throwaway scripts, repeated user corrections, unexpected tool behavior), then surface concrete skill-update proposals.
3. **PR audit** (always, when a queue exists): collect every `done`/`in_progress` task that carries a PR URL, check CI status + review comments + merge-conflict state for each, and print a review table for human approval.

CANARY: session-end-loaded-2026-05-20-4896c0a5-8ca7505c91dc34e6

## When to load

- The user types `/session-end` or says "wrap up", "we're done", "close this session".
- The opt-in auto-fire hook runs: a detached `SessionStart` hook, about once a week (setup — see [auto-fire-setup](references/auto-fire-setup.md)).
- The github skill is about to open a PR and the handoff marker is `yes` — this skill regenerates `status/handoff.md` before the PR commit.

Do not load mid-job. The retrospective wants a complete arc to scan.

## Step 1 — handoff (opt-in)

**Spec-alignment check (always, before writing the handoff).** Ask: did this
session ADOPT or LOCK any architecture decision? If yes, verify the spec and
plan actually reflect it — workspace projects keep them at
`arsenal/project/<WORKSPACE>/spec.md` + `plan.md`; otherwise they are
`status/specification.md` + `status/plan.md`. If they don't, either update them now or seed a
queue task before ending — a decision that lives only in handover prose drifts,
because the handover is a snapshot the next session overwrites while the spec,
plan, and queue are the ledger. The same rule applies to any blocking spec
divergence found this session (see "Divergence handling" in the vendored
bundle's `queue-seeding.md`, under `claude-arsenal/references/`): seed it as a
queue task, don't leave it in prose.

Read the host repo's `CLAUDE.md` and look for one of:

| Marker | Behavior |
|---|---|
| `<!-- session-end: handoff=yes -->` | Generate `status/handoff.md` from the session, commit it. |
| `<!-- session-end: handoff=ticket -->` | Skip handoff write (one session = one ticket; PR description suffices). |
| `<!-- session-end: handoff=no -->` | Skip handoff write (project doesn't use the handoff flow). |
| (no marker) | Ask the user once which mode this repo uses, then write the marker. |

Handoff content + template + ticket-mode alternative live in [handoff-mode](references/handoff-mode.md).

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/create_handoff.py" --output status/handoff.md
```

The script renders the template with placeholders; Claude fills in the session-specific content (DONE / TODO / repro / no-touch lists) from conversation context, then writes the file.

## Step 2 — retrospective (always)

Scan the last N session transcripts for pain signals:

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/query_session_history.py" --days 7 --limit 10
```

The script extracts mechanical signals (repeated tool errors, throwaway scripts in `tmp/`, repeated user-correction phrases, repeated failing Bash commands) and emits a JSON report. Claude reads the report, judges which signals are real improvement opportunities (most error spikes are normal; what matters is *recurring* friction), and surfaces a short list to the user.

For each accepted proposal, Claude writes a YAML+MD block to the right location:

| Where Claude is running | Target file |
|---|---|
| Inside this marketplace repo (`plugins/<plugin>/skills/<skill>/` exists) | `plugins/<plugin>/skills/<skill>/IMPROVEMENTS.md` (appended; commit later) |
| Anywhere else (consumer install, cache is volatile) | `~/.claude/proposed-skill-improvements/<YYYY-MM-DD>.md` (appended; user reviews offline) |

Format and rubric for the proposal block live in [retrospective-rubric](references/retrospective-rubric.md).

## Step 3 — PR audit (always when queue exists)

**This step reports; it does not repair.** Nothing the next session needs depends on it
running. A merged task PR has already closed and archived its task (`open_task_pr.sh`
writes `Closes #<issue>` and the `_history/` move into the PR), and an abandoned one has
already had its claim released by `.github/workflows/arsenal-queue.yml`. So a session that
ends without ever reaching this skill still leaves a correct queue — which is the point,
because the sessions that end abruptly are the ones that would have skipped it anyway.
Anything shaped like "and remember to update X" belongs in the workflow or in a script,
never in this step.

Collect every claimed task and every task whose PR is open, from the `arsenal:task` issues
that carries a `pr` field, then check each PR for CI, review comments, and merge conflicts.

**When `gh` CLI is available:**
```bash
gh pr view <pr-url> --json title,state,mergeable,reviewDecision,statusCheckRollup \
  --jq '{title,state,mergeable,reviewDecision,ci:([.statusCheckRollup[]?|.conclusion]|unique)}'
```

Run this for each PR URL, then print a summary table:

| Task | PR | CI | Reviews | Mergeable | Action needed |
|---|---|---|---|---|---|
| lo-a3f8 | #NNN | ✓ passing | approved | yes | — |
| lo-b2c1 | #NNN | ✗ failing | changes_requested | yes | Fix CI + respond to review |
| lo-c3d4 | #NNN | pending | — | CONFLICTING | Rebase required |

Mark any PR as **BLOCKED** if: CI is failing, there are `CHANGES_REQUESTED` reviews, or the branch has merge conflicts. Print this table to stdout so the user can review and approve before the session closes.

**When `gh` is not available** (web, or no GitHub CLI):
Print the PR URL list directly from the queue, with task IDs and titles, so the user can check them manually:
```text
PRs from this session requiring human review:
  t-3f8a91c2  #NNN  https://github.com/…/pull/NNN  — Extract the surface probe
  lo-b2c1  #NNN  https://github.com/…/pull/NNN  — T2: Auth gate
```

**Always include escalated tasks** in the summary (they need human reset, not PR review):
```text
Escalated tasks (exhausted retry cap — no PR opened):
  lo-c3d4  attempts=3/3  T3: Data migration
  → Recovery: the next attempt claims <id>.a2; past max-attempts a human decides
```

## Auto-fire (opt-in)

A `SessionStart` hook fires this skill about once a week without an explicit `/session-end`, detached so the starting session sees nothing. That trigger, the weekly stamp behind it, the `SessionEnd` alternative, and the skip override (`tmp/.skip-next-session-end`) are documented in [auto-fire-setup](references/auto-fire-setup.md). All are user-installed via the update-config skill; this skill does not modify settings.json on its own.

## References

- [handoff-mode](references/handoff-mode.md) — CLAUDE.md marker syntax, `status/handoff.md` template, ticket-mode alternative (load when Step 1 runs).
- [retrospective-rubric](references/retrospective-rubric.md) — pain-signal catalog, judgment rubric, IMPROVEMENTS.md block format (load when Step 2 surfaces proposals).
- [auto-fire-setup](references/auto-fire-setup.md) — the detached `SessionStart` hook, why not `SessionEnd`, weekly stamp, skip-override sentinel (load when wiring auto-fire, or when an installed auto-fire is not firing).

## Workspace-aware paths

When `arsenal/project/<WORKSPACE>/` exists, write the Step 1 handoff to `arsenal/project/<WORKSPACE>/handover.md` and refresh the cross-workspace `arsenal/session/handover.md` instead of `status/handoff.md`. Otherwise use `status/handoff.md` as above. The handoff opt-in marker still governs whether Step 1 runs at all.
