---
id: lo-7aca
title: "P-6: popup spacing round 3 — chevron gaps both sides, action-bar insets, back-arrow alignment, tighter label-to-control grouping"
priority: 10
workspace: "UI"
tags: ["design"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/195
---

Author feedback 2026-07-31, after P-5 (#193) landed `--pad-x: 26px`,
`--popup-width: 436px`, `--body-height: 340px`, `--chevron-inset: 14px`,
`--space-tight: 8px`, `--space-loose: 16px`.

Verdict: **"it's better, but…"** — five specific items remain. Treat these as
refinements of P-5's token system; **change the tokens, do not reintroduce
hardcoded values**.

## 1. Row chevrons need space on BOTH sides

> "arrows in menu items like 'Options' are still too close to the right border
> AND to its left text."

P-5 set `--chevron-inset: 14px` (chevron sits 40px from the popup edge). Still
too tight on the right — **and** the row's label now crowds the chevron on the
left. So the chevron needs a bigger right inset *and* a guaranteed minimum gap
between the label text and the chevron. If the label can grow long enough to
collide, that gap must be enforced (e.g. the label flexes/truncates while the
chevron keeps its reserved space) rather than left to chance.

## 2. Export and Print buttons are too close to the popup borders

> "Export and Print buttons are too close to the popup borders."

The action bar's buttons sit too near the left/right edges. They should respect
the same horizontal rhythm as everything else — align to `--pad-x` (or more), not
a smaller inset of their own.

## 3. The back arrow should move left

> "I'd prefer the back arrow in this image more to the left, it looks weird being
> more to the right than the text below."

In the pair-chooser (`Elegir pares`) header, the back chevron currently sits
**further right than the row text beneath it**, which reads as broken alignment.
Move it left so the header reads as the outermost element — align it with the
content column's left edge (or the `--pad-x` edge), never inside it. Check the
same header treatment in **every** submenu that has a back arrow, not just the
pair chooser.

## 4. A label and its control must read as ONE setting

> "in Options, 'Tamaño del texto' looks like an option and 'Compacto', 'Normal'
> and 'Grande' another one. Put both lines closer. Same for Theme config."

This is P-5's grouping intent not going far enough. The legend→control gap is
still large enough to read as a separator. **Tighten the within-setting gap
(`--space-tight`) and/or widen the between-setting gap (`--space-loose`)** so the
ratio unambiguously groups label with control. Applies to **both**:
- Options → "Tamaño del texto" + its three choice pills
- Settings/gear → the Theme (light/dark/auto) label + its control

## 5. Pre-existing, fix while you are here: the choice pills wrap 2+1

Measured on P-5's build: `.option-choices` is 356px wide; the three pills total
476.8px plus 28px of gaps = **492.8px needed**, so they wrap onto two lines
(2 pills then 1). **Not caused by P-5** — the pre-P-5 layout had 384px available
and would also have wrapped — but it looks unbalanced and contributes to item 4's
"two separate options" impression.

Fix it deliberately, and say which you chose: let that row span the full content
width outside the 28px alignment indent, shorten the labels, or use a segmented
control. Do **not** shrink the text below the popup's type scale.

## Binding constraints (unchanged from P-5)

- **The box must not change size between states.** Every view — main, Contenido,
  Opciones, Nombre del archivo, settings/gear, drift report, and the secondary
  states (detecting, no selection, warning, unsupported, reload) — fits ONE fixed
  box. Growing it is allowed; varying it per view is not. **Check the tall ones**
  (pair chooser, drift report) for clipping.
- Work at the tokens. Scattered pixel values are why this is round 3.
- All eight scroll areas keep P-3's slim tokenized scrollbar.
- Colours stay tokenized; `tests/unit/accessibility/contrast.test.ts` is a gate.

## Verify visually — the tests cannot see spacing

```bash
pnpm build:chrome
```
Then serve `dist/chrome` and inspect with `getComputedStyle` /
`getBoundingClientRect` in a real browser, in **both** colour schemes. Report the
final token values and the measured chevron gaps (left and right), action-bar
insets, back-arrow x-position vs the content column, and the label→control gap vs
the between-setting gap.

Known limitation: the popup opens in "detecting" state and main-view rows do not
render without the Chrome APIs — toggle views one at a time, and note that forcing
several visible at once distorts measurements.

## Acceptance gate

Every view fits one fixed box, no horizontal overflow; each label reads as grouped
with its own control; chevrons have visible space on both sides; the back arrow is
no further right than the content beneath it.

```bash
pnpm test:run tests/unit/extension/popup/ tests/unit/accessibility/contrast.test.ts
```

Visual change — do **not** invent brittle pixel assertions.

## Location
`src/extension/popup/popup.css`, and `popup.html` if markup blocks the alignment.
