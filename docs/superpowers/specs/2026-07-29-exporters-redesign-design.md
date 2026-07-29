# Exporters redesign — one type system for the six formats

**Date:** 2026-07-29
**Source design:** `Formatos de Exportación.dc.html` (turn 1, direction **1a**)
**Scope:** `src/core/exporters/*`, plus three prerequisites outside it.

---

## Problem

Each format currently decides its own typography. The PDF is hand-drawn with
jsPDF's built-in fonts, the DOCX inherits Word's `Heading N` styles (so it
renders differently on every machine), and the role labels `User` / `ChatGPT`
are level-2 headings — which is why they render enormous. The design inverts
this: **the role label stops being a heading and becomes a label**, body
headings reclaim the high levels, and all six formats share one scale, one
palette and one set of composition rules.

## Decisions taken

| Question | Decision |
|---|---|
| Per-turn timestamps | Wire Claude's API times first, then redesign |
| Metadata / timestamp options | Merge into one `showMetaInfo` |
| PDF direction | **1a** — neutral sans, role label **R2** (platform rule) |
| PDF fonts | Embed Source Sans 3 + IBM Plex Mono |
| Bundle sequencing | Lazy-load exporters (lo-c03f) **first** |
| Plain-text code blocks | Fenced with language, not indented |
| Paper size | Every paged format respects the preference |
| Timestamps vs. meta | Times render only when `showMetaInfo` is on |

Directions 1b (documentary serif) and role treatments R1 / R3 are recorded in
the design doc as rejected; they are not built.

---

## Finding that reshapes the design: there are no timestamps

Divergence D-18 (`src/core/parsers/base-parser.ts:139-144`) established that no
platform exposes a per-message time **in the DOM**, so `Message.timestamp` is
deliberately left unset rather than stamped with the capture moment. No parser
writes it today — there are zero writers in `src/`.

Consequences in shipped code:

- `includeTimestamps` renders nothing in any format. It is a dead toggle.
- `formatTimestampSuffix()` always returns `''`.
- `dateBounds()` / `formatDateRange()` always return `null` / `''`, so the
  date-range line the popup handoff requires (note 5) cannot render either.
- Every `12:04` / `12:05` in the design mocks is fiction.

But the DOM is not the only source. `src/core/types/claude-api.ts:61` — the
Claude enrichment fetch already returns `created_at` per message, and
`ClaudeApiService` mines it only for artifacts. ChatGPT has an equivalent
same-origin endpoint (not in scope here). Gemini has none.

So: **times are real for Claude, absent everywhere else.** Every format must
read well with the time missing; the time is an enhancement, never a
load-bearing element of the layout.

---

## Phase 0 — prerequisites

### 0.1 Lazy-load exporters (lo-c03f)

The content script is 2.24 MB injected on every page load. Embedding four font
faces makes that worse. Dynamic-import the exporters (and the font module) so
they load when an export is requested, not when a page opens.

**Gate:** built content-script bundle under 500 KB; exporting still works on a
live page for all six formats.

### 0.2 Claude per-turn timestamps

Map `ClaudeApiChatMessage.created_at` → `Message.timestamp` in the enrichment
path.

Two structural problems in `enrichConversationWithArtifacts` block this and
must be fixed as part of the task:

1. It returns early when `artifactsByMessageUuid.size === 0`. Timestamps riding
   that path would only ever appear in conversations that happen to contain
   artifacts. The early return must go.
