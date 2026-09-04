---
id: lo-f1e6
title: "R11: scale the popup up — type scale tokens, wider box, taller body"
priority: 9
deps: ["lo-1789"]
workspace: "POPUP"
tags: ["redesign"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/121
---

Requested directly by the author, 2026-07-29: *"make fonts and popup larger"*.
The 5a design was drawn tight (360 px wide, 10.5–17 px type) and reads small on a
real screen.

## Acceptance gate

**Gate**: every popup font size comes from a type-scale token, the popup is
420 px wide with a 320 px body, and all six UI states plus all four views still
fit their box with no clipped text and no horizontal scroll.

```bash
pnpm lint && pnpm typecheck && pnpm test:run && pnpm build
```

## Why a scale, not 30 edits

R1 tokenised **colour** but left font sizes hardcoded in ~30 component rules, so
"a bit bigger" is currently a 30-line hunt. Fix the shape while satisfying the
request: put the type scale in `:root` the way the colour table already is, so the
next adjustment is one block.

## Numbers

Geometry — bump the tokens:

| token | from | to |
| --- | --- | --- |
| `--popup-width` | 360 | **420** |
| header height | 48 | **56** |
| body height | 260 | **320** |
| total | 310 | **378** |

Chrome's popup ceiling is 800 × 600, so 420 × 378 is comfortably inside it.

Type — scale **× 1.15**, rounded to the nearest 0.5 px, as a named scale:

| current | scaled | used by |
| --- | --- | --- |
| 10 | 11.5 | uppercase labels |
| 10.5 | 12 | version, privacy line, filename mono |
| 11 | 12.5 | numbers, summaries |
| 11.5 | 13 | pair text, row values |
| 12 | 14 | format rows |
| 12.5 | 14.5 | setting rows, header name |
| 13 | 15 | submenu titles |
| 14 | 16 | main button |
| 17 | 19.5 | conversation title |

Row heights, icons and paddings scale with the same 1.15 factor where they are
type-driven (38 px setting rows → 44, 31 px format rows → 36, 50 px buttons → 58);
leave hairlines, radii and the 1.5 px borders alone.

## The part that needs care

Several geometry facts were **measured**, not guessed, and they will move:

- R4's three bands sum to exactly 260.0 and its clamped question is exactly two
  lines (31.0 px at 11.5 × 1.35).
- R2 found the vertical budget only fits a one-line title, with ~6 px of scroll.
- R3 measured the format list at `scrollHeight` 197 vs `clientHeight` 154.
- R7 measured a constant 308 px across six states.

The taller body buys ~60 px, so re-measure rather than assume: R2's title clamp may
no longer need to be two lines, and R7's warning state may no longer need to hide
the setting rows (it hides them because `Retry` scrolled 99 px out of view). If a
constraint has genuinely lifted, say so in the outcome — do not silently keep a
workaround whose reason is gone.

Every test asserting 308 / 260 / 48 / 360 must be updated with the new measured
values, not deleted.

## Also

Record the new scale in `docs/design/popup-redesign.md` (§ Design Tokens and
§ Geometría global) so the remaining tasks build against it and it is not filed as
a divergence later. Contrast is unaffected — colours do not change — but larger
text means a few greys now sit in the ≥18 px large-text tier; do **not** relax any
value on that basis.

## Location

`src/extension/popup/popup.css`, `popup.html`, `popup.ts`,
`tests/unit/extension/popup/*`, `docs/design/popup-redesign.md`.

## Author correction (2026-07-29): the action bar is already big enough

Direct feedback: *"Button is big enough."*

**Do not scale the action bar.** The split export button and the print button keep
their current geometry and label size — 50 px tall, 42 px right half, 50×50 print,
16 px icon, and the 14 px button label stays 14 px. They are the one part of the
5a design that reads at the right size today.

Everything else in the table above still scales: the box, the header, the
conversation title, the setting rows, the submenu type, the pair list, the format
rows, the footers.

Practical consequence worth noticing: the action bar not growing gives the body
*more* slack than the +60 px the taller box already buys, so re-measure the
constraints listed above rather than assuming they merely shift.
