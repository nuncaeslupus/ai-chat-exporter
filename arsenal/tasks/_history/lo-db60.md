---
id: lo-db60
title: "TEST-1: test quality — pdf/docx excluded from the rich-content matrix, markdown tables untested, a test that passes with the exporter deleted"
priority: 7
workspace: "TESTING"
tags: ["tests"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/213
---

Source: the 13-dimension senior review of 2026-07-31 (26 agents, findings adversarially reviewed).
**7 findings** in this task: 3 high, 3 medium, 1 low.

The owner asked specifically for stronger export testing. These are the holes: blockquotes and
horizontal rules have no test in any format, `renderTable` in the markdown exporter is entirely
untested, and one docx test would pass if `DocxExporter` were deleted.

For every test you add or repair, **prove it fails against the current behaviour first**.

---

## Findings

### [high] "Rich content survives export in all six formats" never checks pdf or docx output — list rendering in both exporters is untested

- **Where:** `tests/unit/core/exporters/rich-content-formats.test.ts`:100
- **Problem:** The suite's stated purpose is that a numbered list survives into every format. The md/txt/html/json cases assert on the exporter's actual output, but the pdf and docx cases assert on `ConversationStructureService.toStructured()` — a *different module* — and then only that the exporter returned `success: true` with a non-empty Blob. `expect(blocks.some(b => b.type === 'list')).toBe(true)` at lines 103 and 117 exercises the structure service, not PdfExporter/DocxExporter. The blob is non-empty from the title and metadata alone. Independently confirmed with grep: `<ol>`/`<ul>`/`<li>` appear in exactly one test file in the whole repo (this one), and no test anywhere asserts a rendered list item in PDF or DOCX (no `w:numPr`, no `ListParagraph`, no `1. First point` in a pdf `doc.text()` call). Nested lists have no test in any format.
- **Failure scenario:** Delete `case 'list': ... break;` from pdf-exporter.ts:659 and docx-exporter.ts:646 (or make the list renderer return an empty array). Every ordered and unordered list vanishes from every exported PDF and DOCX — a user exporting a step-by-step answer gets the surrounding prose with the steps silently gone. All ~1235 tests stay green, including these two, because the structure service still emits a `list` block and the document still has a title.
- **Suggested fix:** Assert on the rendered output, using the machinery these files already have. For pdf, the jsPDF mock in pdf-exporter.test.ts exposes `textCallsOf(instance)` — assert the joined text contains `1. First point` / `2. Second point` (or whatever prefix the renderer emits) in order. For docx, `extractDocxEntry(blob, 'word/document.xml')` + `docxRunText(xml)` is already imported in docx-exporter.test.ts — assert both item texts appear and that the XML contains `<w:numPr>` so they are real Word list items rather than plain paragraphs. Add a nested-list case (`<ul><li>a<ul><li>b</li></ul></li></ul>`) while there, since `renderList` recursion is unhit in md and unasserted everywhere.

### [high] Blockquotes and horizontal rules have no test in any of the six exporters

- **Where:** `src/core/exporters/pdf-exporter.ts`:1037
- **Problem:** `renderBlockquote` and `renderHorizontalRule` are never invoked by the suite in either binary exporter: coverage-final.json records 0 hits for pdf-exporter.ts `renderBlockquote` (line 1037) / `renderHorizontalRule` (line 1100) and docx-exporter.ts `renderBlockquote` (line 833) / `renderHorizontalRule` (line 876). The md exporter's `case 'blockquote'` and `case 'hr'` (structured-md-exporter.ts:263, 270) are likewise unhit. Corroborated independently of coverage: grep for `blockquote` across tests/ hits only contrast.test.ts (a CSS colour pair), html-content-parser.test.ts (parser-side block production), structured-md-exporter.test.ts (the unrelated question-quote helper), and two DOM fixtures — no exporter test. `<hr` appears in no exporter test either. So the parser side produces `blockquote`/`hr` blocks that are proven correct, and the six renderers that consume them are proven by nothing. tests/fixtures/dom-snapshots/chatgpt/formatting-showcase-2026-07.html actually contains a blockquote, but it is only ever fed to parser tests, never to an exporter.
- **Failure scenario:** Make `renderBlockquote` return `[]` in docx-exporter.ts and `return y` unchanged in pdf-exporter.ts. Every quoted passage in an assistant answer — the quoted source in a research summary, quoted user text the model is responding to — disappears from the exported PDF and DOCX with no warning and no failing test. Same for `<hr>` section dividers. The whole suite stays green.
- **Suggested fix:** Add one shared case to the existing format-matrix pattern (the same shape as math-formats.test.ts, which does this correctly): a pair whose `htmlContent` is `'<blockquote><p>quoted line</p></blockquote><hr><p>after</p>'`, then per format assert md `> quoted line` and `---`, txt the quote prefix and rule, html `<blockquote>`/`<hr`, pdf that `quoted line` reaches `doc.text()` and that a `line`/`rect` is drawn for the rule, docx that the run text contains `quoted line` and the rule paragraph carries its bottom border. The formatting-showcase fixture already has the markup — routing it through the integration suite would cover this too.

### [high] Markdown table rendering is entirely untested — StructuredMarkdownExporter.renderTable has zero coverage

- **Where:** `src/core/exporters/structured-md-exporter.ts`:309
- **Problem:** `renderTable` (line 309) and all three of its inner callbacks record 0 hits in coverage-final.json, and `case 'table'` in `renderBlocks` (line 296) is unhit. Verified by grep: `<table>` in a test payload appears in txt-exporter.test.ts:263, docx-exporter.test.ts:198, pdf-exporter.test.ts:589, html-exporter.test.ts:400 and pagination.test.ts:269/371 — every format except md. The only `|---|` assertion in the suite (structured-md-exporter.test.ts:162) is against the hand-assembled *metadata* table in `generateMarkdown`, not against `renderTable`. Markdown is the format where the GFM separator row is load-bearing: without `| --- | --- |` the output is not a table at all, just pipe-separated lines. That exact line (`separators.join(' | ')`, line 321) is never executed by any test. This is exporter-side and distinct from the tracked Gemini parser issue D-35.
- **Failure scenario:** Drop the separator-row push at structured-md-exporter.ts:320-321, or invert the `if (block.headers && block.headers.length > 0)` guard. Every table in an exported .md renders in GitHub/Obsidian/pandoc as a run of literal `| a | b |` text lines instead of a table. No test fails.
- **Suggested fix:** Add an `md:` case to the table payload that txt-exporter.test.ts:263 already defines — export it through `StructuredMarkdownExporter` and assert `| Fold | Train |`, then `| --- | --- |` on the immediately following line, then `| 1 | 2017-2019 |`. Asserting adjacency (a two-line regex or an index comparison) is what pins the separator; a bare `toContain('|---|')` would also match the metadata table.

### [medium] "Registers all four faces" passes with only two — arrayContaining ignores duplicates

- **Where:** `tests/unit/core/exporters/pdf-exporter.test.ts`:495
- **Problem:** `expect(added).toEqual(expect.arrayContaining(['SourceSans3', 'SourceSans3', 'SourceSans3', 'IBMPlexMono']))` maps `addFont` calls to `args[1]`, the font *family*. Three of the four embedded faces share the family `SourceSans3` (regular / bold / italic — pdf-fonts.generated.ts:22, 29, 36); only `args[2]`, the style, distinguishes them. And @vitest/expect@4.1.10 implements ArrayContaining as `sample.every(item => other.some(...))` (read at node_modules/.pnpm/@vitest+expect@4.1.10/.../dist/index.js:887), so the three repeated `'SourceSans3'` entries are no-ops: the assertion only requires that `SourceSans3` appears at least once and `IBMPlexMono` at least once. The test's own title and the surrounding comment claim four faces are pinned; two are.
- **Failure scenario:** Remove the SemiBold and Italic entries from `EMBEDDED_FONTS` in src/core/exporters/pdf-fonts.generated.ts (or have the generator script emit only the regular weight). `registerFonts` still registers 2 faces, and pdf-exporter.ts's 20+ `doc.setFont(this.fonts.body, 'bold')` / `'italic'` calls (lines 253, 548, 722, 745, 838, 869, 1058, …) ask jsPDF for faces it never received, so jsPDF silently falls back — every bold role label, bold table header, and italic blockquote in the PDF renders as regular text. This test stays green, and so does the companion assertion at lines 500-502 (registration still precedes the first setFont).
- **Suggested fix:** Key the assertion on the family/style pair: `const added = instance.calls.filter(c => c.method === 'addFont').map(c => [c.args[1], c.args[2]].join('/')); expect(added.sort()).toEqual(['IBMPlexMono/normal', 'SourceSans3/bold', 'SourceSans3/italic', 'SourceSans3/normal']);`. `toEqual` on a sorted array (rather than `arrayContaining`) also catches a face being registered twice or an extra face appearing.

### [medium] md and txt "omits the timestamp when showMetaInfo is off" assert a string those formats never emit

- **Where:** `tests/unit/core/exporters/structured-md-exporter.test.ts`:71
- **Problem:** Both tests assert `expect(text).not.toContain('12:00:00')`. But R-4/R-5 changed md and txt per-message stamps to hours-and-minutes: structured-md-exporter.ts:110 emits `**User** · ${this.formatTime(timestamp).slice(0, 5)}` and txt-exporter.ts:150 emits ` · ${this.formatTime(timestamp).slice(0, 5)}` — i.e. `· 12:00`, never `12:00:00`. Their own positive counterparts assert `toContain('· 12:00')` (structured-md-exporter.test.ts:53, txt-exporter.test.ts:124), so the format change was applied to the positive test and not the negative one. The only thing the negative assertion currently detects is that the metadata table/header block (which does carry a full `formatTimestamp` with seconds) is omitted — already covered by txt-exporter.test.ts:100-101. The equivalent tests for docx (docx-exporter.test.ts:262) and html (html-exporter.test.ts:299) are correct, because those formats really do emit `(12:00:00)`. Same file, txt-exporter.test.ts:167 and structured-md-exporter.test.ts:84: `not.toMatch(/\(\s*\)/)` is now also inert, since neither format parenthesises the stamp any more.
- **Failure scenario:** Delete `!options.showMetaInfo ||` from the roleLabel guard at structured-md-exporter.ts:109 (and the `includeTimestamps &&` at txt-exporter.ts:150). Every message in every .md and .txt export now carries `· 12:00` regardless of the user's explicitly-off preference — a privacy/preference regression that shows on the face of the file. Both tests stay green.
- **Suggested fix:** Assert the same thing the positive test asserts, negated: `expect(text).not.toContain('· 12:00')` for md, and for txt scope it to the role label — `expect(text.split('\n').filter(l => /^[A-Z]+ ·/.test(l))).toEqual([])`. Then drop or update the now-inert `/\(\s*\)/` assertions to match the current `· HH:MM` idiom.

### [medium] The credentialed Claude API proxy in the service worker is unreachable from any test — onMessage is stubbed with a bare vi.fn()

- **Where:** `tests/unit/extension/background/service-worker.test.ts`:31
- **Problem:** The single service-worker test captures the `commands.onCommand` and `contextMenus.onClicked` handlers out of their mocks (lines 58-61, 65-68) so it can drive them, but mocks `runtime.onMessage.addListener` as a bare `vi.fn()` (line 31) — the registered listener is discarded, so nothing in the suite can ever invoke it. Consequently the entire message router (service-worker.ts:52-91) and both credentialed fetch handlers are dead to the tests: coverage-final.json records 0 hits for `isClaudeApiFetchMessage` (line 98), `isClaudeOrganizationsFetchMessage` (line 110), `handleClaudeApiFetch` (line 123) and `handleClaudeOrganizationsFetch` (line 164). This is the extension's only path that issues `fetch(..., { credentials: 'include' })` against claude.ai, and `isClaudeApiFetchMessage` validates only `message.type` — it never checks that `data.organizationId` / `data.conversationId` are strings, yet both are interpolated straight into the request URL at service-worker.ts:128. There is no positive test that a well-formed request produces the right URL, and no negative test for a malformed or hostile payload.
- **Failure scenario:** Send `chrome.runtime.sendMessage({ type: 'fetch_claude_api_data', data: { organizationId: '../../..', conversationId: '' } })` from any content script. `isClaudeApiFetchMessage` returns true, the guard passes, and a cookie-authenticated GET is issued to an attacker-shaped path under claude.ai. Equally, a regression that swapped organizationId and conversationId in the template, or dropped `credentials: 'include'` (breaking Claude artifact enrichment for every user), would be caught by nothing.
- **Suggested fix:** Capture the onMessage handler the same way the test already captures onCommand: `onMessage: { addListener: vi.fn(h => { onMessageHandler = h; }) }`. Then stub `globalThis.fetch` and add (a) a positive test that a valid message hits `https://claude.ai/api/organizations/<org>/chat_conversations/<conv>?...` with `credentials: 'include'`, (b) a test that a non-ok response resolves `{ success: false, error }` rather than throwing, and (c) a negative test that a payload whose `organizationId`/`conversationId` are absent, non-string, or contain `/` or `..` is rejected without any fetch — which will require tightening `isClaudeApiFetchMessage` to actually validate the two fields.

### [low] A docx-suite test asserts only on a colour constant and would pass with DocxExporter deleted

- **Where:** `tests/unit/core/exporters/docx-exporter.test.ts`:327
- **Problem:** `it('gives each platform a distinct role-label colour')` builds an array of four `COLOR.brandTextOnLight.*` values and asserts `expect(new Set(hexes).size).toBe(hexes.length)`. It never calls the exporter, never renders a document, and never touches `word/document.xml` — unlike the three `it.each` cases immediately above it (lines 311-318), which correctly assert `<w:color w:val=...>` in the rendered XML. It is a uniqueness check on the shared token table filed inside the DOCX exporter's suite, where it reads as DOCX coverage it does not provide.
- **Failure scenario:** Delete src/core/exporters/docx-exporter.ts entirely and this test still passes (it would fail only at import time, i.e. for the wrong reason). More practically: if DocxExporter stopped consulting `platform` and hardcoded one brand colour for every platform, this test — the one whose title promises per-platform distinctness — would not notice; only the separate it.each cases would.
- **Suggested fix:** Move the constant-uniqueness assertion into tests/unit/core/exporters/style-tokens.test.ts alongside the other `COLOR` pins (it belongs there and is worth keeping), and replace it here with a rendered-output check: export the same pair under each of the four platform ids, collect the `<w:color w:val="…"/>` value on the assistant role-label run, and assert the four collected values are distinct.

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
