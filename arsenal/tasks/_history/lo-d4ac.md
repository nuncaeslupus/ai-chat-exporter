---
id: lo-d4ac
title: "HTML export hardcodes English labels and lang attribute"
priority: 8
workspace: "DOCS"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/19
---

## Acceptance gate

**Gate**: exporting in a non-English locale produces a document whose labels and `lang` attribute match that locale.


Prose-only gate — verified by worker judgment, no script to run.

- `src/core/exporters/html-exporter.ts:85` — metadata labels and role names ("Question", "Answer", date formats) are hardcoded English string literals, bypassing the `getMessage()` i18n the rest of the extension uses. The extension ships 7 locales; the export ignores all of them.
- `html-exporter.ts:54` — the document hardcodes `lang="en"` (or omits it), regardless of content language. That is also an a11y defect: screen readers pick the wrong pronunciation rules.

Fix: route the labels through the same i18n helper the popup uses, and set `lang` from the UI locale. Add the new keys to all 7 `_locales/*/messages.json`.
