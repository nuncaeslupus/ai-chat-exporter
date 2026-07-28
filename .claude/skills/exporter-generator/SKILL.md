---
name: exporter-generator
description: Use whenever anything under src/core/exporters/ is being added or repaired — a new output format, a content type missing from some formats, or an exported file that will not open. Triggered by "add EPUB/CSV export", "add a new export format", "images are missing from the DOCX", "the exported PDF is blank", "code blocks look wrong in Word". Do NOT use for extracting content off a chat page (see the parser-generator skill), nor for popup or download plumbing that touches no exporter.
metadata:
  type: workflow
---

# exporter-generator

Adds and repairs export formats for this extension: implement a `BaseExporter`
subclass, register it in the lazy registry, fill in the content-completeness
matrix, and verify the produced file **opens** — not merely that a Blob came back.

CANARY: exporter-generator-loaded-2026-07-28-ce53f101-e8b600fb2ea9c8c2

## When to load

Load this skill when:

- Adding a new output format (EPUB, CSV, LaTeX, …).
- A content type renders in one format and is missing from the others.
- An exported file is malformed — blank PDF pages, a DOCX Word refuses to open,
  an HTML export whose images 404.
- Reviewing an exporter diff for content completeness or a privacy regression.

If the task is about getting content *out of a chat page* and into a
`Conversation`, this is the wrong skill — use the `parser-generator` skill.

## The two rules that matter most

**1. A green unit test proves a Blob was produced, not that the file is correct.**
Every exporter test asserts on substrings of a decoded blob. None of them open the
file. A PDF that renders blank pages, a DOCX that Word rejects, and an HTML export
whose every image 404s all pass their suites. So the workflow ends in a browser,
not in vitest.

**2. A content type implemented in one format is silently missing from the other
five.** That is the dominant defect class in this directory — every block-walking
`switch` has a `default` that emits nothing, so a new content type degrades to
silence rather than to an error. The matrix below exists to make that visible
instead of assumed.

## Ground truth — read before writing anything

- `src/core/types/conversation.ts` — `Conversation` / `QAPair` / `Message` /
  `MessageMetadata` (artifacts, webSearches, images, research).
- `src/core/types/structured-content.ts` — the **block** model exporters actually
  render: paragraph, heading, code, list, blockquote, table, hr, image, plus
  `InlineContent` (text/bold/italic/code/link/strikethrough, with `url` on links).
- `src/core/services/conversation-structure-service.ts` — converts a
  `Conversation` into a `StructuredConversation`. Every exporter except JSON goes
  through it.
- `src/core/exporters/base-exporter.ts` — the contract.
- `src/core/exporters/index.ts` — the lazy registry.
- `docs/PRIVACY.md` — the per-format promise about what an opened export requests.

`src/core/exporters/html-pdf-exporter.ts` and `src/core/exporters/md-exporter.ts`
are **not** live exporters — neither is in the registry. Do not copy them as
templates and do not count them in the matrix. There are six real formats: md,
txt, json, pdf, docx, html.

## The pipeline

```
Conversation ──ConversationStructureService.toStructured()──▶ StructuredConversation
     │                                                              │
     │ raw metadata (artifacts, webSearches) read directly          │ blocks[]
     └──────────────────────┬───────────────────────────────────────┘
                            ▼
             exporter.export(conversation, selectedPairs, options)
                            ▼
              ExportResult { success, blob, filename, mimeType }
```

Two consequences of that split, both of which have already caused live bugs:

1. The structure service **already appends** a marker paragraph per artifact
   (`[<typeLabel>: <title>]`) and per web search (`[Web Search: <query>]`). An
   exporter that *also* renders `pair.answer.metadata.artifacts` emits the content
   twice. Pick one source per content type and say which in the matrix.
2. Anything the structure service does not fold into `blocks` is invisible to an
   exporter that only walks blocks. `metadata.research` sits in that position
   today and is dropped by all six formats.

## The contract

