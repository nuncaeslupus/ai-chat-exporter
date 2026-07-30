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

---

## OWNER DECISION 2026-07-30 — fonts: `@fontsource` npm dependencies

Item 1 is **unblocked and in scope**. Use `@fontsource/source-sans-3` and
`@fontsource/ibm-plex-mono` as **devDependencies**, reading the `.ttf` files at
build time into the base64 module. Do NOT vendor hand-generated base64 blobs.

Non-negotiable constraints carried over from R-2:

- The generated font module is imported from `pdf-exporter.ts` **only** — never
  the barrel, never a shared module — or the lazy-chunk split leaks and the
  fonts land in the eager content-script bundle.
- `pnpm build:content` must still pass its eager-bundle size gate **with the
  fonts embedded**. If it does not, subset the fonts (Latin + the design's
  `−`, `√`, `—`) rather than dropping the requirement, and say so in the PR.
- devDependencies, not dependencies: the TTFs are a build input, not a runtime
  import.

Do all three items (fonts, question turn fill, tables + code-language tab).

---

## STATUS UPDATE 2026-07-30 — item 1 (fonts) IS ALREADY DONE ON `main`

Verified on `main` at `c357de3`. Do **not** redo it, and do **not** touch
`package.json`:

- `@fontsource/source-sans-3` and `@fontsource/ibm-plex-mono` are already
  declared (the owner's chosen route — npm deps, not vendored base64).
- `scripts/generate-pdf-fonts.mjs` runs on `postinstall` and emits
  `src/core/exporters/pdf-fonts.generated.ts` (tracked; 4 faces, ~149 KB
  TrueType, 26 covered ranges).
- `pdf-exporter.ts:26` imports `EMBEDDED_FONTS` and calls `addFileToVFS` at
  line 165; `this.fonts.body` / `this.fonts.code` are in use throughout.

**Remaining scope is items 2 and 3 only:**

**2. The question turn fill.** The design puts the question on `#F6F7F6` and the
answer on white. pdf's layout is hand-rolled top-to-bottom and jsPDF has no
z-order, so a `rect` drawn after the text covers it. You need the question box's
height *before* drawing: a measure pass over `renderBlocks` (a dry run that
advances `y` without drawing), then `rect`, then the text. There is already a
comment at `pdf-exporter.ts:407` calling measurement "the single place that
measurement lives" — start there and extend it rather than adding a second
measurement path. html (R-6) and txt (R-5) already moved their fill to the
question; pdf is the last format where the background says nothing about who is
asking.

**3. Tables and the code-language tab.**
- Tables: horizontal rules only (a `renderHorizontalRule` helper already exists
  near line 943), tabular figures, numeric columns right-aligned.
- Code blocks: the language in a tab **above** the block rather than inline.
