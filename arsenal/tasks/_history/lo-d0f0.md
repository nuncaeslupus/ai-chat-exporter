---
id: lo-d0f0
title: "D-13: ChatGPT and Claude parsers silently mis-pair Q&A turns on a dropped message"
priority: 8
workspace: "CORRECTNESS"
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/96
---

## Acceptance gate

**Gate**: when one message in the middle of a conversation fails to extract, the
parser either preserves correct pairing or reports failure — it never silently
pairs an answer with a different question.

```bash
pnpm typecheck && pnpm test:run
```

## The defect

Found by the `lo-b59b` worker (PR #91) while writing DOM-drift tests, and
confirmed empirically against the real fixtures for BOTH parsers.

`extractQAPairs` in `src/core/parsers/chatgpt/parser.ts` and
`src/core/parsers/claude/parser.ts` zips `userMessages[i]` with
`assistantMessages[i]` **by array index**. If a single user message in the middle
of a conversation fails to extract — a class rename, a wrapper change, a lazily
rendered turn — every later index shifts by one, and each subsequent assistant
answer is attached to the WRONG question.

`collectWarnings` only fires when `pairs.length === 0`, so a conversation that
mis-pairs 40 of its 41 turns emits **no warning at all** and exports as if
correct.

## Why this is worse than an empty export

An empty export is obviously broken and the user re-runs it. A mis-paired export
looks right — every question and every answer is present and plausible — and the
user has no way to notice that answer N belongs to question N+1. It is the one
failure mode of a chat exporter that silently produces a corrupt-but-credible
document. Archived, cited, or shared, it misrepresents what was actually said.

## The fix already exists in this repo

`src/core/parsers/gemini/parser.ts` does NOT have this bug. It pairs
**structurally**, per `.conversation-container`, so a broken turn degrades to a
per-turn warning (`"Turn N: the question could not be read"`) and leaves every
other turn correctly paired. Verified by the same worker.

Port that approach: pair by the DOM turn/container that holds both halves, not by
two independent flat arrays. Where a half is missing, emit a per-turn warning and
keep the gap rather than closing it.

## Also in scope

`CLAUDE_SELECTORS.assistantMessage` (`src/core/parsers/claude/selectors.ts`) is
dead config — `parser.ts` hardcodes `div[data-test-render-count]` instead. Either
wire the selector up or delete it; a selectors file that lies about what the
parser matches is how the next drift bug hides.

## Tests

- Per parser (chatgpt, claude): a 3+ turn fixture with the MIDDLE user message
  gutted, asserting either correct pairing of the surviving turns or an explicit
  per-turn warning — and specifically asserting answer N is NOT attached to
  question N+1. RED first.
- A regression test that Gemini's structural pairing still behaves (it is the
  reference implementation).
- Keep the drift tests added in PR #91 green; they currently pin the BROKEN
  behaviour with explanatory comments — update those comments when you fix it.
