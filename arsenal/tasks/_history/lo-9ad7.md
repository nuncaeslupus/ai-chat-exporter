---
id: lo-9ad7
title: "R-4: Markdown — bold role label, blockquote question, metadata table, body headings from ##"
priority: 5
deps: ["lo-37cc"]
workspace: "EXPORTERS"
tags: ["redesign"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/163
---

Spec Phase 2 / Markdown. Depends on R-1.

- Role label becomes `**Usuario** · 12:04` — bold plus separator. Drop the
  `## 👤` / `🤖` heading form entirely.
- Question rendered as a blockquote.
- Metadata as a table: Platform, Model, Range, Exported, URL.
- Body headings start at `##` (only `#` stays occupied, by the title).
- Native `![alt](url)`, replacing the raw 200 px `<img>`.
- Fenced code with the language on the fence. Do **not** also write the language
  as text — GitHub does not show it; it belongs in the print stylesheet only.

## Acceptance gate

```bash
pnpm test:run tests/unit/core/exporters/structured-md-exporter.test.ts tests/unit/core/exporters/heading-levels.test.ts
```

## Tests
`tests/unit/core/exporters/structured-md-exporter.test.ts` — assert no emoji and
no `## ` role heading in the output, that the question lines start with `> `,
and that a source `# H1` inside a message emits `##`.

## Location
`src/core/exporters/structured-md-exporter.ts`
