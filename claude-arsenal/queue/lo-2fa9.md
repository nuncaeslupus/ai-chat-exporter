# R-2: PDF — embedded fonts, R2 role label, running head, footer, respect pageSize

Spec Phase 2 / PDF. Depends on R-1.

- Embed Source Sans 3 (body) + IBM Plex Mono (code) via `addFileToVFS`.
  **Import the base64 font module from `pdf-exporter.ts` only** — never from
  `src/core/exporters/index.ts` or a shared module, or the lazy-chunk split
  leaks and the fonts land in the eager content-script bundle.
- Also fixes Unicode: jsPDF's standard 14 are Latin-1 only, so the design's own
  `−`, `√` and `—` do not render today.
- Role label **R2**: 8.5 pt with the platform-coloured rule, time in the same
  size in a lighter grey.
- Margins 20 / 18 / 16 mm. **Take every page measurement from the page jsPDF
  actually created** — `pdfOptions.pageSize` (a4 | letter | legal) is already
  forwarded at `pdf-exporter.ts:109`; do not hardcode A4 dimensions.
- Document header on page 1 only; running head (title + platform) from page 2.
- Footer: "Exported with AI Chat Exporter" + page number.
- Question on `#F6F7F6`, answer on white. Tables: horizontal rules only,
  tabular figures, numeric columns right-aligned.
- Code block: language in a tab above the block.

## Acceptance gate

Renders at all three paper sizes without hardcoded A4, and the eager bundle
stays under its gate with the fonts embedded.

```bash
pnpm test:run tests/unit/core/exporters/pdf-exporter.test.ts && pnpm build:content
```

## Tests
`tests/unit/core/exporters/pdf-exporter.test.ts` — add a case per paper size
asserting the drawn content box scales with the page, and one asserting the
embedded font is registered.

## Location
`src/core/exporters/pdf-exporter.ts`, plus a new base64 font module beside it.
