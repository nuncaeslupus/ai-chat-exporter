# SD-4: format a drift report into the previewed and copied text

Implement **Task 1** of [`docs/superpowers/plans/2026-07-29-selector-drift-popup-surfaces.md`](docs/superpowers/plans/2026-07-29-selector-drift-popup-surfaces.md) exactly as written. The plan
carries the full test code and implementation code for each step — follow it
step by step rather than improvising. Design rationale lives in
[`docs/superpowers/specs/2026-07-29-selector-drift-safety-net-design.md`](docs/superpowers/specs/2026-07-29-selector-drift-safety-net-design.md).

> One function, on purpose. "The preview is byte-identical to what is copied"
> is only enforceable while there is exactly one place the text is produced.
> The report body is **English only** — it is a bug report with one reader, and
> a localised payload would be worse for that reader. No `getMessage()` here.

> **Never run `pnpm build` and `pnpm test:run` concurrently.** This repo has
> produced six false failure reports from exactly that, one of which blocked a
> legitimate release. Run them one after the other.


## Acceptance gate

The tests named below pass, `pnpm typecheck` is clean, and `pnpm lint` reports
no new errors.

```bash
pnpm vitest run tests/unit/core/drift/format-report.test.ts && pnpm typecheck && pnpm format:check
```

## Tests

`tests/unit/core/drift/format-report.test.ts` — 8 tests: the fingerprint
leads; only failing *required* selectors are listed as failures; the sanity
rules that fired appear; the build identity is present but **no user agent
string**; the **origin only**, never a full conversation URL; the skeleton
renders when present and says `(not available)` when absent; and the text is
English regardless of UI locale.

## Location

Create `src/core/drift/format-report.ts`; re-export from `src/core/drift/index.ts`.
