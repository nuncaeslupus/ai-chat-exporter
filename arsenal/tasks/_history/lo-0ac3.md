---
id: lo-0ac3
title: "SD-3: attach DriftReport to ParseResult in BaseParser"
priority: 9
deps: ["lo-64fa", "lo-a66b"]
tags: ["drift"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/147
---

Implement **Tasks 5 and 6** of [`docs/superpowers/plans/2026-07-29-selector-drift-detection-core.md`](docs/superpowers/plans/2026-07-29-selector-drift-detection-core.md) exactly as written. The plan
carries the full test code and implementation code for each step — follow it
step by step rather than improvising. Design rationale lives in
[`docs/superpowers/specs/2026-07-29-selector-drift-safety-net-design.md`](docs/superpowers/specs/2026-07-29-selector-drift-safety-net-design.md).

> **The safety net must never break an export.** `detectDrift` wraps
> `detectDriftUnsafe` in a try/catch that degrades to `undefined`. Committed
> fixtures use invented prose — never captured conversation text.

> **Never run `pnpm build` and `pnpm test:run` concurrently.** This repo has
> produced six false failure reports from exactly that, one of which blocked a
> legitimate release. Run them one after the other.


## Acceptance gate

The tests named below pass, `pnpm typecheck` is clean, and `pnpm lint` reports
no new errors.

```bash
pnpm vitest run tests/unit/core/ && pnpm typecheck
```

## Tests

- `tests/unit/core/drift/base-parser-drift.test.ts` — 5 tests: a healthy parse attaches **no** report; a dead required selector attaches one; a firing sanity rule attaches one; the report carries a fingerprint, platform and ISO date; and **a throwing detector still yields a successful export.**
- `tests/unit/core/drift/known-drift-cases.test.ts` — 4 tests reproducing the three real 2026-07 cases (Claude's container class change, Gemini's dead title selector, ChatGPT Deep Research extracting the `ChatGPT said:` label) plus "an absent optional widget is not drift".
- The existing parser suites must still pass unchanged.

## Location

Modify `src/core/types/parser.ts` (add `drift?: DriftReport`),
`src/core/parsers/base-parser.ts` (`parse()` plus the new protected members),
`src/core/parsers/chatgpt/parser.ts` and `src/core/parsers/claude/parser.ts`.
Gemini needs no override.
