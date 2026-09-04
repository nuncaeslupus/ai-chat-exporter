---
id: lo-0cd5
title: "Test html-content-parser: 446 lines at 3.7 percent coverage feeding three exporters"
priority: 8
workspace: "TESTING"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/18
---

## Acceptance gate

**Gate**: `src/core/services/html-content-parser.ts` above 80 % statement coverage.


Prose-only gate — verified by worker judgment, no script to run.

446 lines at **3.73 % statements / 0 % functions** — the most complex untested unit in the repo, and it feeds the structured-md, docx and html exporters. Untested logic: nested `<div>` block detection (line 134), table header/body parsing (284-329), recursive inline formatting (334-435), code-block extraction.

## Tests

- headings, nested lists, tables with and without a header row
- inline bold/italic/code/link nesting
- code blocks with and without a language class
- malformed HTML: unclosed tags, empty cells, deeply nested divs

## References

- `tests/unit/core/parsers/chatgpt.test.ts` — fixture + assertion style to match
- `src/core/services/conversation-structure-service.ts` — the caller, for realistic input shapes