2. Pair↔message matching is **positional** (documented in the method's comment:
   the DOM exposes no id related to the API's uuid), and it validates only the
   *assistant* count. Questions need the `sender: 'human'` messages too, so the
   guard must validate both counts before trusting either mapping.

Extract the positional matching into one helper that both artifacts and
timestamps consume, keeping the existing count-mismatch bail-out and its
user-facing `warning`.

**Gate:** a fixture Claude conversation with no artifacts still gets
timestamps; a count mismatch still returns the warning and enriches nothing.

### 0.3 `showMetaInfo`

Collapse `includeMetadata` + `includeTimestamps` into a single preference.

- `ExportOptions`, `PrintOptions`, `ExtensionPreferences`, the content-script
  message payloads and `DEFAULT_*` constants all lose one field.
- Stored preferences migrate `includeMetadata` → `showMetaInfo`; a stored
  `includeTimestamps` is discarded. Note the two defaults currently disagree
  (`config.ts` has `includeTimestamps: false`, `exporter.ts` and
  `constants.ts` have `true`) — `showMetaInfo` defaults to **true**.
- `optionIncludeTimestamps` is removed from all seven `_locales`;
  `optionIncludeMetadata` is re-worded to the merged meaning.

On: header block **and** per-turn time where one exists. Off: neither — a
message time is meta-info, so it is gated by the same switch, and no format
emits a time (or a day separator) when `showMetaInfo` is off. This is what
`formatTimestampSuffix(date, includeTimestamps)` and `daySeparator()` already
do; they simply take the merged flag now.

**Touches `src/extension/popup/`** — the only file shared with the concurrent
popup work. Coordinate before landing.

---

## Phase 1 — the shared type system

All of this lives in `src/core/exporters/style-tokens.ts`, which already holds
the canonical scale, palette and conversion helpers.

### Scale (pt, `normal` step)

| Token | Now | After |
|---|---|---|
| Document title | 20 | 20 |
| Body H1 | — | 13 |
| Body | 12 | **10.5** |
| Code | 10 | **9** |
| Role label | 15 (PDF), heading level 2 | **8.5, a label** |
| Metadata, footers | 10 | **8.5** |

`FONT_SCALE_FACTOR` (0.8 / 1 / 1.25) is unchanged — it already produces the
design's compact 8.4 pt and large 13.1 pt from a 10.5 pt body.

### Heading levels

The role label stops being a heading. `DOC_HEADING_LEVEL.roleLabel` is removed
and `bodyHeadingLevel`'s offset drops from +2 to +1: only level 1 (the
conversation title) stays occupied, so body headings start at level 2 — `##` in
Markdown, as the design specifies.

### Ink

Neutral grey, not the blue-tinged Tailwind scale in use now.

| Use | Value |
|---|---|
| Headings | `#14181A` |
| Body | `#33393C` |
| Labels, footers | `#6B7378` |
| Rules | `#E3E6E4` |
| Turn fill | `#F6F7F6` |

The only colour on the page is the platform's, and only in the role-label rule
and in links. `COLOR.brand` keeps its current values.

**The turn fill moves from the answer to the question.** The background now
marks who is *asking*, not who is answering — HTML currently does the reverse.

### Code token palette

Five classes, not twenty. Dark and low-saturation so they pass AA on the block
background and stay distinguishable printed in greyscale.

| Class | Value |
|---|---|
| Keyword | `#9C3F63` |
| Function, class | `#4C5FA8` |
| String | `#12665A` |
| Number, constant | `#8A5A1A` |
| Comment | `#8D9598` |

`highlight.js` is already a dependency (dynamically imported on the print
path). The work is a scope→class map from hljs output down to these five, not a
tokenizer. Applied in PDF, DOCX (runs with explicit colour, so Word shows it)
and HTML. **Markdown and plain text carry code untouched** — the fence's
language tag already tells GitHub how to paint it.

---

## Phase 2 — per format

### PDF

- Source Sans 3 (body) + IBM Plex Mono (code), embedded via `addFileToVFS`.
  Also fixes Unicode: jsPDF's standard 14 are Latin-1 only, so `−`, `√` and
  `—` do not render today.
- Role label **R2**: 8.5 pt, platform-coloured rule, time in the same size and
  a lighter grey so it does not compete with the name.
- Page size from `PdfExportOptions.pageSize`, which `pdf-exporter.ts:109`
  already forwards to jsPDF. The design doc's "A4" fixes only the **margins**
  — 20 / 18 / 16 mm — which are size-independent. Rewriting the layout must
  not hardcode A4 page dimensions; every measurement is taken from the page
  jsPDF actually created.
