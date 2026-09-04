---
id: lo-64fa
title: "SD-1: drift detection primitives (types, fingerprint, selector health, output sanity)"
priority: 9
tags: ["drift"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/143
---

Implement **Tasks 1, 2 and 3** of [`docs/superpowers/plans/2026-07-29-selector-drift-detection-core.md`](docs/superpowers/plans/2026-07-29-selector-drift-detection-core.md) exactly as written. The plan
carries the full test code and implementation code for each step — follow it
step by step rather than improvising. Design rationale lives in
[`docs/superpowers/specs/2026-07-29-selector-drift-safety-net-design.md`](docs/superpowers/specs/2026-07-29-selector-drift-safety-net-design.md).

> **Never run `pnpm build` and `pnpm test:run` concurrently.** This repo has
> produced six false failure reports from exactly that, one of which blocked a
> legitimate release. Run them one after the other.


## Acceptance gate

The tests named below pass, `pnpm typecheck` is clean, and `pnpm lint` reports
no new errors.

```bash
pnpm vitest run tests/unit/core/drift/ && pnpm typecheck
```

## Tests

- `tests/unit/core/drift/fingerprint.test.ts` — 6 tests: stability, order-independence, divergence on selector set / rule set / platform / version, and shape.
- `tests/unit/core/drift/selector-health.test.ts` — 5 tests: a match count per declared selector, the required/optional split, zero matches on a dead selector, an invalid selector reported as -1 rather than thrown, and undeclared optional keys skipped.
- `tests/unit/core/drift/output-sanity.test.ts` — 9 tests. The one that matters most: **a legitimately terse answer (`"Yes."` from a 40-character turn) produces NO finding.** False positives are what kill safety nets, and an earlier draft of this rule fired under 20 characters.

## Location

Create `src/core/drift/types.ts`, `src/core/drift/fingerprint.ts`,
`src/core/drift/selector-health.ts`, `src/core/drift/output-sanity.ts`, and
`src/core/drift/index.ts` (the barrel — export what exists so far; SD-2 adds the
skeleton exports).
