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

Every session, without waiting to be asked:

1. Read `claude-arsenal/project/overview.md` (project + workspace index).
2. Read `claude-arsenal/session/handover.md` for last session activity.
3. Run `claude-arsenal/bin/queue_eval.sh`.
   - **Tasks available** → start worker loop (see `@claude-arsenal/AGENTS.md`).
   - **Queue empty + workspace plans exist** → seed from each workspace's plan, then workers.
   - **Queue empty + `status/plan.md` exists** → seed from it, then workers.
   - **Nothing** → ask what to work on.
4. After any session with tasks: update workspace handover + global session handover.

@claude-arsenal/AGENTS.md
