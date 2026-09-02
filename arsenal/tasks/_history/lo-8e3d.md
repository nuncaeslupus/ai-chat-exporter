---
id: lo-8e3d
title: "Close the matrix gaps: image URL dropped in txt/docx, linkUrl unread, media duration unrendered"
priority: 7
workspace: "EXPORTERS"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/113
---

## Acceptance gate

**Gate**: no image or media field is captured by the parser and rendered by no
format. Proven per format.

```bash
pnpm lint && pnpm typecheck && pnpm test:run && pnpm build
```

## Source

The block-type × exporter matrix built in `lo-23fb` (PR #112). Three gaps, all in
the same switch statements, ordered by damage:

1. **Image URLs are dropped in txt and docx.** Both emit `[Image: alt]` and
   discard `block.url`, so a txt or docx export loses every picture with no
   pointer left to it. The `media` case in the *same switch* already does it
   right (`[Video: alt] <url>`) — apply that precedent.
   `txt-exporter.ts:233`, `docx-exporter.ts:448`.
2. **`ImageBlock.linkUrl` is written and never read.** `html-content-parser.ts:125`
   populates it; no exporter references it. **Decide**: render it (html at
   minimum) or delete the field. A field nothing reads is worse than no field —
   the same call `lo-5970` had to make.
3. **`MediaBlock.duration` is captured and rendered by nobody.** `mediaLabel()`
   (`base-exporter.ts:179`) ignores it; appending `(2:14)` there fixes all six
   formats at once, the shape PR #110 established.

Line numbers are from PR #112 — verify, don't trust.

## Tests

One per format per gap. For (2), whichever way you decide, the test locks it:
rendered → assert it appears; deleted → assert the parser no longer produces it.

## Location

`src/core/exporters/txt-exporter.ts`, `docx-exporter.ts`, `base-exporter.ts`,
`html-exporter.ts`, `src/core/services/html-content-parser.ts`,
`src/core/types/structured-content.ts`.
