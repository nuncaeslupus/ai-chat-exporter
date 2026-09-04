---
id: lo-4f4e
title: "Claude API artifacts are matched by position and title, misattributing them"
priority: 8
workspace: "CORRECTNESS"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/17
---

## Acceptance gate

**Gate**: a conversation with an edited or regenerated turn attributes every artifact to the correct pair.


Prose-only gate — verified by worker judgment, no script to run.

`src/core/services/claude-api-service.ts` (359 lines, **no test file**) cross-references two independently-sourced structures — the DOM scrape and the private API response — using:

1. positional arithmetic: `assistantMessageIndex = pairIndex * 2 + 1`
2. then a title-string re-match: `existing.title === apiArtifact.title`

Any divergence between DOM pair count and API message count — edited turns, regenerated responses, deleted messages, non-text content blocks — silently misattributes artifacts to the wrong Q&A pair. Two artifacts sharing a title collide.

Same failure class as `lo-a8c6`, but riskier: that one zips two arrays from a single source, this one zips a scrape against an API response that has no reason to agree on shape.

Fix: match on a stable identifier from the API payload (message uuid) rather than position or title. If no such id is exposed, say so explicitly and make the fallback fail loudly rather than guess.

Tests: this service has none at all — the first test file is part of this task.
