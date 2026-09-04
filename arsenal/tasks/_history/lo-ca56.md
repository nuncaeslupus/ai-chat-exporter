---
id: lo-ca56
title: "C-3: docx has no platform brand colour (pdf and html both have one)"
priority: 5
deps: ["lo-82e7"]
workspace: "EXPORTERS"
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/131
---

## Acceptance gate

**Gate**: a docx export is visually identifiable as ChatGPT / Claude / Gemini in the
same way pdf and html already are.

```bash
pnpm typecheck && pnpm test:run
```

## The gap

pdf (`pdf-exporter.ts:944-951`) and html (`html-exporter.ts:404-445`) both colour
the role label / border by platform — chatgpt green, claude orange, gemini blue.
docx has only a `platformNames` map (`docx-exporter.ts:628-636`); every platform
renders identically in default black.

Note pdf and html currently use slightly DIFFERENT shades for the same platform.
`C-1` folds the canonical values into the token module — consume them here rather
than copying a third set of hex codes.

## Tests

Unzip the docx and assert the role-label run carries the expected `w:color` per
platform. RED first.