- Document header on page 1 only; from page 2 a running head with title and
  platform.
- Footer: "Exported with AI Chat Exporter" and the page number.
- Question on `#F6F7F6`, answer on white.
- Tables: horizontal rules only, tabular figures, numeric columns right-aligned.
- Code block: language in a tab above the block, not inside the code.
- Never fewer than two lines of a paragraph either side of a page break
  (`PAGINATION` already declares orphans / widows / keepWithNextLines).

### DOCX

- Own styles — `ChatTitle`, `ChatBody`, `ChatRole`, `ChatCode` — with all
  formatting declared, replacing `Heading N`. This is what makes the document
  render identically in anyone's Word.
- Calibri + Consolas: present in every Office install on Windows and Mac.
- Tables with explicit borders at 100 % width, `cantSplit` on rows, header row
  repeated across page breaks.
- `keepNext` on labels and headings, `keepLines` on short paragraphs.
- Page number as a real Word field, bottom right — not literal text.
- Page size from the same preference as the PDF. **DOCX sets no page size
  today** — it takes the `docx` library's default regardless of what the user
  chose, which is the actual paper-size bug. Add an explicit `SectionProperties`
  page size, with the same margins in mm as the PDF.
- `pageSize` admits `legal` as well as `a4` and `letter`
  (`src/core/types/exporter.ts:33`). All three must work in both paged
  formats; the design doc mentions only two.

### Markdown

- Role label becomes `**Usuario** · 12:04` — bold plus separator, not `## 🤖`.
- Question rendered as a blockquote.
- Metadata as a table: Platform, Model, Range, Exported, URL.
- Body headings start at `##`.
- Native `![alt](url)`, replacing the raw 200 px `<img>`.
- Fenced code with the language on the fence; the language is **not** repeated
  as text (GitHub does not show it). It appears in the print stylesheet only,
  as the tab.
- A GitHub-style print stylesheet doubles as the `.md` preview sheet.

### Plain text

- Fixed 72 columns; the separator rule spans all 72.
- Three underline levels: `=` title, `-` role label, `~` body heading.
- Role label uppercase with the time, underlined to its exact width.
- Question indented two spaces — the plain-text equivalent of the PDF's fill.
- Tables: ASCII box when there is a header row (`=` under the header);
  key/value pairs aligned only, no box.
- Code: fenced with language, **not** indented — indenting steals four of the
  72 columns and wraps long lines.

### HTML

Changes least, deliberately: adopt the new scale, role label at 10.5 pt in
small caps instead of a heading, time in light grey, brand rule under the
label, horizontal-rule tables, the same neutral grey. The assistant message
loses its grey fill; the question gains it.

### JSON

No visual surface, two fixes: `schemaVersion: 2`, two-space indent and a
stable key order so a diff between two exports is readable; timestamps as
ISO-8601 **with offset** rather than bare UTC. `dateRange` is emitted from
`dateBounds()`.

---

## Testing

`tests/unit/accessibility/contrast.test.ts` already reads real colour
declarations out of `style-tokens.ts` and `html-exporter.ts` and asserts WCAG
AA. Extend it to cover:

1. The new ink palette, light and dark.
2. The five code tokens against the code-block background (AA).
3. Greyscale separation between the five tokens — the design claims they stay
   distinguishable printed in black and white, so assert a minimum luminance
   gap rather than trusting the claim.

This is the mechanical acceptance gate for the redesign as a whole. Per-format
work additionally needs the existing exporter tests to pass; `lo-8d36` (add
tests for pdf, docx and html exporters) is a standing gap that this redesign
makes more urgent, since it rewrites all three.

---

## Out of scope

- ChatGPT timestamps via its backend endpoint — same technique as 0.2, separate
  task, separate risk.
- Gemini timestamps — no source exists.
- The popup redesign (`src/extension/popup/`), which is shipped and owned
  elsewhere. Only 0.3 touches it.
- Directions 1b, R1, R3.
