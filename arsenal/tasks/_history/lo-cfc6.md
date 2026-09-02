---
id: lo-cfc6
title: "P-8: ChatGPT platform logo renders black and is invisible on the popup's dark surface"
priority: 10
workspace: "UI"
tags: ["design"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/200
---

Author feedback 2026-07-31: **"ChatGPT logo should be in green, not black, or it
is not visible."**

## Confirmed cause

`src/assets/icons/chatgpt-logo.svg` declares **no `fill`** on its path, so it
defaults to black. The popup's dark scheme uses a near-black surface
(`--color-surface` ≈ `#141e1b` in dark), so a black mark vanishes.

Rendered at `.platform-icon` (15x15) in the conversation meta row —
`popup.html:149`, sourced from `PLATFORM_ICONS` in `popup.ts:86`.

## Green is the project's own token, not an invention

`src/core/exporters/style-tokens.ts` already defines
`COLOR.brand.chatgpt: '#10a37f'` — used for html's brand rule and pdf's role
label. Reuse that value; **do not pick a new green.** If the popup has no brand
token yet, add one that references the same value rather than duplicating the
literal.

## The technical catch

The logo is an `<img src="…svg">`. **CSS cannot recolour an `<img>`** — the SVG is
a separate document, so `fill`/`color` on the `<img>` does nothing. Pick one:

1. **Set the fill in the SVG file** — simplest. `#10a37f` reads acceptably on both
   the light and dark popup surfaces, so one value can serve both.
2. **`mask-image` + `background-color`** — lets CSS drive the colour per theme.
   Clean for a monochrome mark.
3. Inline the SVG into the DOM so `fill: currentColor` works — most code; only if
   1 and 2 fall short.

## Per-platform, and do NOT flatten multi-colour marks

Check each mark before touching it:
- **ChatGPT** — single monochrome path, safe to colour.
- **Claude** — check whether it is monochrome; if so treat it the same way, using
  `COLOR.brand.claude`.
- **Gemini** — `gemini-logo.svg` contains masks and gradients. It is a
  **multi-colour** mark: flattening it to a single colour would misrepresent the
  brand. **Leave it alone** unless it is genuinely monochrome.

Standing repo rule: platform marks come from the vendor's press kit and are never
approximated or redrawn. Recolouring a monochrome mark to the vendor's own accent
is fine; redrawing or flattening a multi-colour mark is not.

## Contrast

`tests/unit/accessibility/contrast.test.ts` is a real gate. A non-text graphic
needs **3:1** against its background. Verify `#10a37f` against the popup surface
in **both** schemes and report the measured ratios. If it fails in one scheme, use
route 2 and give that scheme a lighter/darker brand variant — the repo already has
precedent in `COLOR.brandTextOnLight`.

## Acceptance gate

The ChatGPT mark is visible in both colour schemes at 3:1 or better, is the
project's brand green, and no multi-colour mark was flattened.

```bash
pnpm test:run tests/unit/extension/popup/ tests/unit/accessibility/contrast.test.ts && pnpm lint && pnpm format:check && pnpm typecheck
```

## Verify visually
Build and look at it — a colour change is exactly what tests cannot judge:
```bash
pnpm build:chrome
cd dist/chrome && python3 -m http.server 8813
```
The meta row only renders in the ready state; reveal it by clearing `hidden` on
the state containers inside `#view-main`. (Do **not** stop the server with
`pkill -f` — it matches your own command line and kills your shell; use
`ss -lptn 'sport = :8813'`.)

## Location
`src/assets/icons/chatgpt-logo.svg`, `src/extension/popup/popup.css`,
`src/core/exporters/style-tokens.ts` (token reuse only — do not change exporter
behaviour).
