# A-1: prose artifacts in pdf and docx, and markdown CODE must stay code

Author feedback, 2026-07-30: "shouldn't [md artifacts] be shown rendered in all
versions (except maybe for txt and json)? I understand sometimes MD code can be
shown. In those cases, it should be kept as code, but not in an artifact like a
deep research."

Two distinct defects.

## 1. The predicate is too broad — this is the bug the author named

Three exporters share it:

```ts
artifact.type === 'document' || artifact.language === 'markdown'
```

- `src/core/exporters/html-exporter.ts:275`
- `src/core/exporters/structured-md-exporter.ts:160`
- `src/core/exporters/docx-exporter.ts:515`

The second clause is wrong. A **code** artifact whose language happens to be
markdown — someone asking "show me the raw markdown for this table" — is source,
and must render as a code block. Only `type === 'document'` (a deep-research
report, a written document) is prose.

Fix the predicate in one shared helper rather than three times.

## 2. pdf and docx do not render prose at all

- **pdf** has no branch: every artifact goes into a code block.
- **docx** has the branch but it is a stub — the comment says "Full markdown
  parsing for DOCX would be complex / For now, just render as formatted text",
  and it emits the raw markdown source as a single unstyled paragraph. So `##`
  and `[text](url)` are shown to the reader exactly as html did before #171.

html is correct as of #171 (renders via `marked`, sanitized). md is correct
(passes the content through as markdown, which IS the format).

**txt and json are deliberately excluded** — plain text has no rendering, and
json is a data format that must stay lossless.

**For docx**, rendering means walking the parsed markdown into real `Paragraph` /
`TextRun` / `Table` structures. `ConversationStructureService` already turns
HTML into structured blocks and the docx exporter already renders those, so the
likely route is: markdown -> HTML (`marked`) -> existing structured pipeline ->
existing docx block renderer, rather than a second markdown renderer.

## Acceptance gate

A `type: 'document'` artifact renders as headings/lists/tables in pdf and docx;
a `type: 'code'` artifact with `language: 'markdown'` renders as a code block in
every format.

```bash
pnpm test:run tests/unit/core/exporters/claude-artifact-types-formats.test.ts tests/unit/core/exporters/html-exporter.test.ts tests/unit/core/exporters/docx-exporter.test.ts
```

## Tests
`claude-artifact-types-formats.test.ts` already drives every artifact type
through all six formats — add the markdown-code-vs-document distinction there,
since that is exactly the matrix it exists for.

## Location
`src/core/exporters/{html,docx,pdf,structured-md}-exporter.ts`
