---
id: lo-3cae
title: "D-23: raw DOM whitespace leaks into paragraph text around citation pills in every format"
priority: 5
workspace: "EXPORTERS"
tags: ["correctness"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/176
---

Found by rendering a real export off `tests/fixtures/dom-snapshots/chatgpt/comprehensive.html`
rather than by any test — the suite asserts the citation *data* is present, never
that the surrounding prose is clean.

**What the spec requires:** a paragraph in an export reads as a paragraph.

**What the code does:** the text extracted around a web-search citation pill
carries the source DOM's newlines and indentation verbatim. From the `.md`
export of that fixture (`cat -A`, `$` = end of line):

```
Let me provide a comprehensive overview of modern web development technologies, backed by research $
            $
              MDN Web Docs$
            $
          $
            $
              web.dev$
            $
          .$
```

One sentence becomes ten lines. It hits **every** format — the same breakage is
in the `.txt` output, and in the `.html` the pill text arrives pre-broken. In
Markdown the blank lines additionally terminate the paragraph, so what should be
one block renders as several.

**Not covered by the existing tasks.** `lo-3005` is about artifacts/web-searches
losing rich formatting; `lo-23fb` is about web-search titles and URLs being
*dropped* from md/txt/docx. This is the opposite failure: the data is present
but the whitespace around it is unnormalised.

**Fix location:** the text-extraction path that flattens a citation pill's
element into the parent paragraph's text — collapse runs of whitespace to a
single space there, at the shared helper rather than per-format, so all six
formats are fixed once. Start from `src/core/utils/` (the cleanup/sanitize
helpers) and `src/core/parsers/chatgpt/`, and check whether Claude's and
Gemini's citation paths flatten through the same code.

## Acceptance gate

A real fixture export contains no line that is only whitespace inside a
paragraph, and the citation sentence stays on one line.

```bash
pnpm test:run tests/integration/fixture-to-parser-to-exporter.test.ts
```

## Tests
Extend `tests/integration/fixture-to-parser-to-exporter.test.ts` — it already
parses this exact fixture through every exporter, so the assertion belongs
there: for md and txt, no run of two or more newlines inside an answer's
paragraph text, and the citation names on the same line as the prose.

## Location
`src/core/utils/`, `src/core/parsers/chatgpt/`
