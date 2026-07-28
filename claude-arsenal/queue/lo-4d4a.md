# Payload: lo-4d4a — Gemini selectors never match the real DOM

## Acceptance gate

**Gate**: `canParse()` returns true against the captured Gemini DOM, and a fixture test proves it.


Prose-only gate — verified by worker judgment, no script to run.

## The defect

`src/core/parsers/gemini/selectors.ts:13` sets `conversationContainer: 'conversation-ui'`. The new `canParse()` (gemini/parser.ts:34-40, part of the uncommitted working-tree change) gates on `document.querySelector(conversationContainer) !== null` after the URL check.

Verified against the real captured DOM in `tmp/examples/artifacts-gemini-rendered.html`:
- `conversation-ui` — **0 occurrences**
- `class="conversation-container"` — **10 occurrences** (that is `messageElement`, a different selector)
- the page uses `<chat-window>` / `<infinite-scroller>` instead

`canParse()` is on the live detection path (`src/core/parsers/index.ts:45` calls `parser?.canParse()` before selecting a parser), so on a real Gemini page it returns false and **none of the 287 lines of new extraction logic ever run**.

## Work

Pick a container selector that exists in a fresh capture (`chat-window`, `infinite-scroller`, or `div.conversation-container`), or drop the container check and rely on `isGeminiUrl()`. Verify against the capture, not by reasoning.

## Context

This is why `lo-3920` (capture fixtures + tests) must land before `lo-485e` (register the parser): every selector in the uncommitted diff is unverified the same way this one was. Note also that the manifest gap (`lo-194d`) means the content script never loads on Gemini at all — both have to be fixed for anything to work.
