---
id: lo-5db5
title: "R-8: five-token syntax highlighting via highlight.js in pdf, docx and html"
priority: 5
deps: ["lo-37cc"]
workspace: "EXPORTERS"
tags: ["redesign"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/170
---

Spec Phase 1 / code token palette. Depends on R-1.

`highlight.js` is **already a dependency** (dynamically imported on the print
path at `content-script.ts:446`). Do not add a tokenizer and do not add a
dependency. The work is a scope -> class map from hljs output down to five
classes, using the colours R-1 added:

| Class | Colour |
| --- | --- |
| keyword | `#9C3F63` |
| function, class | `#4C5FA8` |
| string | `#12665A` |
| number, constant | `#8A5A1A` |
| comment | `#8D9598` |

- pdf: coloured text runs. docx: `TextRun` with explicit `color`, so Word shows
  it. html: spans.
- **Markdown and plain text carry code untouched** — the fence's language tag
  already tells GitHub how to paint it.
- Import hljs lazily, as the print path already does; it must not enter the
  eager content-script bundle.

## Acceptance gate

```bash
pnpm test:run tests/unit/core/exporters/rich-content-formats.test.ts && pnpm build:content
```

## Tests
Assert a Python snippet yields exactly the five classes and no others, that md
and txt output contain no colour markup, and that `pnpm build:content` keeps the
eager bundle under its gate.

## Location
`src/core/exporters/{pdf,docx,html}-exporter.ts`, plus one shared scope-map module.
