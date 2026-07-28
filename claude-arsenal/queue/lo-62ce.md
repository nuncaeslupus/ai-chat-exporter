# Payload: lo-62ce — UI chrome inside `.markdown` leaks into exported HTML

**Gate**: exported HTML from a ChatGPT conversation containing a table and a code
block contains no `<button>`, and no `<use href="/cdn/assets/sprites-...">` sprite
reference.

## The defect

`.markdown` contains ChatGPT's own action buttons — measured live 2026-07-28: 4
`<button>` inside one message ("Copy table", "Copy code").

Their `textContent` is empty (icon-only), so plain-text extraction looks clean and
the defect is invisible in every text-based assertion. But `htmlContent` is captured
as `clone.innerHTML` in `base-parser.ts`, so the buttons and their
`<svg><use href="/cdn/assets/sprites-core-<hash>.svg#<id>">` sprite references land
in exported HTML — dead icons pointing at an origin-relative CDN sprite that cannot
resolve from a saved file.

## Work

Strip interactive chrome during cleanup: `button`, `[role="button"]`, and sprite
`<use>` references. Assert on `htmlContent`, not only on text — that is precisely
why this survived.

Check the other parsers for the same pattern rather than fixing only ChatGPT; the
cleanup path is shared in `base-parser.ts`.

Read `docs/dev/parser-gotchas.md` §5.
