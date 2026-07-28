# Payload: the pdf image fallback loses the pointer

## Acceptance gate

**Gate**: when a pdf export cannot load an image, the placeholder still carries
the image URL.

```bash
pnpm lint && pnpm typecheck && pnpm test:run
```

## The defect

`src/core/exporters/pdf-exporter.ts:793` and `:875` render the image-load-failure
placeholder as `[Image: ${block.alt || block.url}]` — so when `alt` is present
the URL is dropped, and the reader is left with a caption and no way back to the
picture.

This is the same bug shape PR #113 just fixed in txt and docx, in a fallback path
instead of the happy path. The `lo-8e3d` worker found it and deliberately left it
rather than widen its diff.

The fix is the shape used everywhere else now: `[Image: alt] <url>`, one line in
two places. Verify the line numbers — they are from PR #113.

## Tests

A pdf export whose image fetch fails renders both the alt text and the URL.

## Location

`src/core/exporters/pdf-exporter.ts`.
