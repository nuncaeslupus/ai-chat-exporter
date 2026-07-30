# R-2b: the rest of the PDF redesign

R-2 (`lo-2fa9`) landed its page chrome — design margins (20/18/16), the R2
brand rule under the role label, and the footer attribution beside a
right-aligned page number. Three items were deliberately left, each for a
stated reason rather than because they were forgotten.

## 1. Embedded fonts — needs a dependency decision

The design asks for **Source Sans 3** (body) + **IBM Plex Mono** (code), embedded
via `addFileToVFS`. The repo has no font files and declares no font package, so
this needs either `@fontsource/source-sans-3` + `@fontsource/ibm-plex-mono` as
dependencies, or vendored base64 TTFs. That is a call for the repo owner, not
something to slip in.

Worth doing: jsPDF's standard 14 are **Latin-1 only**, so the design's own `−`,
`√` and `—` cannot render today. Embedding fixes that as a side effect.

**Carry forward from R-2:** import the font module from `pdf-exporter.ts` only,
never from the barrel or a shared module, or the lazy-chunk split leaks and the
fonts land in the eager content-script bundle.

## 2. The question turn fill

The design puts the question on `#F6F7F6` and the answer on white. pdf's layout is
hand-rolled and draws top-to-bottom, so filling the question's box needs its
height *before* the text is drawn — jsPDF has no z-order, and a rect drawn
afterwards covers the text. Needs a measure pass over `renderBlocks` (a dry run
that advances `y` without drawing), then `rect` then text.

html (R-6) and txt (R-5) already moved their fill to the question, so pdf is the
last format where the background still says nothing about who is asking.

## 3. Tables and the code-language tab

- Tables: horizontal rules only, tabular figures, numeric columns right-aligned.
- Code blocks: the language in a tab above the block rather than inline.

## Acceptance gate

```bash
pnpm test:run tests/unit/core/exporters/pdf-exporter.test.ts && pnpm build:content
```

`build:content` matters for item 1: the eager bundle must stay under its gate
with the fonts embedded.

## Tests
`tests/unit/core/exporters/pdf-exporter.test.ts`. Note every jsPDF mock in
`tests/unit/core/exporters/` needs any newly-used jsPDF method added to it — a
missing method throws inside `export()` and is swallowed into an error result, so
the failure surfaces as an unrelated assertion rather than a clear error.

## Location
`src/core/exporters/pdf-exporter.ts`, plus a new base64 font module beside it.
