---
id: lo-2d8a
title: "D-15: design spec's secondary text #6E7C77 fails the repo's own 4.5:1 contrast gate"
priority: 6
workspace: "POPUP"
tags: ["redesign"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/130
---

## Acceptance gate

**Gate**: `docs/design/popup-redesign.md` records the corrected secondary-text
value, and no popup token violates `tests/unit/accessibility/contrast.test.ts`.

```bash
pnpm lint && pnpm typecheck && pnpm test:run
```

## The divergence

Found by the R1 worker (`lo-c39f`, PR #107). The design handoff specifies
secondary text `#6E7C77`. Measured, it is **4.36:1** on white and **4.07:1** on
`#F4F8F6` — below the 4.5:1 floor `tests/unit/accessibility/contrast.test.ts`
already enforces in this repo.

R1 shipped `--color-text-secondary: #63716C` instead (4.5+ on every surface),
commented in place. The same worker flattened the header version label's
`rgba(255,255,255,.5)` to `#9FB3AD` (6.2:1) so the checker can resolve it.

## Why this is a task and not a footnote

Eight more redesign tasks read the same spec. Unless the document is corrected,
each one re-derives the conflict, and someone eventually "fixes" the token back
to the inaccessible value to match the doc.

## Work

1. Correct the token table in `docs/design/popup-redesign.md` §"Design Tokens",
   noting the measured ratios and that the repo enforces 4.5:1.
2. Sweep the remaining spec colours for the same problem — the tertiary greys
   (`#8A9691`, `#9AA5A1`) and the warning palette are the likely candidates —
   and correct them in the document with measured numbers.
3. If a colour is decorative rather than text (a dot, a rule), say so explicitly
   in the doc so nobody "fixes" it later.

Also unresolved in the spec, worth settling here: the `'error'` UI state is
listed in the state enum but **given no colour**. R1 shipped
`--color-danger: #B3261E` marked provisional.

## Location

`docs/design/popup-redesign.md`, `src/extension/popup/popup.css`.

## Additions from the dark-mode task (`lo-934c`, PR #128)

The same correction is now needed for § 7 (dark), not just the light table:

- § 7 specifies `#7C8C87` for tertiary text. Measured **4.27:1** on § 7's own
  raised surface `#1C2926` — below AA. Code ships `#849490` (4.75:1); the document
  still says otherwise.
- § 7 specifies **no dark amber/warning set at all**. PR #128 derived one by
  inverting the light pair and holding it to the same thresholds. It works, but it
  is an invention, not a design decision — it wants a designer's eye and then a
  line in the document.

Also record in the document that the exported HTML's dark mode is scoped to
`@media screen`, so a document is dark on screen and light on paper without a
separate print override.

Running tally for this task: **sixteen** spec colours have now been overridden for
failing the repo's 4.5:1 (or 3:1 non-text) gate, across the light and dark tables.
They are overwhelmingly light greys on light surfaces and their dark inversions —
which is the observation the correction should lead with, rather than sixteen
separate footnotes.
