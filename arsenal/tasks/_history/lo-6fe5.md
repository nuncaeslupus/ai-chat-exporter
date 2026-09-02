---
id: lo-6fe5
title: "Model: no representation for generated video or audio (Gemini Create video / Create music)"
priority: 8
workspace: "EXPORTERS"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/99
---

## Acceptance gate

**Gate**: a message carrying a generated video and a generated audio clip round-trips
through parse → model → all six registered exporters, proven per format.

```bash
pnpm typecheck && pnpm test:run && pnpm build
```

## The gap

`MessageMetadata` (`src/core/types/conversation.ts`) has typed fields for
`images`, `artifacts`, `webSearches` and `research`. There is **nothing for video
or audio**.

Gemini's composer offers **Create image**, **Create video** and **Create music**
(observed 2026-07-28). Image output is representable; the other two are not, so
they will be dropped whatever the parser does. This is the case the
`parser-generator` skill calls out: when a widget carries information the model
cannot hold, extend the model rather than flattening it to text.

## Decide first, then build

Do **not** add three parallel one-off fields. Options, in rough order of
preference:

1. **A single `media` array** replacing/absorbing `images`, with a
   `kind: 'image' | 'video' | 'audio'` discriminator plus `src`, `alt`,
   `mimeType`, and optional `width`/`height`/`duration`. Cleanest, but `images`
   is read by several exporters and both parsers — migrate them in the same
   change or keep `images` as a deprecated alias.
2. Separate `videos` / `audio` arrays alongside `images`. Smaller diff, but a
   third and fourth place to forget.

Record which you chose and why in the PR.

## Rendering — every format, in the same change

The repo's recurring bug is a content type implemented in one format and missing
in five. Decide per format and state it:

- **html** — a real `<video>` / `<audio>` element, or a link? Note `docs/PRIVACY.md`
  documents that HTML/MD reference media by URL, so opening an export re-requests
  it from the provider. If these URLs are session-scoped they will 404 once
  signed out — say so in the docs rather than shipping a silently broken export.
- **pdf / docx** — no inline playback is possible. A poster frame plus a link, or
  a clearly-labelled placeholder. Do not emit nothing.
- **md / txt** — link with a label.
- **json** — raw fields.

Update `docs/PRIVACY.md` if the network behaviour of an exported file changes.

## Blocked on a human

Needs a Gemini capture containing a generated video and one containing generated
music, with the widget expanded:

```javascript
copy(document.querySelector('main').outerHTML)
```

into `tmp/examples/gemini-video.html` / `gemini-music.html` (gitignored). Derive
sanitized fixtures; never commit the capture.

## Tests

- Parser: the media element is extracted with its kind and src.
- One assertion per exporter that the media is represented.
- RED first — all should fail before the model change.

## Related

- `lo-f132` / `lo-2478` — the per-platform widget sweeps that will surface these.
- `lo-5970` — `metadata.research` is a field nothing renders; do not repeat that
  shape here.
