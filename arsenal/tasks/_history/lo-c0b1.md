---
id: lo-c0b1
title: "D-37: renderWebSearches prepends a bullet to every wrapped title line, so sources look like extra entries"
priority: 8
workspace: "EXPORTERS"
tags: ["correctness"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/208
---

Observed in the owner's real Gemini PDF export (2026-07-31), pages 14-16 (the Deep
Research sources list). **Six occurrences**, so not a one-off.

## What the reader sees

```
• Accounting for the Anomaly Zoo: a Trading Cost Perspective - Jacobs Levy Equity Management Center for Quantitative Financial
• Research
    https://jacobslevycenter.wharton.upenn.edu/...
```

`Research` is the continuation of the title above it, not a new source — but it
gets its own bullet. Others in the same export:

```
• Italian Parliament approves 2026 Budget Law with tax measures affecting banks, other financial intermediaries and insurance
• companies

• Medidas fiscales para 2025: ... del Impuesto sobre Sociedades y otras
• medidas fiscales - Garrido

• Se permite deducir en el IRPF la totalidad del impuesto pagado en el extranjero por dividendos, sin limitarlo al 15 % del Convenio
• de Doble Imposición - Primera Lectura Ediciones

• BOE-A-2006-20764 Ley 35/2006, ... y de modificación parcial
• de las leyes de los Impuestos sobre Sociedades, sobre la Renta de no Residentes y sobre el Patrimonio.
```

A reader counting sources gets the wrong number, and each fragment reads as a
separate, nonsensical entry.

## Root cause — confirmed by reading the code, not inferred

`src/core/exporters/pdf-exporter.ts`, in `renderWebSearches` (~line 857):

```ts
const titleLines = splitLines(doc, sanitizeTextForPDF(result.title), contentWidth - 10);
for (const line of titleLines) {
  doc.text('• ' + line, margins.left + 5, y);   // <-- bullet on EVERY line
  y += lineHeight * 0.9;
}
```

The bullet is concatenated onto each wrapped line.

**Immediately below it, the URL loop already does it right:**

```ts
for (const line of splitLines(doc, url, contentWidth - 12)) {
  doc.text(`  ${line}`, margins.left + 7, y);
```

which is why URLs wrap with a clean hanging indent in the same export while titles
do not. That asymmetry is the proof.

**Note: `renderList` is NOT the culprit and must not be changed** — it already
guards correctly with `if (j === 0) { doc.text(prefix, bulletX, y); }` and indents
continuations to `textX`. Do not "fix" it.

## The fix

Draw the bullet once for the first line, then indent continuation lines to align
with the text after the bullet — mirroring what `renderList` and the URL loop
already do. Prefer reusing the same hanging-indent approach rather than adding a
third variant of this logic in the same file.

## Also check, and report what you find

The same "marker per line" mistake may exist in the other formats' web-search
rendering. `txt-exporter.ts` wraps at 72 columns so it is the likely twin; check
docx and html too. Fix them only if it is genuinely the same bug — do not
speculatively restructure working code.

## Acceptance gate

A source title long enough to wrap renders exactly one bullet, with continuation
lines aligned to the text column, including when the item crosses a page break.

```bash
pnpm test:run tests/unit/core/exporters/pdf-exporter.test.ts tests/unit/core/exporters/web-search-sources-formats.test.ts
```

## Tests
Add cases with a source title long enough to wrap to 3+ lines (assert exactly one
`•` is emitted for that result and that continuation lines start at the text
column), and one that also crosses a page break. `web-search-sources-formats.test.ts`
already drives sources through every format — add the wrapped-title case there so
all six are covered.

Note every jsPDF mock in `tests/unit/core/exporters/` needs any newly-used jsPDF
method added, or it throws inside `export()` and is swallowed into an error result,
surfacing as an unrelated assertion failure.

## Location
`src/core/exporters/pdf-exporter.ts` (`renderWebSearches`)
