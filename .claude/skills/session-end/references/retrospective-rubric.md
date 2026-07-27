# Retrospective rubric — pain signals, judgment, IMPROVEMENTS.md format

The retrospective is the load-bearing half of session-end. It is the mechanism by which recurring friction is converted into concrete skill updates that prevent the same friction next time.

## What the script extracts

`query_session_history.py` scans the last N session transcripts (`~/.claude/projects/<encoded-project>/*.jsonl`) and returns a JSON report with four signal buckets:

### 1. repeated tool errors

Same `tool_name` + the first line of its error message, seen ≥3 times across the scanned window. Returns top 10 by count.

```json
{
  "tool_name": "Bash",
  "first_line": "fatal: not a git repository",
  "count": 7,
  "sessions": ["session-uuid-1", "session-uuid-3"]
}
```

### 2. throwaway scripts

Files written to `tmp/` (via Write tool) that ended with `.sh` / `.py` / `.js` AND were not subsequently moved into a skill folder (no Bash `mv` / `cp` from that path to anywhere under `plugins/`, `.claude/`). Each entry carries: `path` (the `tmp/` filename), `session` (the session UUID), and `size_lines` (length of the written content).

### 3. repeated failing Bash commands

Same Bash `command` (normalized: stripped argv whitespace) with non-zero exit code, seen ≥2 times.

### 4. user-correction phrases

User messages matching any of:
- `\bno[, ]+don'?t\b`, `\bstop (doing|that)\b`, `\bdon'?t (do|use)\b`
- `\bwrong\b`, `\bI already (told|said)\b`, `\bagain\b.*\b(no|don'?t)\b`
- `\bnot (what|that)\b.*\b(asked|wanted|meant)\b`

For each match: the user message excerpt + the assistant turn that preceded it.

## How Claude judges the signals

The script returns *candidates*, not proposals. Most signals are noise. Claude reads each candidate and decides:

| Signal pattern | Treat as improvement when… | Skip when… |
|---|---|---|
| Repeated tool error | Same root cause every time + a skill claims to handle this domain | The errors are user-caused (typos, missing args) or one-off external flakes |
| Throwaway script | The script encodes a workflow ≥3 steps long, or it wraps a recurring shell pattern | It's a one-off ad-hoc helper (formatting / quick math / personal sanity check) |
| Repeated failing Bash | The failure is preventable by skill guidance or by a wrapper script | The user is iterating on a fix and the failures are part of that loop |
| User correction | Same correction phrase 2+ times across sessions on the same topic | The user is teaching Claude something brand-new (one-off) |

For each *accepted* candidate, Claude writes a proposal in the IMPROVEMENTS.md block format below.

## Proposal block format

Each proposal is a YAML front-matter block + a free-form rationale. Append to the appropriate file (per the routing table in SKILL.md):

```markdown
---
date: 2026-05-20
trigger: repeated-tool-error
skill: claude-arsenal:core:github
severity: medium
---

**Signal:** `gh pr edit --body` returned exit 0 but the body never changed.
Seen in sessions 3d76f307 (twice) and 25415324 (once). Root cause:
Projects Classic GraphQL trap (already documented in
`references/projects-detection.md`).

**Proposal:** add an automatic post-edit verification step to the github
skill's "edit a PR body" workflow — re-fetch the body, diff against what
was sent, fall back to REST PATCH on mismatch. Today the gotcha is
documented in prose; the skill should refuse to *report success* without
the diff check.

**Affected files:** `plugins/core/skills/github/references/projects-detection.md` (extend with verification step), `plugins/core/skills/github/SKILL.md` (mention verify-before-success rule).
---
```

Required keys: `date`, `trigger`, `skill`, `severity`. Free-form sections: `Signal`, `Proposal`, `Affected files` (or `Affected scripts` if it's a script add).

`trigger` values: `repeated-tool-error`, `throwaway-script`, `repeated-failing-bash`, `user-correction`.
`severity`: `low` (cosmetic / convenience), `medium` (notable friction), `high` (recurring blocker, missing skill, or broken workflow).

## Routing — where IMPROVEMENTS.md lives

| Run context | Target file |
|---|---|
| Inside the marketplace repo (`plugins/<plugin>/skills/<skill>/` exists relative to the proposal's skill) | `plugins/<plugin>/skills/<skill>/IMPROVEMENTS.md` (one file per skill; appended) |
| Anywhere else (consumer install — cache is volatile, edits would be wiped by `/plugin update`) | `~/.claude/proposed-skill-improvements/<YYYY-MM-DD>.md` (one file per day; user reviews offline and sends upstream) |
| Inside the marketplace repo, but the proposal targets a skill that doesn't yet exist (e.g. "we need a new skill for X") | `IMPROVEMENTS.md` at the repo root — surface to user, they decide which plugin owns it |

`IMPROVEMENTS.md` files are NOT gitignored in the marketplace repo. They serve as the audit trail — a future maintainer reading the file sees what was proposed, when, and whether it was acted on. Acted-on proposals can be moved to `IMPROVEMENTS.md.archive` or deleted on commit, owner's choice.

## What the user sees at end of session

Claude does NOT just dump the script's raw JSON at the user. The script output is the input to Claude's judgment. After judging, Claude says something like:

> Retrospective scanned 6 sessions (last 7 days). Three signals look real:
>
> 1. **github skill — `gh pr edit --body` trap** (3 hits across 2 sessions). Proposal drafted at `plugins/core/skills/github/IMPROVEMENTS.md`.
> 2. **session-end skill — `tmp/handoff_*.sh` throwaway pattern** (4 hits, 1 session). Proposal drafted at `plugins/core/skills/session-end/IMPROVEMENTS.md`.
> 3. **(not surfaced — 2 hits, root cause was a local git config issue, not a skill gap)**
>
> Want me to commit the proposals as part of the handoff?

If the user agrees, Claude commits the IMPROVEMENTS.md changes alongside `status/handoff.md` (when handoff mode is `yes`) so they ride together into the PR.

## Cadence and false-positive avoidance

- Default window: 7 days OR 10 sessions, whichever is smaller (script defaults).
- The script ignores sessions shorter than 5 user messages (likely abandoned).
- Tool errors from the meta-skill validator (`validate.py` finding `must` issues) are NOT signals — those are working as designed.
- User corrections that are followed by "actually nevermind" or `git revert` in the same session are dropped (the user re-thought, not Claude failed).
