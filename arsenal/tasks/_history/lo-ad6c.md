---
id: lo-ad6c
title: "Print functionality: formatted print view and print dialog"
priority: 5
workspace: "UI"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/137
---

## Acceptance gate

**Gate**: the Print context-menu entry opens the browser print dialog showing the formatted conversation, with no extension chrome in the output.


Prose-only gate — verified by worker judgment, no script to run.

## References

- `src/extension/background/` — context menus are already hierarchical (shipped in v1.1.1)
- `src/core/exporters/html-exporter.ts` — reuse its output as the print document instead of writing a second formatter
- `docs/dev/development-plan.md` — "Print Functionality" is High Priority #3

## Context

Lazy path: render the existing HTML export into a hidden iframe / new tab and call `print()`. A dedicated print pipeline is not warranted unless the HTML export proves unusable on paper.
