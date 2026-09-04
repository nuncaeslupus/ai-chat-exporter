---
id: lo-e9b2
title: "Forced sync layout in image loops and six cleanup passes per message"
priority: 4
workspace: "PERF"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/77
---

## Acceptance gate

**Gate**: no forced layout read inside per-image loops; `cleanupElement` makes one pass, not six.


Prose-only gate — verified by worker judgment, no script to run.

1. `src/core/parsers/chatgpt/parser.ts:438-450` and `:519-530` — inside `forEach` over `<img>` elements, any image without explicit width/height triggers `getComputedStyle()` plus `clientWidth`/`clientHeight` reads, each forcing a synchronous style/layout recalc. ChatGPT's generated images typically lack those attributes, so an image-heavy conversation thrashes layout on every re-parse.
2. `src/core/parsers/base-parser.ts:203-233` — `cleanupElement` runs six separate `querySelectorAll` passes over the same cloned subtree, once per message. A 600-message conversation is ~3,600 subtree traversals where one combined selector pass would do.

Both are estimates from reading the code, not profiles — measure before and after on a long conversation rather than trusting the reasoning.
