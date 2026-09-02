---
id: lo-4cdc
title: "ChatGPT parser hardcodes turn selectors instead of reading its SelectorSet"
priority: 7
workspace: "CHATGPT"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/45
---

## Acceptance gate

**Gate**: no CSS selector string for turns or message content is inlined in
`src/core/parsers/chatgpt/parser.ts`; all come from `CHATGPT_SELECTORS`.

Prose-only gate — verified by worker judgment, no script to run.


## The defect

`CHATGPT_SELECTORS.custom.userTurn` / `.assistantTurn` exist in `selectors.ts`, but
`parser.ts:151` and `:217` ignore them and inline the literal strings. So the
selector file and the code disagreed, and a repair applied to `selectors.ts` alone
would not have changed behaviour.

This is what made `lo-c418` (the `article` → `section` break) worse than it needed
to be: the obvious place to fix a selector was not the place that mattered.

## Work

Route every selector through the `SelectorSet`. Then audit the Claude and Gemini
parsers for the same pattern and report what you find — do not fix them here unless
the fix is trivial and in the same shape.

Note `lo-c418` must change these same two call sites to fix the live break. Check
whether it has landed first: if it has, this task is the cleanup of whatever it left;
if not, coordinate rather than conflict.

Read `docs/dev/parser-gotchas.md` §2.