```typescript
export abstract class BaseExporter implements IExporter {
  abstract readonly format: ExportFormat;   // must be in the ExportFormat union
  abstract readonly extension: string;      // no leading dot — "md", not ".md"
  abstract readonly mimeType: string;

  abstract export(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult>;
}
```

Inherited helpers — use them rather than re-deriving: `createSuccessResult`,
`createErrorResult`, `validateOptions`, `formatTimestamp`, `formatPlatformName`,
`getMetadataLabel`, `getRoleName`. The last three are i18n-aware; hardcoding
English labels is a regression.

`selectedPairs` is the authority on what to export — never iterate
`conversation.pairs`. The five structured exporters get this right by rebuilding
the conversation before conversion:

```typescript
const structured = ConversationStructureService.toStructured({
  ...conversation,
  pairs: selectedPairs,
});
```

Never throw out of `export()`. Catch and return `createErrorResult(...)`.

## Adding a format

1. **Type** — add the id to `ExportFormat` in `src/core/types/exporter.ts`, plus
   `EXPORT_FORMATS` and `FORMAT_INFO` in the same file.
2. **Exporter** — `src/core/exporters/<format>-exporter.ts` extending
   `BaseExporter`. Nearest templates: `txt-exporter.ts` (simplest complete block
   walk), `structured-md-exporter.ts` (markup), `docx-exporter.ts` (binary).
3. **Register — lazily.** In `src/core/exporters/index.ts`:

   ```typescript
   ['epub', async () => new (await import('./epub-exporter')).EpubExporter()],
   ```

   > **Do not add a static `export { EpubExporter } from './epub-exporter'` to
   > that barrel.** The content script is injected on every page load. Every
   > exporter moved behind a dynamic `import()` so the bundler emits one
   > chunk per format, cutting the eager content-script bundle from **2.24 MB to
   > 48.6 KB**. One retained static re-export drags the whole graph — jsPDF, docx
   > — back into that bundle and undoes it. `pnpm build:content` runs
   > `build/check-bundle-size.cjs`; if it fails, an eager import crept in.

4. **Popup** — add an `<option value="<format>" data-i18n="format<Name>">` to
   `src/extension/popup/popup.html`, and the matching string in **every**
   `_locales/*/messages.json`.
5. **Matrix** — fill in a column in `references/completeness-matrix.md`. Every
   row, explicitly.
6. **Tests** — a unit test in `tests/unit/core/exporters/` *and* coverage in
   `tests/integration/fixture-to-parser-to-exporter.test.ts`, which runs a real
   fixture through a real parser into every registered exporter. A binary format
   needs a decode step there (see the `docx` zip branch and the `pdf` latin1
   branch in that file).
7. **Privacy** — declare the format's behaviour in `docs/PRIVACY.md` (below).
8. **Browser verification** — mandatory (below).

## The completeness matrix

Load `references/completeness-matrix.md` and fill in a column for the new format,
or re-derive the affected row when fixing a "works in X, missing in Y" report.
The matrix is the deliverable, not a nicety.

Rules for using it:

- **Fill every cell.** `✅`, a rendering note, or `❌ dropped` — never blank,
  never "probably fine". A blank cell is how a gap survives review.
- **Verify each cell against the code**, not against a test name. Grep the
  exporter for the block type or metadata key and read the branch.
- `❌ dropped` is an acceptable answer when the format genuinely cannot carry the
  content — but it must be written down, and a *new* drop belongs in
  `docs/PRIVACY.md` or the format's limitations note too.

## Browser verification — required before claiming done

```bash
pnpm build:chrome
```

Load `dist/chrome` unpacked at `chrome://extensions` (Developer mode → Load
unpacked), open a real conversation on a supported platform, and export it in
**every** format the change could touch. A change to the structure service or to
a `BaseExporter` helper touches all six.

Then **open each produced file**:

