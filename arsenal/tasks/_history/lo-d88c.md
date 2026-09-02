---
id: lo-d88c
title: "Reimplement the Gemini parser from scratch (previous WIP was destroyed)"
priority: 10
workspace: "GEMINI"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/41
---

## Acceptance gate

**Gate**: `GeminiParser.canParse()` returns true against a freshly captured Gemini
DOM fixture, and `extractQAPairs` returns correctly-paired Q&A with non-empty

Prose-only gate — verified by worker judgment, no script to run.

content, proven by fixture tests.

## Why this task exists

`src/core/parsers/gemini/parser.ts` is a 43-line placeholder: `extractQAPairs`
is unimplemented, so the parser cannot produce a conversation. A previous session
had ~335 lines of working-tree implementation; it was **destroyed** on 2026-07-28
by an orchestrator running `worker_postcheck.sh` (`git reset --hard` +
`git clean -fd`) in the main working tree. Never staged, unrecoverable.

This task is the rewrite. It supersedes the "patch the selector" framing of
`lo-4d4a`, which assumed that implementation existed.

## Do this first

Load the **parser-generator** skill. It encodes the live-capture workflow, the
selector-durability ranking, and the content-type traps learned from the ChatGPT
repair — all of which apply directly here.

## Findings that still hold (verified against the real captured DOM)

- `conversation-ui` (the current `conversationContainer`) matches **0** elements.
- `class="conversation-container"` appears 10 times but is the *message* element.
- Containers are `<chat-window>` / `<infinite-scroller>`.
- `katex-html` × 14, `katex-mathml` × 0 — Gemini ships **no** MathML fallback, so
  the shared maths-collapse rule in `base-parser.ts` must keep falling through to
  `.katex-html`. There is an existing test for this; do not regress it.

## Work

1. Capture a fresh Gemini DOM from a conversation created for the purpose, with
   invented data (headings, lists, table, code, maths, and an artifact chip if
   reachable). Never capture a real user conversation — fixtures are committed.
   Scan for personal identifiers; use `main.outerHTML`, not `documentElement`.
2. Verify every selector against that capture, not against any payload text.
3. Implement `extractQAPairs`, `canParse`, `getTitle`, `getModel`,
   `getButtonInjectionPoint` against the real `BaseParser` contract. Every
   selector comes from `GEMINI_SELECTORS` — none inlined.
4. Fixture tests: RED before, GREEN after.

## Related, still open

- `lo-194d` — the manifest gap; the content script never loads on Gemini at all, so
  nothing works end-to-end until that lands too.
- `lo-485e` — registering the parser in `parserRegistry` (currently commented out).
- `lo-1316` — artifact chips and thinking extraction.
- `lo-3920` — fixtures and tests; overlaps heavily with step 1 here. Read it and
  decide whether to fold it in or keep it separate.
