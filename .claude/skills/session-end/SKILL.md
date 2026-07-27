---
name: session-end
description: Use whenever the user signals end-of-job, invokes /session-end, or a Stop hook fires at conversation close — three steps. (1) write status/handoff.md if host repo opts in; (2) retrospective scan for repeated errors and proposed skill updates; (3) PR audit — checks CI, review comments, and merge conflicts on session PRs, prints a review table. Triggers — "wrap up", "we're done", "/session-end", "end-of-job". Do NOT use mid-job or for cross-session memory.
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
- A Stop hook fires at conversation close (opt-in setup — see [auto-fire-setup](references/auto-fire-setup.md)).
- The github skill is about to open a PR and the handoff marker is `yes` — this skill regenerates `status/handoff.md` before the PR commit.

Do not load mid-job. The retrospective wants a complete arc to scan.

## Step 1 — handoff (opt-in)

**Spec-alignment check (always, before writing the handoff).** Ask: did this
session ADOPT or LOCK any architecture decision? If yes, verify the spec and
plan actually reflect it — workspace projects keep them at
`claude-arsenal/project/<WORKSPACE>/spec.md` + `plan.md`; otherwise they are
`status/specification.md` + `status/plan.md`. If they don't, either update them now or seed a
queue task before ending — a decision that lives only in handover prose drifts,
because the handover is a snapshot the next session overwrites while the spec,
plan, and queue are the ledger. The same rule applies to any blocking spec
divergence found this session (see the vendored `AGENTS.md` "Divergence
handling" section): seed it as a queue task, don't leave it in prose.

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

Collect every task in `done` or `in_progress` status from `claude-arsenal/queue/tasks.jsonl`
that carries a `pr` field, then check each PR for CI, review comments, and merge conflicts.

**When `gh` CLI is available:**
```bash
gh pr view <pr-url> --json title,state,mergeable,reviewDecision,statusCheckRollup \
  --jq '{title,state,mergeable,reviewDecision,ci:([.statusCheckRollup[]?|.conclusion]|unique)}'
```

Run this for each PR URL, then print a summary table:

| Task | PR | CI | Reviews | Mergeable | Action needed |
|---|---|---|---|---|---|
| lo-a3f8 | #42 | ✓ passing | approved | yes | — |
| lo-b2c1 | #43 | ✗ failing | changes_requested | yes | Fix CI + respond to review |
| lo-c3d4 | #44 | pending | — | CONFLICTING | Rebase required |

Mark any PR as **BLOCKED** if: CI is failing, there are `CHANGES_REQUESTED` reviews, or the branch has merge conflicts. Print this table to stdout so the user can review and approve before the session closes.

**When `gh` is not available** (web, or no GitHub CLI):
Print the PR URL list directly from the queue, with task IDs and titles, so the user can check them manually:
```
PRs from this session requiring human review:
  lo-a3f8  #42  https://github.com/…/pull/42  — T1: Implement claim.sh
  lo-b2c1  #43  https://github.com/…/pull/43  — T2: Auth gate
```

**Always include escalated tasks** in the summary (they need human reset, not PR review):
```
Escalated tasks (exhausted retry cap — no PR opened):
  lo-c3d4  attempts=3/3  T3: Data migration
  → Recovery: release.sh lo-c3d4 open --reset-attempts  (from claude-arsenal/bin/)
```

## Auto-fire (opt-in)

Stop-hook setup (so this skill fires at conversation close without an explicit `/session-end`) and the skip override (`tmp/.skip-next-session-end` sentinel file) are documented in [auto-fire-setup](references/auto-fire-setup.md). Both are user-installed via the update-config skill; this skill does not modify settings.json on its own.

## References

- [handoff-mode](references/handoff-mode.md) — CLAUDE.md marker syntax, `status/handoff.md` template, ticket-mode alternative (load when Step 1 runs).
- [retrospective-rubric](references/retrospective-rubric.md) — pain-signal catalog, judgment rubric, IMPROVEMENTS.md block format (load when Step 2 surfaces proposals).
- [auto-fire-setup](references/auto-fire-setup.md) — Stop-hook config snippet + skip-override sentinel (load when wiring auto-fire).

## Workspace-aware paths

When `claude-arsenal/project/<WORKSPACE>/` exists, write the Step 1 handoff to `claude-arsenal/project/<WORKSPACE>/handover.md` and refresh the cross-workspace `claude-arsenal/session/handover.md` instead of `status/handoff.md`. Otherwise use `status/handoff.md` as above. The handoff opt-in marker still governs whether Step 1 runs at all.
