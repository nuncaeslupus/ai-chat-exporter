# Payload: lo-23fb — Web search results are dropped from three formats

## Acceptance gate

**Gate**: citation titles and URLs appear in md, txt and docx exports.


Prose-only gate — verified by worker judgment, no script to run.

`src/core/exporters/structured-md-exporter.ts:44` and the txt/docx equivalents render only the `[Web Search: …]` marker; `WebSearchResult.results` — the titles, URLs and domains the parser worked to extract, and which the ChatGPT citation tests explicitly verify — never reaches those three formats. The data is captured and then thrown away.

Fix: render the result list in all formats. Build the block-type × exporter coverage matrix while in there; this is unlikely to be the only field handled by some exporters and silently dropped by others.
