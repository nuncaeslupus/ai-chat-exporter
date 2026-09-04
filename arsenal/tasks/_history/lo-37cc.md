---
id: lo-37cc
title: "R-1: shared type system — new scale, neutral ink, role label demoted, code token palette"
priority: 10
workspace: "EXPORTERS"
tags: ["redesign"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/160
---

Foundation for the whole redesign. Everything else in the `redesign` tag depends
on this. Spec: `docs/superpowers/specs/2026-07-29-exporters-redesign-design.md`,
Phase 1.

## Scope

`src/core/exporters/style-tokens.ts` only. Consumers keep compiling; they will
render at the new sizes immediately, which is expected and half-finished until
R-2..R-8 land.

| Token | Now | After |
| --- | --- | --- |
| body | 12 | 10.5 |
| code | 10 | 9 |
| meta / footers | 10 | 8.5 |
| role label | 15 (pdf), heading level 2 | 8.5, a label |
| body H1 | level 3 | level 2 |

- `FONT_SCALE_FACTOR` (0.8 / 1 / 1.25) is unchanged — it already yields the
  design's 8.4 / 10.5 / 13.1 from a 10.5 body. Do not touch it.
- Remove `DOC_HEADING_LEVEL.roleLabel`; `bodyHeadingLevel`'s offset drops +2 -> +1.
- Neutral ink replaces the Tailwind grey scale: headings `#14181A`, body
  `#33393C`, labels/footers `#6B7378`, rules `#E3E6E4`, turn fill `#F6F7F6`.
- Add the five code-token colours: keyword `#9C3F63`, function `#4C5FA8`,
  string `#12665A`, number `#8A5A1A`, comment `#8D9598`.
- Keep `COLOR.brand` values as they are.

## Acceptance gate

`style-tokens.test.ts` covers the new values and the changed heading offset;
the existing contrast test still passes against the new ink.

```bash
pnpm test:run tests/unit/core/exporters/style-tokens.test.ts tests/unit/core/exporters/heading-levels.test.ts tests/unit/accessibility/contrast.test.ts
```

## Tests
`tests/unit/core/exporters/style-tokens.test.ts` (exists — extend).

## Location
`src/core/exporters/style-tokens.ts`
