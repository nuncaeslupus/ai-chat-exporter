---
id: lo-8f9b
title: "Fix two vacuous tests that pass on broken implementations"
priority: 4
workspace: "TESTING"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/98
---

## Acceptance gate

**Gate**: both tests fail when the behaviour they claim to check is broken.


Prose-only gate — verified by worker judgment, no script to run.

1. `tests/unit/core/parsers/claude.test.ts:36-40` — calls `SelectionService.toggleSelection(pairs, '0')`, but pair ids are `pair-0`, `pair-1`, `pair-2` (`tests/utils/exporter-helpers.ts:56`). The id never matches, the toggle predicate never fires, and the "does not mutate the original array" claim is never actually exercised. Use `'pair-0'`.
2. `tests/unit/core/parsers/chatgpt.test.ts:197-202` — "extracts message content correctly" asserts only `content.length > 0`. It passes on garbled or truncated extraction. Other tests in the same file (`:338-352`, `:416-443`) assert exact strings from the fixture; this one should too.

Small, but these are the tests most likely to be trusted precisely because they exist.