| format | open with | what a passing unit test would still miss |
|---|---|---|
| md | a markdown viewer | image tags pointing at expired URLs |
| txt | any editor | table columns collapsed into unreadable runs |
| json | `jq .` | invalid JSON from an unescaped field |
| pdf | a PDF viewer | blank pages, clipped text, images missing entirely |
| docx | Word / LibreOffice | "file is corrupt"; code blocks collapsed to one line |
| html | a browser | 404 images, broken layout, console errors |

The Browser pane tools (`mcp__Claude_Browser__*`) cover the HTML export and the
source conversation page: `preview_start` with a `file://` URL to open the export,
`read_console_messages` for script errors, and `read_network_requests` to see
**exactly which hosts the opened file contacts** — which is also the privacy check
below.

## Privacy constraints on exported files

`docs/PRIVACY.md` promises what an exported file does when someone opens it. An
exporter is the only place that promise can be broken.

Current state, and what a new exporter must declare:

- **PDF** inlines conversation images as data URIs — self-contained, requests
  nothing.
- **HTML** and **Markdown** reference conversation images by their original URL,
  so opening one asks the provider's servers for them. Those URLs are
  session-scoped and usually fail once signed out. Documented and accepted.
- **DOCX** and **TXT** replace images with a text placeholder; **JSON** records
  URLs as inert data.
- **No export embeds any other third-party resource** — no stylesheet, script,
  web font, tracking pixel, or icon.

**Citation favicons are the cautionary tale.** Chat pages serve them from
third-party icon services (Google's `s2/favicons`, `logo.clearbit.com`). Carried
into an export, every open told that service which sources the reader had exported
and revealed their IP. Both parsers now drop the favicon at the source rather than
inline it — the fix was made in the parser, not the exporter, so nothing downstream
can reintroduce it by accident.

So: a new exporter must state in `docs/PRIVACY.md` whether it inlines images or
references them by URL, and must embed **no** third-party request beyond that.
When unsure, open the export with `read_network_requests` running and read the
host list.

## Extending the content model

If a format needs a content type the model does not carry, `src/core/types/`
changes — and **every exporter must be updated in the same change.** A new block
type added to `StructuredContentBlock` with only one exporter's `switch` extended
renders in that format and silently vanishes in the other five.

Order of work:

1. Add the type in `structured-content.ts` (or the metadata field in
   `conversation.ts`).
2. Populate it in `conversation-structure-service.ts` — otherwise no exporter ever
   sees it.
3. Extend the `switch` in **all five** structured exporters. JSON needs no change
   for a message-metadata field (it dumps metadata wholesale) but does for
   anything conversation-level.
4. Add the row to the completeness matrix.
5. Add a case to the round-trip integration test.

## Gates

```bash
pnpm typecheck
pnpm test:run
pnpm build          # runs check-bundle-size.cjs — catches an eager import
```

Plus the browser verification above. A change that skips it is not done.

## References — load on demand

- [Completeness matrix](references/completeness-matrix.md) — content type ×
  format for the current tree, the recipe for re-deriving it, and the gaps it
  has already surfaced. Load when adding a format or chasing a "works in X,
  missing in Y" report.

## Gotchas

- **A static re-export in the registry barrel silently undoes the bundle split.**
  The registry compiles and every test passes; the only signal is
  `check-bundle-size.cjs` during `pnpm build:content`, so never skip the build.
- **Artifacts and web searches arrive twice.** The structure service appends a
  marker paragraph *and* the exporters read `pair.answer.metadata` directly. An
  exporter that renders both prints the content twice — this is live today in md,
  txt, pdf, docx and html.
- **`extension` must not carry a leading dot.** `createSuccessResult` builds
  `` `${filename}.${this.extension}` ``, so `'.md'` yields `export..md`.
- **txt and pdf flatten inline content to `item.text`.** Link URLs are discarded;
  only the anchor text survives. Anything relying on inline formatting must check
  those two before assuming parity with md/html/docx.
- **JSON bypasses the structure service entirely.** It emits raw `content`,
  `htmlContent` and `metadata`. A block-model change is invisible to it, and a
  conversation-level field change must be added to it by hand.
