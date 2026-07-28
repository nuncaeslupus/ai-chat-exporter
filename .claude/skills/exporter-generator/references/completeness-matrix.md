# Completeness matrix — content type × export format

Every content type the model can carry, checked against every export format.
Derived by reading the code, not the tests. Load this when adding a format
(fill a new column) or when chasing a "works in X, missing in Y" report
(re-derive the row).

## Contents

- [How to re-derive it](#how-to-re-derive-it)
- [The matrix](#the-matrix)
- [Known gaps](#known-gaps)
- [Adding a column](#adding-a-column)

## How to re-derive it

The matrix is a snapshot. Re-derive any row you depend on rather than trusting
the table below.

**Structured blocks.** Every exporter except JSON walks
`StructuredContentBlock` in a `switch`. List the cases per exporter:

```bash
grep -n "case '" src/core/exporters/txt-exporter.ts
```

A block type missing from a `switch` hits the `default` and emits **nothing** —
that is the silent-drop mechanism. Compare each exporter's case list against the
`StructuredContentBlock` union in `src/core/types/structured-content.ts`.

**Inline content.** `InlineContent` carries `type`, `text`, and `url` (links
only). An exporter either has a `renderInline` that switches on `type`, or it
flattens with `content.map(i => i.text).join('')` — which discards link URLs and
all emphasis:

```bash
grep -n "renderInline\|inlineToText\|inlineToPlainText" src/core/exporters/*.ts
```

**Message metadata.** `MessageMetadata` fields (`artifacts`, `webSearches`,
`images`, `research`) reach an exporter by two independent routes: folded into
`blocks` by `ConversationStructureService.convertMessage`, or read directly off
`pair.answer.metadata` by the exporter. Check both:

```bash
grep -n "artifacts\|webSearches\|images\|research" \
  src/core/services/conversation-structure-service.ts
grep -n "metadata?.artifacts\|metadata?.webSearches\|metadata?.images\|metadata?.research" \
  src/core/exporters/*.ts
```

Both routes firing for the same field is a double-render, not belt-and-braces.

**Conversation-level fields.** `title`, `platform`, `model`, `url`, `createdAt`,
and the `selectedPairs` filter:

```bash
grep -n "includeMetadata\|createdAt\|selectedPairs" src/core/exporters/*.ts
```

## The matrix

Six live formats. `md` is `structured-md-exporter.ts`; `md-exporter.ts` and
`html-pdf-exporter.ts` are unregistered dead code and are not columns.

### Structured blocks

| block | md | txt | json | pdf | docx | html |
|---|---|---|---|---|---|---|
| `paragraph` | ✅ | ✅ | raw¹ | ✅ | ✅ | ✅ |
| `heading` | ✅ | ✅ | raw¹ | ✅ | ✅ | ✅ |
| `code` | ✅ fenced | ✅ `[lang]` + raw | raw¹ | ✅ | ✅ one run per line² | ✅ `<pre><code>` |
| `list` | ✅ | ✅ | raw¹ | ✅ | ✅ | ✅ |
| `blockquote` | ✅ | ✅ | raw¹ | ✅ | ✅ | ✅ |
| `table` | ✅ | ✅ ASCII | raw¹ | ✅ | ✅ real table | ✅ `<table>` |
| `hr` | ✅ | ✅ | raw¹ | ✅ | ✅ | ✅ |
| `image` | `<img src=URL>` | `[Image: alt]` | raw¹ | ✅ inlined data URI³ | `[Image: alt]` | `<img src=URL>` |

¹ JSON never converts to the block model. It emits `content`, `htmlContent` and
`metadata` verbatim, so all block detail is present as raw source but nothing is
*rendered*.
² One `TextRun` per line with an explicit break — a literal `\n` inside a single
run is not a line break in OOXML and Word collapses it.
³ `pdf-exporter.ts` pre-loads every image URL via `loadImagesParallel` and calls
`doc.addImage` with the data URI; a failed load degrades to `[Image: alt]`.

### Inline content

| inline | md | txt | json | pdf | docx | html |
|---|---|---|---|---|---|---|
| `text` | ✅ | ✅ | raw | ✅ | ✅ | ✅ |
| `bold` | ✅ | ❌ flattened | raw | ❌ flattened | ✅ | ✅ |
| `italic` | ✅ | ❌ flattened | raw | ❌ flattened | ✅ | ✅ |
| `code` | ✅ | ❌ flattened | raw | ❌ flattened | ✅ | ✅ |
| `strikethrough` | ✅ | ❌ flattened | raw | ❌ flattened | ✅ | ✅ |
| `link` (text) | ✅ | ✅ text only | raw | ✅ text only | ✅ | ✅ |
| `link` (**url**) | ✅ | **❌ dropped** | raw | **❌ dropped** | ✅ | ✅ |

txt and pdf use `content.map(i => i.text).join('')`, which cannot see `url`.

### Message metadata

| content type | md | txt | json | pdf | docx | html |
|---|---|---|---|---|---|---|
| `artifacts` — marker paragraph | ✅ | ✅ | n/a | ✅ | ✅ | ✅ |
| `artifacts` — full content | ✅ | ✅ | raw | ✅ | ✅ | ✅ |
| `artifacts` — **net result** | ⚠️ twice | ⚠️ twice | raw once | ⚠️ twice | ⚠️ twice | ⚠️ twice |
| `webSearches` — query | ✅ marker | ✅ marker | raw | ✅ section | ✅ marker | ✅ section |
| `webSearches` — result title | **❌** | **❌** | raw | ✅ | **❌** | ✅ |
| `webSearches` — result url | **❌** | **❌** | raw | ✅ | **❌** | ✅ |
| `webSearches` — favicon | n/a⁴ | n/a⁴ | n/a⁴ | n/a⁴ | n/a⁴ | ⚠️ latent⁵ |
| `images` (standalone) | ✅ | ✅ | raw | ✅ | ✅ | ✅ |
| `research` (ChatGPT) | **❌** | **❌** | raw | **❌** | **❌** | **❌** |
| `htmlContent` | via blocks | via blocks | ✅ verbatim | via blocks | via blocks | via blocks |

⁴ Both parsers drop `favicon` at the source, so the field is never populated.
⁵ `html-exporter.ts` still has a `result.favicon ? <img src=…>` branch. Dead while
parsers drop the field; it would re-open the third-party-request leak the moment
any parser repopulates it.

Standalone `metadata.images` reach every exporter because
`ConversationStructureService` folds them into `image` blocks; the per-format
rendering is then the `image` row of the block table.

### Conversation-level

| field | md | txt | json | pdf | docx | html |
|---|---|---|---|---|---|---|
| `title` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `platform` | ✅ gated⁶ | ✅ gated⁶ | ✅ always | ✅ gated⁶ | ✅ gated⁶ | ✅ gated⁶ |
| `model` | ✅ gated⁶ | ✅ gated⁶ | ✅ always | ✅ gated⁶ | ✅ gated⁶ | ✅ gated⁶ |
| `url` | ✅ gated⁶ | ✅ gated⁶ | ✅ always | ✅ gated⁶ | ✅ gated⁶ | ✅ gated⁶ |
| `createdAt` | ✅ | ✅ | ✅ ISO | ✅ | ✅ | ✅ |
| `selectedPairs` honoured | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| per-message `timestamp` | ❌ | ❌ | ✅ ISO | ❌ | ❌ | ❌ |

⁶ Gated on `options.includeMetadata`. JSON ignores that option and always emits
the metadata block.

## Known gaps

Standing gaps in the current tree, in rough order of user impact. Confirm each
against the code before acting — the tree moves.

1. **Artifacts render twice in all five structured formats.** The structure
   service appends `[<typeLabel>: <title>]` as a marker paragraph *and* each
   exporter renders the full artifact from `pair.answer.metadata.artifacts`. Fix
   at one end only: either stop appending the marker, or stop re-reading raw
   metadata.
2. **Web-search results lose title and URL in md, txt and docx.** Only the
   `[Web Search: <query>]` marker survives; pdf and html render the full result
   list. The citations are the point of a web search, so this is a real content
   loss.
3. **Link URLs are dropped by txt and pdf.** Both flatten `InlineContent` to
   `.text`. A PDF export of a citation-heavy answer keeps the anchor text and
   loses every destination.
4. **`metadata.research` is dropped by all six formats.** ChatGPT deep-research
   duration/sources/searches is parsed, stored, and rendered nowhere. Either fold
   it into `blocks` in the structure service or delete the field.
5. **The html-exporter favicon branch is a latent privacy regression.** Dead
   while both parsers drop `favicon`, but it would silently restore the
   third-party icon request in exported HTML if any parser repopulates the field.
6. **Per-message timestamps reach only JSON.** `StructuredMessage.timestamp` is
   populated for every message and rendered by no human-readable format.

## Adding a column

When adding a format, add its column to all four tables above before opening the
PR. Filling it is what surfaces the gaps: work down the rows and answer each one
from the code you just wrote.

For any cell you have to write `❌`, decide explicitly whether it is:

- a real limitation of the format (write it into `docs/PRIVACY.md` or the
  format's limitations note), or
- a gap you are shipping (add it to **Known gaps** above so the next person
  finds it).

Never leave a cell blank.
