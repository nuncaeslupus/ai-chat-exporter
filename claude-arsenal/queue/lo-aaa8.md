# Payload: lo-aaa8 — D-11: docx table headers are silently not bold

**Gate**: header cells in a docx table render bold.

```bash
pnpm typecheck && pnpm test:run
```

## The defect

`src/core/exporters/docx-exporter.ts:546-556`. Header cell boldness is set by
spreading `...{ bold: true }` onto the **`Paragraph`** options object. `bold` is
not a valid `Paragraph` property, so the `docx` library silently ignores it.

Result: docx tables get the gray header shading but NO bold header text — unlike
pdf (`pdf-exporter.ts:872-921`) and html (`html-exporter.ts:548-569`), which both
do bold + shaded headers correctly. Found by the cross-format typography audit.

## Work

Move `bold: true` onto the `TextRun`, where it belongs.

## Tests

Unzip the generated `.docx` and assert `<w:b/>` is present on the header row's
runs and absent on body rows. The existing docx test already reads
`word/document.xml` — follow that pattern. RED first.
