# SD-9: wire drift behaviour in the popup

Implement **Task 6** of [`docs/superpowers/plans/2026-07-29-selector-drift-popup-surfaces.md`](docs/superpowers/plans/2026-07-29-selector-drift-popup-surfaces.md) exactly as written. The plan
carries the full test code and implementation code for each step — follow it
step by step rather than improvising. Design rationale lives in
[`docs/superpowers/specs/2026-07-29-selector-drift-safety-net-design.md`](docs/superpowers/specs/2026-07-29-selector-drift-safety-net-design.md).

> **The extension transmits nothing.** Both actions are clipboard writes;
> "Copy & report" additionally opens the tracker in a tab. No `fetch`, no relay,
> no server — and `docs/PRIVACY.md` must stay accurate **unchanged**. Do not
> edit it.
>
> The same `this.reportText` string must feed both the `<pre>` and the
> clipboard. That is what makes "you can see nothing else is sent" verifiable
> rather than a promise.

> **Never run `pnpm build` and `pnpm test:run` concurrently.** This repo has
> produced six false failure reports from exactly that, one of which blocked a
> legitimate release. Run them one after the other.


## Acceptance gate

The tests named below pass, `pnpm typecheck` is clean, and `pnpm lint` reports
no new errors.

```bash
pnpm vitest run tests/unit/extension/popup/ && pnpm typecheck && pnpm format:check
```

## Tests

`tests/unit/extension/popup/drift-behaviour.test.ts`. The plan seeds six
`it.todo` placeholders — **do not commit with any `it.todo` remaining.** Read
`tests/unit/extension/popup/popup.test.ts` for its `chrome` stub and DOM
bootstrap and write all six against that harness: the row appears for an
unsuppressed report, stays hidden for a suppressed one, the skeleton is
requested only when the view opens, Copy report keeps the popup open, a
clipboard failure shows `driftReportCopyFailed`, and either copy action
suppresses the fingerprint.

## Location

Modify `src/extension/popup/popup.ts`.
