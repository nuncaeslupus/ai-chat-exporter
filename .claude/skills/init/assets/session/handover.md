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

1. Read `claude-arsenal/AGENTS.md` for the worker loop algorithm.
2. Run `claude-arsenal/bin/queue_eval.sh` to get the next unblocked task.
3. If the last task is still `in_progress` with no active assignee, run:
   `claude-arsenal/bin/release.sh <task_id> open` to requeue it first.

## Surface profile at handover

<!-- Copy of claude-arsenal/session/surface_profile.json contents for quick reference. -->

## Queue snapshot at handover

<!-- Output of: python3 .claude/skills/queue-status/scripts/query_status.py --detail -->
