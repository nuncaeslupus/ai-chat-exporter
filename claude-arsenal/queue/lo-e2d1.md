# D-20: drift detection sweeps every selector on every parse

Introduced by `lo-0ac3` (PR #147), found by measuring after the feature landed.

## The measurement

`tests/unit/core/parsers/chatgpt.test.ts`, 101 tests, run in isolation on the
same machine:

| Commit | Time |
| --- | --- |
| `027db96` (immediately before the drift wiring) | **17 016 ms** |
| `9934b1b` (drift wiring merged) | **22 610 ms** |

About **+33%**, roughly +55 ms per parse. It already pushed
`ChatGPTParser > sets correct index for each pair` past the default 5 s timeout
under concurrent load — the same class of load-sensitivity that `lo-66fa` had to
paper over with a raised timeout, and that has refused a legitimate release
before.

## Why

`BaseParser.detectDriftUnsafe()` calls `checkSelectorHealth()` on **every**
parse, which runs `querySelectorAll` for every declared selector. The ChatGPT
parser declares ~25 `custom` selectors on top of the 5 mandatory ones, several
of them expensive (`[data-testid^="conversation-turn-"]`, escaped-class
selectors like `pre.overflow-visible\\!`). All of that runs on the happy path,
where the result is thrown away.

## The fix

Split the sweep by when its output is actually needed:

- **On the happy path**, check only `requiredSelectorKeys` (5 for Claude/Gemini,
  7 for ChatGPT). That is all `detectDriftUnsafe` reads to decide whether there
  is drift at all — it filters to `f.required && f.matched <= 0`.
- **Only when a report is being built** (a required selector missed, or a sanity
  rule fired), sweep the full set to populate `selectorFindings`, which is the
  only consumer of the optional entries.

This preserves behaviour exactly: `DriftReport.selectorFindings` still carries
every declared selector, and the optional entries still never trigger a finding
on their own. It just stops paying for them when there is no report.

Confirm with the same measurement before and after; the happy-path cost should
land close to the pre-drift baseline.

## Acceptance gate

The full drift suite and the parser suites still pass, and the ChatGPT parser
suite in isolation is measurably faster than 22 610 ms — the report contents
must not change.

```bash
pnpm vitest run tests/unit/core/drift/ tests/unit/core/parsers/ && pnpm typecheck && pnpm lint && pnpm format:check
```

## Tests

Existing drift tests must pass unchanged — in particular
`base-parser-drift.test.ts`'s assertion that a report carries the failing
selector, and `known-drift-cases.test.ts`. Add a test asserting that a healthy
parse still produces no report and that a report, when produced, still lists
optional selectors (so the lazy sweep is not silently dropping them).

## Location

`src/core/parsers/base-parser.ts` (`detectDriftUnsafe`),
`src/core/drift/selector-health.ts`
