---
id: lo-e5f2
title: "Strip debug console.log from parser and exporter hot paths"
priority: 6
workspace: "DEADCODE"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/105
---

## Acceptance gate

**Gate**: no `console.log` in per-message, per-node or per-artifact loops; production build ships no conversation content to the console.


Prose-only gate — verified by worker judgment, no script to run.

## Sites

- `src/core/services/html-content-parser.ts:334-346` — `parseInlineContent` logs on **every** text/bold/italic/code/link node, and its argument object computes `Array.from(element.children).some(...)` unconditionally. A 100-row table means 500+ extra allocations purely for logging.
- `src/core/parsers/base-parser.ts:154-158, 185-192` — logs `answer.metadata` and 500-char content previews per Q&A pair.
- `src/core/parsers/claude/parser.ts` — 32 call sites, many inside per-turn/per-artifact loops.
- `src/core/services/claude-api-service.ts` — 40 call sites, including full conversation and HTML dumps.

Two costs, not one: the CPU in hot loops, and logged object references keeping parsed conversation data alive in devtools console history for as long as it is open — user conversation content sitting in memory indefinitely.

Keep a small number of deliberate `console.error` calls on failure paths; delete the rest or put them behind a debug flag stripped in production builds.
