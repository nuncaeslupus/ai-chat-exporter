# Payload: a load-sensitive test blocks releases

## Acceptance gate

**Gate**: `pnpm test:run` passes while another `pnpm build` or test run is in
flight on the same machine.

```bash
pnpm test:run
```

## The defect

`tests/unit/core/exporters/pagination.test.ts > "never leaves a role label as the
last thing drawn on a page"` **times out** under concurrent load and passes in
isolation (measured: 2638 ms alone, timeout under load). It is the slowest of a
family — the pdf tests render real documents through jsPDF.

Six separate reports in the 2026-07-28/29 session, and it is not merely noise:
`release.sh done` re-runs the payload gate, so a flake there **refuses a release
for work that is actually green**. It did exactly that to `lo-3c90` while a
concurrent worker ran its own suite.

Two workers also reported single-test failures when `pnpm build` and
`pnpm test:run` ran together, which is the same underlying sensitivity.

## Fix direction

Raise the timeout for the heavy pdf/docx rendering tests rather than globally —
a global bump hides real hangs. `testTimeout` per file or per test in
`vitest.config.ts` is the smallest change. Consider whether these render-heavy
suites should also be excluded from parallel sharding.

Do **not** "fix" it by making the assertion weaker; the test is a good one and it
caught a real defect (a role label drawn below the bottom margin) when it was
written.

## Location

`vitest.config.ts`, `tests/unit/core/exporters/pagination.test.ts`.
