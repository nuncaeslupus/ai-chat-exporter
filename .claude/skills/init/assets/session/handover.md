# Session Handover

<!-- Written at session end. A new session reading this file can resume without additional context. -->

## Last task

- **ID**: <!-- e.g. lo-a3f8 -->
- **Title**: <!-- task title -->
- **Status at handover**: <!-- open | in_progress | done | blocked -->

## What was done this session

<!-- One-paragraph summary. Include commit SHAs if relevant. -->

## What remains

<!-- Bulleted list of sub-tasks or acceptance-criteria items not yet met. -->

## How to continue

1. Read `claude-arsenal/references/worker-loop.md` for the worker loop algorithm.
2. Run `python3 claude-arsenal/scripts/task_select.py --issues <issues.json>` for the next unblocked task.
3. If the last task is still `in_progress` with no active assignee, run:
   leave it: the next attempt claims the next attempt ref, so nothing needs requeueing.

## Surface profile at handover

<!-- Copy of arsenal/session/surface_profile.json contents for quick reference. -->

## Queue snapshot at handover

<!-- Output of: python3 .claude/skills/queue-status/scripts/query_status.py --detail -->
