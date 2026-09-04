---
id: lo-c09d
title: "EXP-4: table fidelity — two-row thead flattened, colspan/rowspan ignored, so values land under the wrong column"
priority: 7
workspace: "EXPORTERS"
tags: ["correctness"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/210
---

Source: the 13-dimension senior review of 2026-07-31 (26 agents, findings adversarially reviewed).
**2 findings** in this task: 2 medium.

Both defects put data under the wrong heading in EVERY format, which is worse than dropping it —
a reader cannot tell it is wrong. Related to D-35 (`lo-a23a`, block-flatten separators) but distinct:
this is about tables that ARE recognised being mis-structured.

---

## Findings

### [medium] A two-row <thead> is flattened into a single header row, doubling the column count for every format

- **Where:** `src/core/services/html-content-parser.ts`:328
- **Problem:** `parseTable` iterates all `<tr>` in `<thead>` and does `headers.push(...headerRow)` — it appends CELLS, not rows, into one flat `headers` array. A table with a two-line header therefore reports twice as many columns as the body has, and every exporter builds its geometry from `headers.length`.
- **Failure scenario:** An HTML/Deep-Research artifact table with `<thead><tr><th>Region</th><th>Q1</th></tr><tr><th>(EUR)</th><th>(EUR)</th></tr></thead>` and 2-cell body rows. Verified parse output: `headers: ["Region","Q1","(EUR)","(EUR)"]`, `rows: [["EMEA","10"],["APAC","20"]]`. Consequences: md emits a 4-column header + 4-column separator over 2-cell rows (half the table renders empty); pdf sets `numCols = table.headers.length` (pdf-exporter.ts:1268) so every column is half as wide as it should be and cell text wraps to a couple of characters per line; docx builds a 4-cell header row over 2-cell body rows.
- **Suggested fix:** Keep only the LAST `<thead>` row as the header row (that is the one whose cells label the columns) and emit the earlier rows as body rows — or change `headers` to `InlineContent[][][]` and render multiple header rows where the format supports it (docx/html can, md cannot). The one-line lazy fix is to replace the `headers.push(...headerRow)` accumulation with an assignment so the last row wins.

### [medium] colspan / rowspan are ignored, so merged-cell tables put values under the wrong column in every format

- **Where:** `src/core/services/html-content-parser.ts`:342
- **Problem:** `parseTable` reads each row's `th, td` in document order with no `colspan`/`rowspan` accounting. A row that is short because a cell above spans into it (or because one of its cells spans two columns) is emitted as-is, so every cell after the gap is rendered one or more columns to the left of where it belongs.
- **Failure scenario:** A 3-column table where the first body cell has `rowspan="2"` and a later row has `colspan="2"`. Verified parse output: `headers: ["A","B","C"]`, `rows: [["x","1","2"],["3","4"],["merged","9"]]`. Rendered, row 2's `3` and `4` land under headers A and B although they belong to B and C, and `9` lands under B instead of C — numbers silently attributed to the wrong column in md, txt, html, docx and pdf alike. HTML artifacts and Deep Research reports do emit merged cells (Markdown tables cannot, which is why this is invisible on the common path).
- **Suggested fix:** Expand the spans while parsing: track a pending-rowspan map per column and, for each cell, push its content once and then `colspan - 1` empty `InlineContent[]` placeholders, reserving `rowspan - 1` slots for the following rows. ~15 lines in `parseTable`, and it fixes all six formats at once since they all read the same `TableBlock`.

---

## Working rules for this task

- Treat each finding independently: fix what is real, and if one does not hold up on inspection say
  so in the PR rather than inventing a change. The reviewers were adversarially checked but not
  infallible.
- **Never trade correctness for tidiness.** If a fix would lose content or weaken a guard, stop and
  report instead.
- Every behavioural fix needs a test that FAILS before it and passes after. State that you verified
  this — it will be checked independently.
- Do not restyle or refactor code outside the findings listed here.

## Acceptance gate

Every finding above is either fixed with a proving test, or explicitly explained as not-a-defect.

```bash
pnpm test:run && pnpm lint && pnpm format:check && pnpm typecheck
```
