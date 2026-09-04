---
id: lo-a23a
title: "D-35 CRITICAL: textContent flattening concatenates block elements with no separator, destroying Gemini tables into unreadable runs"
priority: 10
workspace: "EXPORTERS"
tags: ["correctness"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/205
---

**Evidence: a real Gemini export the owner produced on 2026-07-31**, compared
side-by-side against the same conversation exported via Google Docs.

## What the reader gets

Our PDF, "Tabla 1" (a real 4-column x 5-row table):

```
JurisdicciónImpuesto (Acrónimo)Tasa ImpositivaÁmbito de Aplicación (Capitalización)EspañaITF (Tasa
Tobin)0.20%Acciones de empresas > 1.000 millones EURFranciaFrench FTT0.40%Acciones de empresas > 1.000
millones EUR (Tasa incrementada en 2025/2026)ItaliaItalian FTT0.20%...
```

Our PDF, "Tabla 2" (tax brackets):

```
Base Liquidable del AhorroCuota ÍntegraPorcentaje Aplicable al RestoHasta 6.000 EUR0 EUR19%De 6.000 EUR a
50.000 EUR1.140 EUR21%De 50.000 EUR a 200.000 EUR10.380 EUR23%...
```

**Google Docs renders both as real bordered tables** with a bold header row.

**This is data corruption, not a styling issue.** `0 EUR19%De 6.000 EUR` — a
reader cannot tell where one figure ends and the next begins. An export that
silently garbles numbers is worse than one that omits them, because the reader
trusts it.

## Root cause

`src/core/parsers/base-parser.ts:188`:

```ts
const content = clone.textContent?.trim() ?? '';
```

`textContent` concatenates every descendant's text with **no separator**. Any
block structure that is not recognised upstream collapses into a single run.

`HtmlContentParser` *does* handle `<table>` (`case 'table'`, emits
`type: 'table'`) and pdf *does* render table blocks (`renderTable`). But **neither
Gemini DOM fixture contains a single `<table>` element** — check for yourself:

```bash
grep -c '<table' tests/fixtures/dom-snapshots/gemini/*.html   # 0 in both
```

So Gemini renders tables as non-`<table>` markup (divs/grid/role-based). They fall
through to the generic path and get `textContent`-flattened.

## The same bug, same export, other shapes

- `European Systematic Equity Cost AnalysisJul 24, 9:50 AM` — title and timestamp joined.
- `Analyze ResultsCreate ReportReady in a few mins` — three widget labels joined.
- `...Research Websites(1) Find official fee schedules...` — heading joined to list.

This is **D-23 generalised**. D-23 (#176) fixed whitespace around inline citation
pills; the same defect exists for **block-level** elements and was never fixed.

## Two fixes — do BOTH, in this order

**1. The safety net (do this first; it fixes the whole class).** When flattening an
element to text, insert a separator between **block-level** children so words can
never be joined. Fix it in the shared helper, not per platform. Block-level
elements (`div`, `p`, `li`, `tr`, `td`, `th`, `section`, `h1`-`h6`, `table`, …)
should contribute a boundary; inline elements (`span`, `a`, `em`, `strong`, `code`)
must **not**, or you will insert spaces inside words.

Be careful with `td`/`th`: a cell boundary needs a separator that survives into a
readable line, not a newline that fragments the row. A tab or ` | ` for cells and a
newline for rows is a reasonable choice — state what you chose.

**2. Recognise Gemini's table markup** so real tables become `type: 'table'` blocks
and render as tables in every format. **Determine the actual markup from the
fixtures — do not guess.** Inspect `tests/fixtures/dom-snapshots/gemini/*.html`
for the "Tabla 1"/"Tabla 2" content and find what element carries the rows. Report
the selector you found. If the fixtures predate this conversation and contain no
such table, say so and implement only fix 1, then flag that a fresh capture is
needed (the `parser-generator` skill covers capture).

## Do not regress

- The whitespace fix must not reintroduce D-23's leak: run
  `tests/integration/fixture-to-parser-to-exporter.test.ts`, which asserts no run
  of blank lines inside paragraph text.
- Must not add spaces inside words, or inside `<code>`/`<pre>` content.
- All three platforms flow through this helper — verify ChatGPT and Claude exports
  are unchanged where they were already correct.

## Acceptance gate

No two words from different block elements are ever joined, in any format; a
Gemini table renders as a table (or, if the markup cannot be identified from a
fixture, at minimum as separated cells rather than one run).

```bash
pnpm test:run tests/integration/ tests/unit/core/parsers/ tests/unit/core/exporters/ tests/unit/core/services/ && pnpm lint && pnpm format:check && pnpm typecheck
```

## Tests — weird output is the point here
Add cases for: a div-based table (cells must not concatenate), adjacent block divs,
a heading immediately followed by a list, a cell containing only `–`, adjacent
cells with identical text, numbers in adjacent cells (`0 EUR` then `19%` must not
become `0 EUR19%`), and inline elements mid-sentence (must NOT gain spaces). Drive
them through **all six** formats.

## Location
`src/core/parsers/base-parser.ts`, `src/core/services/html-content-parser.ts`,
`src/core/parsers/gemini/`
