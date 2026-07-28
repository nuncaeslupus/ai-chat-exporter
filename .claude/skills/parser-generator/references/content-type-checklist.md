# Content type checklist

What a parser must handle, and the trap in each. Work through this when adding a
platform or auditing an existing one. Each entry names the failure that was actually
observed in this codebase, not a hypothetical.

Part of the parser-generator skill.

## Contents

- [Text and inline formatting](#text-and-inline-formatting)
- [Headings, lists, blockquotes, horizontal rules](#headings-lists-blockquotes-horizontal-rules)
- [Tables](#tables)
- [Code blocks](#code-blocks)
- [Rendered maths](#rendered-maths)
- [Images](#images)
- [Web search citations](#web-search-citations)
- [Artifacts and canvases](#artifacts-and-canvases)
- [Attachments, audio, video, reasoning traces](#attachments-audio-video-reasoning-traces)
- [Extending the data model](#extending-the-data-model)

## Text and inline formatting

Bold, italic, inline code, links, strikethrough. Handled generically by
`HtmlContentParser` once the content root is correct.

**Trap:** scraping the turn wrapper instead of the content root pulls in
screen-reader-only nodes naming the speaker ("You said:"), which are visually hidden
but not `aria-hidden`. The class differs per framework — `.sr-only` on Tailwind
(ChatGPT), `.cdk-visually-hidden` on Angular (Gemini). See the live verification
reference for the full table and the generalised fix.

## Headings, lists, blockquotes, horizontal rules

Standard markdown output. Nested lists need a parser that recurses into `li > ul`.

**Trap:** a message carrying artifact or web-search metadata once bypassed
`HtmlContentParser` entirely and collapsed to a single flattened paragraph, so
`<ol><li>First</li><li>Second</li></ol>` exported as `First pointSecond point` with
no separator. Check that the rich path is not skipped for messages with metadata.

## Tables

`<table>` with `thead`/`tbody`, sometimes without either wrapper.

**Traps:**
- ChatGPT wraps tables in a hashed CSS-module container (`TyagGW_tableWrapper`) —
  never select on it.
- A "Copy table" button sits inside the table wrapper, inside the content root.
- Cells may be empty; a table may have no header row.

## Code blocks

The most platform-variable content type.

**ChatGPT (2026-07):** an embedded CodeMirror 6 viewer. Outer
`pre.overflow-visible!` wrapper, then `div#code-block-viewer.cm-editor`, then a
*second* `pre.cm-content > code` with no class. The language is not in the DOM as a
class; it is recoverable from the sticky header's text (clone and strip buttons
first, or "Copy"/"Run" leak in). Short blocks put the whole body in one `<span>`;
longer highlighted ones split into one span per token.

**Traps:**
- Selecting `pre code` naively can reach the inner `cm-content`. Pick one level
  deliberately.
- Never infer the language from the code body.
- Virtualization: CodeMirror windows very large documents in principle. Measured at
  160 lines — all present, no truncation. Unverified for thousands of lines. The
  outer wrapper's `data-start`/`data-end` are exact character offsets of the full
  fenced block on real captures and would make a good truncation signal, but they are
  placeholder round numbers on the repo's older hand-authored fixtures, so do not
  build a detector on them without validating against fresh captures.
- DOCX needs an explicit line break per line; a literal `\n` inside an OOXML run is
  collapsed by Word.

## Rendered maths

KaTeX (ChatGPT, Gemini) and MathJax (`mjx-container`).

Up to three copies of the same formula coexist:

| part | ChatGPT | Gemini |
|---|---|---|
| `.katex-mathml` | present | absent |
| `annotation[encoding="application/x-tex"]` | present | absent |
| `.katex-html` (`aria-hidden="true"`) | present | present |

**Trap:** neither "strip aria-hidden" nor "keep aria-hidden" is right for both.
Stripping loses the formula on Gemini; keeping triplicates it on ChatGPT
(`E=mc2E = mc^2E=mc2`). Collapse the whole `.katex` node to one representation,
preferring the LaTeX annotation — it is the only lossless option and gives exporters
something better than glyph soup.

## Images

Three legitimate kinds: user uploads, model-generated images, inline markdown images.

**Traps:**
- Citation-pill favicons and artifact preview images live inside the content root and
  get collected as conversation images unless collection is scoped.
- An artifact's decorative `data:image/svg+xml` preview never fires `onload` or
  `onerror`, so a PDF exporter awaiting decode hangs forever. Always time out an
  image decode.
- Prefer a structural check (is it inside a pill / artifact / button?) over a URL
  substring sniff. An `includes('icon')` filter once made a bug's regression test
  pass by coincidence.
- Canvas re-encoding is expensive: cache by `src`, and remember a fresh parser
  instance is constructed on every parse, so an instance field never hits.

## Web search citations

Inline pills linking out, plus a sources panel.

**Traps:**
- Pills sit inside the content root, so their text and favicons are part of any naive
  scrape.
- Favicon URLs are third-party: embedding them in an export means the file phones out
  to that host every time anyone opens it, revealing the cited domains. Drop them or
  inline them; do not ship remote URLs.
- Several exporters read `metadata.webSearches` and several do not, so citations can
  silently vanish from a subset of formats. Test every format.

## Artifacts and canvases

Claude artifacts, ChatGPT canvas.

**Traps:**
- Matching artifacts to messages by position or title misattributes them the moment
  the DOM and an API response disagree about shape (an edited or regenerated turn).
  Match on a stable id, and if none exists, fail loudly rather than guess.
- An artifact can be rendered twice: once as marker text inside the content blocks
  and once as a metadata-driven section appended by the exporter. Decide which one
  survives.

## Attachments, audio, video, reasoning traces

Not yet surveyed in this codebase. ChatGPT's Canvas, Deep Research and o-series
reasoning traces were unreachable on a Free-tier account at the time of the 2026-07
survey. Treat them as unknown territory: probe a live page before assuming either
that they work or that they do not exist. The widget coverage matrix reference lists
the rest of the per-platform surface to work through.

## Extending the data model

A widget sometimes carries information no existing field can hold — a research
report's source count, a thinking panel's trace, an artifact's language. Flattening
it into `content` is lossy and irreversible: once it is a string, no exporter can
render it as anything else.

Extend `src/core/types/conversation.ts` instead.

**Add a typed field when** the shape is known and at least one exporter will render
it specially — like `Artifact` and `WebSearchResult` already do. A typed field gets
compiler help: adding a required property makes every construction site fail to
build, which is exactly the reminder you want.

**Reuse `MessageMetadata`'s index signature (`[key: string]: unknown`) when** the data
is a single platform's incidental detail that every exporter will treat as opaque.
It costs nothing and it also hides nothing from the compiler — which is the risk:
untyped metadata never fails a build when an exporter forgets it.

**Then update every exporter.** There are six formats (pdf, md, txt, json, docx,
html) behind eight implementations in `src/core/exporters/`. A new content type
wired into one of them exports perfectly in that format and silently disappears from
the other five — the exact failure already observed with `metadata.webSearches`,
which several exporters read and several do not.

Checklist for a new content type:

- [ ] type added or extended in `src/core/types/conversation.ts`
- [ ] parser populates it, with a fixture test that fails without the change
- [ ] each of the six formats renders it (or deliberately drops it, with a comment
      saying so)
- [ ] one test per format asserting the content is present in the output
- [ ] plain-text formats have a fallback — txt and md cannot render a diagram, so
      decide what they say instead of emitting nothing
