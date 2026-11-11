# Test cost — the default rules for what to test and what a test may cost

Load this when a task adds more than a handful of tests, when a new test takes
about a second or more, when a test needs a large fixture or a re-imported
module, when a module ships with no test file, or when reviewing the tests a
diff adds.

These are **defaults**. A project may override any of them by writing the reason
where the next reader will find it (a comment beside the test, a line in the
test config). Provenance: measured across several host repos with slow CI. None
was slow from having too many tests — deletable tests were 1–3% of test lines.
The time was in the patterns below, and in the other direction some large core
modules had no test at all.

## Owed — all code that can fail is tested

- Every module with branching, parsing, boundary or data-loss logic has a test
  file. **A core module with none is a finding**, however large the rest of the
  suite is.
- One test per **failure mode** — a branch, a boundary, an error path, anything
  that can lose or corrupt data or money. Not one per function or per diff line.
- Before writing a test, name the bug it would catch. If it can only fail when
  someone deliberately changes what it pins, it is a change detector.

## Not owed — do not write

| Kind | What it looks like | Instead |
|---|---|---|
| Prose test | Greps a README, doc, skill or changelog for wording, or polices a number written in a doc | A lint step outside the suite, or nothing. Derive the number from the source. |
| Gate re-measurement | Re-runs an acceptance gate, evidence or benchmark measurement (whole corpus, regenerate-and-diff) that a gate command or CI job already runs | Test the measuring function on a three-row input; the gate owns the full run. |
| Constant or glue | Pins a constant, format string, config value, getter, "is defined", or a layer that only forwards | Nothing. The caller's test covers it. |
| Duplicate | A second test of a path already pinned; N copies differing only in data | One table-driven (parametrized) or property test. |
| Implementation pin | Asserts internals or mocks so tightly that every refactor fails it and no behaviour bug does | Assert on what a caller can observe. |

## How — keep each test cheap

- **Expensive fixture once.** Import, parse, render, build or start it once per
  module or session (`scope="module"`/`"session"`, `beforeAll`) and share it
  with every test that only reads it. Rebuild per test only where the test
  mutates it, grouped apart. A module re-imported or a large capture re-parsed
  before every test was the largest single cost measured; a corpus rendered by
  several test files wants one shared cache, not one render per file.
- **Small input over real capture.** Hand-write a few rows; keep one test on the
  real capture, not every test.
- **Batch subprocess spawns.** One process that handles N inputs, not N fresh
  interpreters. Call the function in-process unless the process boundary is the
  thing under test.
- **Parallel by default.** Run the runner across the available cores (for
  example `pytest -n auto`, or the runner's worker setting). A test that breaks
  in parallel shares state it should not — fix that, do not serialise the suite.
- **Mark slow tests and keep them off every push.** A test slower than about a
  second carries a stated reason, or a slow marker (`@pytest.mark.slow`, a tag,
  a separate directory or target) that runs on the default branch, nightly, or
  when its paths change. Sleeping to wait is slow with no reason: inject the
  clock or the timeout.

**Fast-tier budget:** the tests that run on every push finish in about 60
seconds of wall time on the CI runner. A starting value — set the project's own
number in its test config, and treat exceeding it as the trigger to look, with
the runner's duration report (`pytest --durations=20`, a verbose or JSON
reporter), before pushing rather than after CI feels slow.

## Then the CI shape

Most measured cost was workflow shape, not tests. The CI defaults (one language
version and Linux only on pull requests, cancel superseded runs, a timeout per
job, nothing run twice) are in `claude-arsenal/references/ci-minutes.md`
§ CI defaults; with the bundle vendored, this prints what a repo's workflows miss:

```bash
python3 claude-arsenal/scripts/ci_shape.py
```

None of this is a licence to skip tests on logic that branches, parses or can
lose data, or to delete a test without saying what protection goes with it.
