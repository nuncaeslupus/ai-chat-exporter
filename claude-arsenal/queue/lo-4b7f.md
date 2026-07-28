# Payload: lo-4b7f — PDF export never returns on an SVG artifact

## Acceptance gate

**Gate**: exporting `tests/fixtures/dom-snapshots/chatgpt/comprehensive.html` to PDF
completes; the bounded-`Promise.race` reproduction in

Prose-only gate — verified by worker judgment, no script to run.

`tests/integration/fixture-to-parser-to-exporter.test.ts` is converted into a
plain assertion that `export()` resolves.

## The defect

Found by the `lo-c393` integration suite (PR #24) — invisible to every existing
test because `PdfExporter` had **zero** coverage.

`ChatGPTParser.extractImages()` scans the whole assistant turn for `<img>` tags,
so it also picks up the decorative inline preview
`<img src="data:image/svg+xml,…">` that lives inside an SVG artifact's code
panel, and files it in `message.metadata.images` as if it were a real
conversation image.

`PdfExporter` → `loadImagesParallel` → `loadImageAsDataUrl` then does
`new Image(); img.onload = …; img.src = url`. For that data URI the promise
**never settles** — no `onload`, no `onerror` — so `export()` never returns. The
user clicks Export to PDF and nothing happens, forever, with no error.

Confirmed: stripping that one field from the real parser output makes the export
succeed.

## Two things to fix — decide the scope deliberately

1. **The misclassification** (root cause): artifact-internal images should not
   land in `metadata.images`. This is the same confusion underlying `lo-45b2`
   (artifacts rendered twice) — read that payload before implementing, and say
   whether the two should be fixed together.
2. **The unbounded wait** (defence in depth): `loadImageAsDataUrl` should time
   out and skip an image that never decodes, rather than hanging the whole
   export. Even with (1) fixed, any future undecodable image reproduces the
   hang. Pair this with the error surface `lo-2086` added so a skipped image is
   visible rather than silent.

Do both unless you find a reason not to — (1) alone leaves the trap armed, (2)
alone leaves the wrong data flowing through every other exporter.

## Context

`lo-c393` documented the hang with a bounded `Promise.race` so CI does not hang.
Converting that to a direct assertion is part of this task's gate.
