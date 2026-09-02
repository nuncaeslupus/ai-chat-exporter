---
id: lo-0fe9
title: "D-27: vitest 4 drops coverage.all, so untested files vanish from the report instead of diluting it"
priority: 5
deps: ["lo-5373"]
workspace: "TESTING"
tags: ["tooling"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/189
---

Found while upgrading vitest 3.2.4 -> 4.1.10 (`lo-5373`, PR #185). Measured by
A/B-ing both versions against identical config, not inferred.

**What the spec requires:** the coverage floor is a gate. A source file with no
tests at all should make the number worse.

**What changed:** vitest 4 removed `coverage.all`, which defaulted to `true` in
v3 and pulled every `coverage.include`-matched file into the report even when no
test imported it.

| | files reported | files at 0% | aggregate |
| --- | --- | --- | --- |
| vitest 3.2.4 | 47 | 3 | ~86.6% |
| vitest 4.1.10 | 28 | 0 | ~84.7% |

Files never imported by any test now simply **do not appear**, rather than
appearing at 0% and dragging the aggregate down.

**Setting `all: true` explicitly does not restore it** — verified inert in the
shipped `@vitest/coverage-v8@4.1.10`, not merely untyped.

**Why it matters:** a brand-new source file with zero tests can no longer be
caught by the floor through dilution. The floor still works for code that IS
imported, and it still genuinely fails when violated (that was re-verified in
#185 by raising the thresholds to 99.9% and confirming a non-zero exit). But the
"someone added an untested module" signal is gone. This is the same
signal-erosion class as D-24 and D-25.

Also: the "measured on main" comments in `vitest.config.ts` now describe numbers
that are no longer what is measured. They will mislead the next reader.

**This is a policy call for the owner, not just a fix.** Options, roughly in
order of directness:

1. Add an explicit check that every file under `src/` is imported by at least one
   test — catches the exact regression the floor used to catch, and is
   independent of the coverage provider's behaviour.
2. Recalibrate the four thresholds to the v4 baseline so the floor is meaningful
   against what v4 actually reports.
3. Accept the change and correct the stale comments only.

Do not silently pick 3 — say which was chosen and why.

## Acceptance gate

Either an untested new file under `src/` fails a gate, or the thresholds and the
`vitest.config.ts` comments match what vitest 4 actually measures.

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test:run
```

## Tests
If option 1 is taken, that check IS the test — and it must be proven to fail by
temporarily adding an unimported file under `src/`, then removing it.

## Location
`vitest.config.ts`, plus a possible new check under `tests/`.

---

## OWNER DECISION 2026-07-30 — take BOTH option 1 and option 2

Do the import check **and** recalibrate the thresholds. Option 3 (comments only)
is explicitly rejected.

**Measured blast radius for option 1 (2026-07-30, `main` @ `c357de3`):** of 56
`.ts` files under `src/` (excluding `*.generated.ts` and `*.d.ts`), only **2** are
never named in any test file — `src/core/exporters/artifact-content.ts` and
`src/core/exporters/base-exporter.ts`. Both are genuinely exercised
**transitively**: `base-exporter.ts` through its subclasses, and
`artifact-content.ts` through the exporters that import `isProseArtifact`.

So make the check **transitive-import reachability**, not "named directly in a
test file" — a direct-name check produces exactly those 2 false positives. Walk
the import graph from the test files and assert every `src/**/*.ts` is reachable.
Expect **zero** violations today; if you find more than the 2 above, investigate
rather than adding exclusions.

Prove the check is not vacuous: temporarily add an unimported file under `src/`,
confirm the check FAILS, then remove it. Say in the PR that you did this — an
unproven guard is the same defect class this task exists to fix.

**For option 2**, measure the real v4 numbers first (`pnpm test:coverage`) and set
each of the four floors just under the measured value, so the floor is meaningful
without being brittle. Current floors are 40/58/73/40, which were calibrated
against vitest 3's larger denominator (47 files) and are now far below what v4
actually reports (~84.7% statements over 28 files). State the before/after floor
values and the measured values in the PR.

Also fix the stale `// measured on main` comments in `vitest.config.ts` — they
describe a denominator that no longer exists.
