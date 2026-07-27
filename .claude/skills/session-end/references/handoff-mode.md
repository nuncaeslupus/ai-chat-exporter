# Handoff mode — CLAUDE.md marker, template, ticket alternative

The session-end skill writes `status/handoff.md` only when the host repo opts in. Opt-in is signaled by a one-line marker in the repo's root `CLAUDE.md`:

```html
<!-- session-end: handoff=yes -->
<!-- session-end: handoff=ticket -->
<!-- session-end: handoff=no -->
```

If no marker exists, the skill prompts once on first run and writes the marker per the user's answer. Subsequent sessions read the marker and skip the prompt.

## `handoff=yes` — the canonical handoff flow

The skill writes `status/handoff.md` (committed in the repo, not gitignored). The file is rewritten each session — a *replacement*, not an append — so the next session has a clean, current handoff at a stable path. Old handoffs survive only in git history.

Template (rendered by `create_handoff.py`):

````markdown
# Handoff — <one-line topic / stage name>

## TL;DR

<2-3 sentence summary of the session's outcome and what blocks moving forward>

## State

- Branch: `<branch-name>` (status: <ahead/behind, PR #N if any>)
- Active plan: `<absolute path to plan file, or "none">`
- Last green smoke: `<command + result>`

## DONE this session

- <bullet, with file paths and the why>
- <bullet, with file paths and the why>

## TODO — pick up here

1. <next action, with concrete file:line where applicable>
2. <next action>

## DO NOT TOUCH

- <files/dirs that were approved-as-is this session>
- <upstream artifacts (other PRs in flight, etc.)>

## Reproducible sanity commands

```bash
<verbatim shell line that proves "it works" right now>
```
````

The `create_handoff.py` script writes the template to `status/handoff.md` with placeholders intact; Claude fills in the placeholders from conversation context before staging. The script will not overwrite a non-template handoff.md unless `--force` is passed; Claude prefers a `--merge` mode (load existing, surface diffs, merge) for partial sessions but the default is full rewrite.

The handoff file is **part of the next PR**, not a separate commit. The github skill's PR-creation step picks up the staged `status/handoff.md` along with the rest of the diff.

## `handoff=ticket` — one ticket per session

Some projects work in tight ticket-per-session loops (e.g. `aworkers:triage-issues` patterns where one bug = one PR = one closed ticket). The PR description itself plus the closed-ticket trail are sufficient continuation — a handoff.md would just duplicate the PR body.

In ticket mode, session-end's Step 1 is a no-op. Step 2 (retrospective) still runs.

## `handoff=no` — opt out

Project doesn't use the handoff flow. Both Step 1 and Step 2 still run by request, but Step 1 is a no-op. Useful for solo experiments / one-off scripts where there's no "next session" to hand off to.

## Marker stewardship

The marker lives in the repo's root `CLAUDE.md`. If the file doesn't exist, the skill creates it (with just the marker — does not generate full CLAUDE.md content). If multiple markers are present, the first one wins; the skill warns the user.

Consumers who switch modes mid-project edit the marker by hand; this skill never silently rewrites it.

## Why `status/` not `tmp/`

`tmp/` is the conventional dump for gitignored throwaway. `status/` is a committed directory specifically for state files the team wants in git history (handoffs, deploy logs, on-call snapshots). The handoff IS history — it's the trace of how a long-running effort moved from one session to the next. Committing it makes the trail audit-able even after the working branch is squash-merged.
