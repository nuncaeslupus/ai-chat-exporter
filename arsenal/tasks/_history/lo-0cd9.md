---
id: lo-0cd9
title: "Five of six exporters ignore selectedPairs and always export everything"
priority: 8
workspace: "CORRECTNESS"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/21
---

## Acceptance gate

**Gate**: exporting with a subset of pairs selected produces a file containing only those pairs, in every format.


Prose-only gate — verified by worker judgment, no script to run.

`BaseExporter.export(conversation, selectedPairs, options)` takes `selectedPairs`, but only one of the six registered exporters honours it — the rest (starting at `src/core/exporters/structured-md-exporter.ts:26`) iterate `conversation.pairs` and export everything.

Today this is invisible because nothing ever passes a subset. **It stops being invisible the moment `lo-adf1` ships the selection UI** — the user deselects three pairs, the export contains all of them, and the bug looks like it is in the new UI.

Fix: honour the parameter in every exporter, and add a shared test that runs each registered exporter with a two-of-three subset.

Blocks `lo-adf1`.
