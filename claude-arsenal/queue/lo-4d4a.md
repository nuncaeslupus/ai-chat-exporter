# Payload: lo-4d4a — Gemini selectors never match the real DOM

**Gate**: `canParse()` returns true against the captured Gemini DOM, and a fixture test proves it.

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

## UPDATE 2026-07-28 — the uncommitted working-tree change is GONE

This payload was written against ~335 lines of uncommitted Gemini parser work in
the main working tree. **That work was destroyed** on 2026-07-28 by an orchestrator
running `worker_postcheck.sh` (which does `git reset --hard` + `git clean -fd`) in
the main working tree instead of a worker worktree. It was never staged or
committed, so it is unrecoverable from git.

`src/core/parsers/gemini/parser.ts` is therefore back to its 43-line placeholder:
`extractQAPairs` is not implemented and `canParse()` is the original one-line URL
check. Any line/selector reference below that describes "the uncommitted change"
describes code that no longer exists.

**What still holds** — the *findings* remain valid and were verified against the real
captured DOM, so they are the specification for a rewrite:

- `conversation-ui` matches **0** elements in `tmp/examples/artifacts-gemini-rendered.html`.
- `class="conversation-container"` appears 10 times, but that is `messageElement`,
  a different selector.
- The page uses `<chat-window>` / `<infinite-scroller>` as containers.
- `katex-html` appears 14 times, `katex-mathml` **0** times — Gemini has no MathML
  fallback (see `docs/dev/parser-gotchas.md` §3; the shared collapse rule now handles
  this and must not regress).

**Approach now:** treat this as writing the Gemini parser, not patching it. Load the
`parser-generator` skill first — it encodes the live-capture workflow and the
selector-durability rules learned from the ChatGPT repair. Capture a fresh Gemini DOM
from a conversation created for the purpose (never a real user conversation), and
verify every selector against that capture rather than against this payload.
