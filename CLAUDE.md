---
name: ai-chat-exporter
description: Browser extension to export AI chatbot conversations to multiple formats
---

# AI Chat Exporter

**For development, see: [`docs/dev/README.md`](docs/dev/README.md)**

Quick commands:
```bash
pnpm install     # Install
pnpm dev:chrome  # Develop
pnpm test        # Test
pnpm validate    # Check all
```

Documentation: `docs/README.md`

<!-- claude-arsenal: auto-managed -->
## Automatic session protocol

**Were you spawned by another session, with a task already assigned?** Then skip
straight to that task. Steps 2-5 below need the GitHub API, and a spawned session
has no `mcp__*` tools — implement, run the gate, and let
`claude-arsenal/bin/open_task_pr.sh` push. It prints `branch:<name>` when it
cannot open the PR here; return that line and stop. Never claim or release.

Otherwise, every session, without waiting to be asked:

1. Read `arsenal/session/handover.md` for the previous session's context.
2. List the repository's issues labelled `arsenal:task` — **open and closed** — and
   save the JSON. Use whatever GitHub access this surface has; run
   `claude-arsenal/bin/github_channel.sh --detect` to find out which. Request
   `number`, `title`, `state`, `labels`, `assignees` and **not `body`** — the bodies
   are the bulk of that fetch and nothing downstream reads them.
3. Run `python3 claude-arsenal/scripts/query_status.py --issues <that file>` for the
   board, and report anything it flags.
4. Pick up work: `python3 claude-arsenal/scripts/task_select.py --issues <that file>`
   returns the next unblocked task, then
   `bash claude-arsenal/bin/claim_task.sh <id>` takes it (see `@claude-arsenal/AGENTS.md`).
   - **Nothing returned + workspace plans exist** → seed tasks from each plan.
   - **Nothing at all** → ask what to work on.
5. Open each task's PR with `Closes #<issue>` so merging it closes the task by itself.
   Dispatching the work to another session instead? Pass the repository explicitly
   and pass `ARSENAL_TASK_ISSUE` — a spawned worker can resolve neither.
   → `claude-arsenal/references/orchestrator-tick.md`
6. After any session with tasks: update `arsenal/session/handover.md`.

@claude-arsenal/AGENTS.md
<!-- /claude-arsenal: auto-managed -->
