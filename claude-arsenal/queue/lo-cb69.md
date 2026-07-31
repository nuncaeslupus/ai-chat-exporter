# TEST-3: popup-states.test.ts flakes under a full suite run

Seeded 2026-07-31 after three independent workers hit it and two others could not
reproduce it. **A flaky test in the release gate is a guard that lies**, which is the
one thing this repo has already been bitten by six times — hence a task rather than a
shrug.

## Evidence

| observer | result |
|---|---|
| `lo-21e5` worker (D-30) | failed on a **first full `pnpm test:run`**, passed in isolation; called it pre-existing |
| `lo-58d3` worker (PAR-2) | failed under **`pnpm test:coverage`**, twice; `uiState` stuck at `'detecting'` instead of `'reload'`; passed 23/23 in isolation |
| `lo-2a39` worker (DOCS-1) | failed on the **first** full run, passed alone and on a clean re-run |
| orchestrator | ran the file standalone **3×: 23/23 every time** — could not reproduce |
| `lo-41b1` worker (D-39) | ran **`pnpm test:coverage` twice post-rebase: 1473/1473 both times** — could not reproduce |

So it is **not** reproducible in isolation and **not** deterministic under coverage
either. That pattern points at order- or resource-dependence — cross-file state bleed,
or a `vi.waitFor` whose timeout is marginal under parallel load — rather than a bug in
the assertion itself.

## The symptom

`uiState` is observed as `'detecting'` when the test expects `'reload'`. That is a
race between the popup's state machine settling and the assertion, not a wrong
expectation.

## What to do

1. **Reproduce it deliberately before changing anything.** Suggested angles, from the
   D-39 worker: run the full suite with `--no-file-parallelism` to test the
   cross-file-state hypothesis, and with `--reporter=verbose` to get file ordering.
   Repeat runs until it fires; do not conclude "fixed" from a single green run.
2. **Fix the cause, not the symptom.** Raising a `vi.waitFor` timeout until it stops
   failing is exactly the "suppression instead of root cause" move this project
   rejects. If the real cause is a marginal timeout, say so explicitly and justify the
   new value; if it is shared state between files, isolate it.
3. If it turns out to be genuinely unfixable timing, `retry` is acceptable ONLY with a
   comment naming what was measured and why.

## Acceptance gate

The full suite passes repeatedly, and the flake's cause is named in a comment or the
PR body — not merely unobserved once.

```bash
for i in 1 2 3; do pnpm test:run || exit 1; done && pnpm lint && pnpm typecheck
```

## Tests

- Whatever change lands must be justified by an observed failure first. Record the
  reproduction command that made it fail in the PR body, so the next person can
  re-check it.

## Location

`tests/unit/extension/popup/popup-states.test.ts` (note: `lo-41b1` / PR #232 added 42
lines to this file — read the current version).
