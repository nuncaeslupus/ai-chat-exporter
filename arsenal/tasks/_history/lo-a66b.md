---
id: lo-a66b
title: "SD-2: leak-proof DOM skeleton builder"
priority: 9
deps: ["lo-64fa"]
tags: ["drift"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/145
---

Implement **Task 4** of [`docs/superpowers/plans/2026-07-29-selector-drift-detection-core.md`](docs/superpowers/plans/2026-07-29-selector-drift-detection-core.md) exactly as written. The plan
carries the full test code and implementation code for each step — follow it
step by step rather than improvising. Design rationale lives in
[`docs/superpowers/specs/2026-07-29-selector-drift-safety-net-design.md`](docs/superpowers/specs/2026-07-29-selector-drift-safety-net-design.md).

> **The safelist is the privacy guarantee — do not invert it.** Attribute
> values are excluded by default and safelisted *in*. Excluding a denylist is
> unsafe: `aria-label="Artifact panel: <conversation title>"` and
> `data-turn-id="<uuid>"` both carry identifying data, and the next such
> attribute is unknowable.

> **Never run `pnpm build` and `pnpm test:run` concurrently.** This repo has
> produced six false failure reports from exactly that, one of which blocked a
> legitimate release. Run them one after the other.


## Acceptance gate

The tests named below pass, `pnpm typecheck` is clean, and `pnpm lint` reports
no new errors.

```bash
pnpm vitest run tests/unit/core/drift/skeleton.test.ts && pnpm typecheck
```

## Tests

`tests/unit/core/drift/skeleton.test.ts` — 9 tests. **The leak property test
is the single most important test in this feature**: it seeds distinctive
strings into text nodes, `title`, `aria-label`, `alt`, `src` and a
`data-message-id`, builds a skeleton, and asserts none of them appear in the
output. It is the entire basis for telling users nothing but structure is
shared, and it is the invariant a future refactor could quietly break.

## Location

Create `src/core/drift/skeleton.ts`; extend `src/core/drift/index.ts` with
`buildSkeleton` and `SAFE_ATTR_VALUES`.
