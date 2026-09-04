---
id: lo-b4cd
title: "D-31: captured Deep Research report is plain text — no headings/tables, plus odometer digits, duplicated title, mermaid axis dump and literal \\uXXXX escapes"
priority: 10
workspace: "EXPORTERS"
tags: ["correctness"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/196
---

`lo-6333` / #194 fixed **capture** — the ChatGPT Deep Research report now reaches
the export instead of the placeholder. Owner verdict: **"Now content is visible,
only not too nice."**

Evidence is a real export the owner produced on 2026-07-31
(`Firefighting-with-Water-Hoses_2026-07-31 (4).md`). Line numbers below are from
that file. **Every defect here is real and observed — none is speculative.**

## Root of most of it: we relay `innerText`, so all structure is destroyed

`deep-research-frame.ts` relays the nested frame's `innerText` — a flat string.
The report's headings, lists and tables therefore arrive as undifferentiated
paragraphs. In the export, `Resumen ejecutivo`, `Principios físicos de extinción
con agua`, `Tácticas de ataque con mangueras` etc. are **plain paragraphs, not
headings** (lines 52, 60, 70…), while the *second* answer in the same file — an
ordinary ChatGPT message — has proper `####` headings and `-`/`1.` lists
(lines 200-259). The contrast is the bug: the same document renders well when it
goes through the normal HTML path and badly when it comes through the relay.

**Fix direction:** relay **sanitized HTML** from the nested frame instead of
`innerText`, and feed it through the existing `ConversationStructureService` /
`HtmlContentParser` path that normal messages already use. That yields headings,
lists and real tables across all six formats for free, instead of a second
bespoke formatter.

Hard constraints on that change:
- **Sanitize before relaying.** Reuse `src/core/utils/sanitize-html.ts`; do not
  invent a second sanitizer. Strip `script`/`style` — the nested body's
  `textContent` measures **13.3 MB** precisely because it includes inlined
  script bodies.
- **Keep the size guard** added in #194 (`MAX_PLAUSIBLE_LENGTH`). HTML is bulkier
  than text, so re-derive the bound rather than reusing the text-based number —
  and state the new figure.
- **Never fabricate or silently truncate.** If the HTML path fails, fall back to
  today's text relay, and if that fails, the honest placeholder. A partial report
  must never be presented as complete.

## Five concrete artifacts, all visible in that file

**1. Odometer digit dump — lines 19-48 (30 lines of junk).** The header renders
as:
```
Research completed in 8m ·
0
1
2
3
...
 citations ·  searches
```
ChatGPT renders the citation and search counts as an **animated spinning digit
column** — all ten digits exist in the DOM, translated out of view, so
`innerText` captures every one. Note the counts themselves are *missing* from
`" citations ·  searches"`. Either recover the real numbers or drop the element;
do not emit digit soup.

**2. Duplicated title — lines 50-51.** `Uso de mangueras de agua en incendios
grandes` appears twice in a row.

**3. Tables flattened to tab-separated lines — lines 84-88, 100-104, 142-146.**
E.g. `Táctica	Objetivo	Tipo de chorro	Ventajas/uso típico` — tabs, no pipes, so
no format renders them as tables. The report genuinely contains three tables.
The HTML path above should fix this; verify it does.

**4. Mermaid diagram dumped as raw axis labels — lines 160-176.** A timeline
diagram degrades to a bare list of `2006-01-01 … 2026-01-01` plus stray labels,
which is meaningless to a reader. Decide deliberately: either render/label it as
a diagram, or omit it with a short marker. Do not emit bare axis ticks. Note the
repo already has precedent for honest markers for unrepresentable content.

**5. Literal `\uXXXX` escapes — lines 172-173.** The export contains
`Evacuación interior` and `Extinción final` — literal backslash-u
sequences instead of `ó`. **Establish first whether the live page shows these
escaped too** (i.e. ChatGPT's own bug inside the mermaid labels) or whether our
relay/serialisation introduces them. Say which. If ours, fix it; if theirs, do
not "helpfully" unescape arbitrary text — decode only if it is provably a
double-encoding we caused.

## Acceptance gate

A real Deep Research export shows headings as headings, the three tables as
tables, no digit-odometer block, no duplicated title, no bare mermaid axis dump,
and no literal `\uXXXX`.

```bash
pnpm test:run tests/unit/extension/content/ tests/unit/core/services/ tests/unit/core/exporters/ && pnpm lint && pnpm format:check && pnpm typecheck
```

The end state needs a live page, so it is **owner-verified**; state that plainly.

## Tests
Drive a captured-HTML fixture (a trimmed, sanitized snippet resembling the real
report — headings + a table + the odometer markup) through the structure parser
and all six exporters. Assert: headings become headings, the table becomes a
table, and the odometer/duplicate-title artifacts are gone. jsdom has no
`innerText`, so test the HTML path, not the text path.

## Location
`src/extension/content/deep-research-frame.ts`, `src/core/utils/sanitize-html.ts`,
`src/core/services/html-content-parser.ts` (consumer side),
`src/core/parsers/chatgpt/parser.ts`
