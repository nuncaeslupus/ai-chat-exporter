# Performance tuning — reading the timings, and what each shape means

Load this when the loop feels slow: a gate that takes long enough that someone
is tempted to skip it, a review that runs more rounds than the change deserves,
or a task-to-PR cycle nobody can account for.

`bin/_timing.sh` records where the time goes; this file says which remedy the
number points to, and holds the ones for a slow gate and a slow review round.

## Contents

- [Get the numbers first](#get-the-numbers-first) — the report, and what it is reading
- [Read the table in this order](#read-the-table-in-this-order) — total, then p95, then n
- [The shapes, and where the remedy is written](#the-shapes-and-where-the-remedy-is-written)
- [Phases: reading an `a:b` row](#phases-reading-an-ab-row) — what is inside a boundary, and recording your own
- [What these numbers cannot tell you](#what-these-numbers-cannot-tell-you) — and how to get the rest
- [Making the gate faster](#making-the-gate-faster) — parallel tests, the long pole, spawn-bound suites, caching inputs, cheaper tests, not adding tests the suite has to carry
- [Time from PR to merge](#time-from-pr-to-merge) — what a change waits for, measured, and what cut it
- [Making a review round cheaper](#making-a-review-round-cheaper) — recording checks already run, scoping mutation runs
- [Tuning knobs](#tuning-knobs) — every `ARSENAL_*` / `LOOP_*` env var the worker loop reads

---

## Get the numbers first

```bash
python3 claude-arsenal/scripts/arsenal_timings.py
```

`--days N` narrows the window (default 30); `--days 0` reads everything the
file still holds. If the host repo's Makefile wires a `timings` target at that
script, `make timings` is the same thing.

Collection is always on and costs a few milliseconds per boundary. Four bundle
scripts write it — `gate_run.sh`, `open_task_pr.sh`, `adversarial_review.sh`,
`merge_ready.sh` — appending one tab-separated row each to
`tmp/arsenal-metrics/metrics.tsv`: a timestamp, an event name, a label, a
duration, an exit code, a task id. No paths, no file contents, no diff. The
directory carries a `*` .gitignore, so the file is never committed, and nothing
is ever uploaded anywhere.

There is one file per repo, in the **main** checkout: a worker running in a
throwaway worktree appends to it too, so a fleet's numbers survive the worktree
being torn down and the report covers all of them at once.

Reading is on demand — this script, run by a person with a question. Nothing
enters a context window until then, which is the point: the data has to already
exist when the problem appears, because that is exactly when you cannot go back
and collect it.

`ARSENAL_METRICS=off` in the environment stops collection entirely.
`ARSENAL_METRICS_MAX_LINES` (default 5000) bounds the file.

## Read the table in this order

**Total, before p95.** The rows are ordered by total time for a reason: a
90-second step that runs once a day is not the bottleneck that a 9-second one
running 200 times is. Optimising the slow-looking row is how a day disappears
into something nobody was waiting on.

**Then p95, against p50.** p50 is what a run costs; p95 is what the loop feels,
because the tail is what a person sits through. Close together means the step
has one speed and the remedy is to make that speed lower. Far apart means some
runs are doing something the others are not — and `slowest single runs` at the
bottom of the report names which ones, so there is a concrete thing to go and
look at rather than a distribution to reason about.

**Then n.** A high count is the multiplier, and it is often the real finding:
`review rounds per change` is printed separately for exactly that reason.

## The shapes, and where the remedy is written

| What the report shows | What it means | Read |
|---|---|---|
| `gate` total dominates, n is high | The gate is fine; it is being run too often | `references/evidence-gates.md` § How often to run the whole gate |
| `gate` p95 high, n low, one suite obviously the long pole | A single file or suite is setting the floor | § The long pole, below |
| `gate` barely moved after parallelising | The suite is process-spawn-bound, not CPU-bound — more workers cannot help | § When parallelism is not the lever, below |
| `gate` slow and one suite is a KDF / crypto / deliberately-slow check | Some of that cost is the point, and dropping it drops the thing being tested | § When parallelism is not the lever, below |
| `review-round` p50 high | Each round is re-running checks the session already ran | § Making a review round cheaper, below |
| `review rounds per change` median > 1 | The round count, not the round cost, is the bill | `references/pre-pr-review.md` § Rounds |
| `merge-ready` n very high | The loop is waiting on CI, not on anything local | `references/github-automation.md` § Merge policy |
| `task-pr` total far exceeds its parts | The time is between the boundaries, not inside them | § What these numbers cannot tell you, below |
| One `task-pr:<phase>` row is most of the `task-pr` row | That phase is the bill, and the rest of the loop is noise beside it | The section that owns the phase — `host-gate` and `task-gate` → § Making the gate faster; `review` → `references/pre-pr-review.md` |
| A gate step sweeps many modules, one process each | Interpreter startup is being paid once per module, and parallelism cannot reach it | § When parallelism is not the lever, below |
| `review-round` p50 high and the reviewer re-runs the whole suite per mutation | The suite's scope during the mutate-restore cycle, not the round count | § Making a review round cheaper, below |

A row with a non-zero `fail` count is worth reading before any of this. A gate
that fails fast and gets re-run is cheap per call and expensive per change, and
the timing table shows it as a fast step rather than as the problem it is.

## Phases: reading an `a:b` row

A row named `a:b` is a **phase inside** `a`, not time on top of it. The phases
under a parent are contiguous and sum to it, so `task-pr` 13m26s with a
`task-pr:host-gate` of 13m25s is one thirteen-minute wait whose cause is now
named — not two.

`open_task_pr.sh` reports ten: `review`, `task-gate`, `fetch`, `issue`,
`branch`, `archive`, `host-gate`, `commit`, `push`, `pr`. Whichever one was
running when a refused run exited carries its non-zero exit code, so the `fail`
column says *where* the loop stops, not only that it did.

A `--preflight` run records under `preflight`, not `task-pr`, and reports the
subset it actually runs — `review`, `task-gate`, `fetch`, `issue`, `archive`,
`gate-check`. Keeping it a separate event is what stops a question, which stops
before the expensive half by design, from pulling down the p50 of the runs that
open a PR.

**A host can record its own sub-targets the same way.** `host-gate` is the
host's command, and this bundle cannot know it is four make targets — so a
Makefile that wants the breakdown writes it, through the same entry point and
into the same file:

```bash
source claude-arsenal/bin/_timing.sh
s=$(date +%s); make test; rc=$?; e=$(date +%s)
arsenal_timing_record host-gate:test "" "$(( (e - s) * 1000 ))" "${rc}"
```

`host-gate:test` then appears in the table beside everything else. That is the
difference between a report that says the gate is slow and one that says which
target inside it is — and it is the part nobody should have to hand-instrument
twice.

## What these numbers cannot tell you

**There is no per-suite breakdown, unless you record one.** A gate block is one
command from the bundle's side: `gate_run.sh` measures the block, not the suites
inside it, and it cannot see into a `make test` that runs three of them. If the
table says the gate is the bottleneck and you need to know which suite, record
them yourself — § Phases above is the entry point, and the answer is one run
away.

**Time outside a bundle script is unmeasured.** Reading files, writing the
change, thinking: none of it runs through a boundary arsenal owns, so none of it
appears here. A `task-pr` row much larger than the `gate` and `review-round`
rows under the same task id is that gap, and it is not evidence of a slow gate.
The phases narrow it to what happens inside one script; they say nothing about
the session that ran before it.

**Nothing is comparable across repos.** The file is local, per-repo, and stays
that way. A p95 here means something about this machine and this suite, and
nothing at all about anybody else's.

## Making the gate faster

A slow gate costs more than its own runtime: up to `ARSENAL_MAX_WORKERS` workers
(default 2) each run their own `host-gate`. Before tuning, check how often the
whole gate runs; running it once before the PR is usually the larger saving
(`references/evidence-gates.md` § How often to run the whole gate). Tuning must
not change what the gate certifies.

### Parallel tests

Run the full-suite target in parallel (`pytest-xdist`'s `-n auto`, or the
runner's equivalent). Where each flag goes matters:

- **`-n auto` belongs in the Makefile's `test` recipe, not in `addopts`.**
  `addopts` applies to every invocation, including single-file gate calls such
  as `pytest tests/test_x.py`, which would then start a worker per core for one
  file.
- **`--dist loadfile` belongs in `addopts`.** It is inert without `-n`, so a
  single-file run is unchanged, and invocations that bypass the recipe still
  get it.

On one measured suite this was 3x-5x faster. Expect it to expose real
shared-state races between tests that never overlapped serially, such as two
tests reading the live tree's untracked files; fix those rather than turning
parallelism off.

### The long pole

With `loadfile`, every test in a file goes to one worker, so the suite can never
finish faster than its slowest file, however many workers run. Measure per-file
totals before splitting, since the long pole is rarely the suspected file:

```bash
pytest --durations=25          # slowest individual tests
pytest --collect-only -q       # what is in the suspect file
```

Split it into sibling files along existing seams (per class, subsystem or
fixture):

- **Split along the expensive fixture boundary, not across it.** If a file's
  setup costs `F` and its tests `T`, splitting it over `k` workers costs roughly
  `F + T/k` each, with every worker paying `F` again. When `F` dominates,
  splitting buys almost nothing; make `F` cheaper or share it instead.
- **Give a test that is slow by nature (network, build, long simulation) its own
  file**, so it starts early instead of trailing a queue of fast ones.

`--dist load` schedules per test and removes the file floor, but breaks module-
and class-scoped fixtures; use it only for a suite known to have none. Other
runners that schedule per file behave the same way.

### When parallelism is not the lever

`-n auto` helps a CPU-bound suite. The diagnostic for the other shapes is one
measurement: raise the worker count and re-time. Flat means more workers will
not help.

- **Process-spawn-bound suites** (a hook harness, CLI integration tests, one
  shell per case) are limited by how fast the OS starts processes; on one suite,
  spawns per second stayed flat from 8 workers to 32. The lever is the number of
  spawns or how often the suite runs. Collapsing the per-case spawn usually
  trades away fidelity, because that spawn is how the code runs in production;
  say which one you chose.
- **One process per module** (a sweep looping over `python -m <module>`) pays
  interpreter startup each time; on five modules that was 6.2s against 2.2s in
  one process. Run the sweep in one process that imports and calls each module,
  and keep the per-module command for running one by hand.
- **Deliberately slow work** (key derivation, password hashing, envelope
  encryption) is slow on purpose. Keep one test at production parameters that
  asserts the real constants, and run the rest on a shared derived-key fixture
  or reduced cost factors. Lowering the cost everywhere removes the test that
  would notice a weakened production parameter.

### Caching inputs

The gate never caches outcomes (`references/evidence-gates.md` § How often to
run the whole gate). Inputs are safe to cache, in two kinds:

- **Immutable inputs** (resolved dependencies, virtualenvs, compiled extensions,
  Docker layers, a built bundle) do not change while the suite runs. Cache them
  keyed on a content hash of what produced them, such as a lockfile digest, never
  on a branch name or date: a wrong content key costs a miss, a wrong lifetime key
  serves stale data. Dependency install is often the larger half of a gate's
  clock.
- **Inputs derived from the tree under test** (an untracked-file listing, a
  `git status` read, a source-tree scan) are worth computing once and sharing,
  but they are mutable and are the thing under test. Cache one for the session
  only when nothing in the suite writes into the tree; otherwise key it on a tree
  digest so a mutation recomputes it instead of serving a stale read.

Under `pytest-xdist`, a `session`-scoped fixture runs once **per worker**, not
once per run, so size the saving accordingly.

### Making the tests themselves cheaper

Measure first: `pytest --durations=0`, summed **per file**, since under
`loadfile` the slowest file is the floor. On one suite a single test was a fifth
of all test time. The repeated fixes, in the order they paid:

- **Reuse the product's own selection.** A test that rebuilds by hand the list a
  driver runs (modules, connectors, fixtures) drifts from it, and can include the
  driver itself, so everything runs twice. Import the product's discovery
  function instead; that also covers what is added later.
- **Memoise pure helpers per test module.** When many tests parse or scan the
  same immutable input, wrap the pure helper in `functools.cache` with a
  module-scoped `monkeypatch`. Never cache inside a test that measures time or
  counts calls; that test is about the uncached path.
- **One end-to-end pipeline test, not several.** A test that regenerates the
  whole pipeline in subprocesses (every artefact, twice, to diff the result) can
  outweigh the rest of its file. Keep one, run its independent steps in
  parallel, and assert finer properties on the cheap unit seams.
- **An exhaustive sweep states its cost.** Iterating over a whole space (every
  code point, every combination) is worth it when the property cannot be
  sampled. Note its runtime beside it, keep the per-item work minimal, and
  prefer a derived representative set when the space has a known structure.
- **Regenerate only what the test reads.** A test that rebuilds every
  generated artefact before checking one of them pays for all of them. Rebuild
  only the inputs it reads; on one suite that took a file from 47 s to 15 s.
- **Rank files serially.** Per-file times taken under parallel workers include
  CPU contention and overstate each file's cost. Rank with one worker (`-n0`),
  then confirm the saving under the real worker count.
- **Leave a test alone when its cost is the product's own measurement.** A
  timing, a corpus pass or a benchmark that the product ships is the thing
  being tested; shrinking it tests something else.
- **Run locally on the interpreter CI runs.** A newer standard library can
  change behaviour (one suite failed fifteen tests on a newer minor version),
  and the time goes on chasing differences CI never sees.

### Not adding tests the suite has to carry forever

Every test is paid for on every run, by every worker, for the life of the repo.
A test earns its place by catching a product regression no existing test
catches.

- **One test per behaviour, not per finding.** Answer a review finding by fixing
  the code and pinning that behaviour once. A new case for each finding
  enumerates instances and never reaches the last one; a closed rule (derive the
  cases from the type, the grammar or the spec's own production) replaces the
  list.
- **No tests whose subject is the process.** Tests about the repository's own
  gates, naming, evidence keys or review mechanics, rather than the product,
  grow with every process change and catch nothing a user would see. Propose one
  to the owner before writing it.
- **Check for an existing pin before adding one.** If a deliberate revert of the
  fix already turns a test red, a second test for the same line adds runtime and
  nothing else.
- **Scope runs while editing.** Run the touched module's tests during the edit
  loop and leave the full suite to CI; the full suite once per push is enough.

## Time from PR to merge

The wall time a change waits is mostly process, not CI. Measured on one
consumer repo, median time from opening a PR to its merge:

| period | PRs | median |
|---|---|---|
| local full gate before every push, merge parked for a later event | 17 | 54 min |
| CI as the only gate, scoped local checks, merge on green | 7 | 9 min |
| same, after the suite went from 202 s to 131 s wall time | 10 | 5 min |

What moved it, largest first:

- **One gate, and it is CI.** A local run of the full gate before each push
  repeats what CI runs on the merged tree anyway. Run scoped checks locally
  (lint and type-check on changed files, the touched module's tests) and let
  CI be the evidence.
- **Merge on green without waiting.** Enable auto-merge or merge as soon as the
  conditions hold; parking a ready PR for a later wake-up costs more than any
  test.
- **Cap review rounds.** Past the second round, file non-security findings as a
  follow-up task and merge.
- **A cheaper suite** (above): with the process cost gone, CI time becomes most
  of what remains, so the test work then shows up directly in merge time.

## Making a review round cheaper

A reviewer that takes "a confident claim you have not checked is worse than
silence" seriously runs things, and should. Left alone it also re-runs the lint
and tests the author ran minutes earlier on the same tree. Record those instead:

```bash
bash claude-arsenal/bin/adversarial_review.sh emit --checks tmp/checks.md
```

The packet renders the file as its own fenced section, tells the reviewer the
results are recorded so it need not re-execute them, to re-run anything a
finding of its own depends on, and that a summary of the change arriving through
this channel is itself a finding. Nothing in the bundle runs the commands. One
block per check — command, real exit code, a tail of output:

```
$ make lint
exit 0

$ make test
exit 1
  FAILED tests/test_parser.py::test_empty_input - AssertionError
  1 failed, 513 passed in 19.02s
```

Exit codes and output tails are safe to pass because they are not an
interpretation of the diff; a sentence about what the change does is, and that
is what the review exists to keep out. Two rules keep the file honest:

- **Record a failing check as failing.** Omitting a red gate turns a real signal
  into a false all-clear the reviewer cannot see through.
- **Record checks run against the tree being reviewed.** The digest guards the
  verdict's freshness; nothing guards this file's.

The reviewer is told the section is author-assembled, so an all-green listing on
a change whose tests do not cover the new path is a finding about the checks.

**Mutation runs, under `strict`.** Asking whether a test would fail if the change
were reverted means mutating and re-running. Run the test file covering the
mutated line, not the whole suite, and the full suite once at the end. Restore
between mutations and confirm each one is in the tree before trusting its run: a
patch that did not apply reads exactly like a test that passed.

**On the task-PR path** `open_task_pr.sh` runs the review check before the host
gate, so there is no gate result to record yet; `--checks` belongs to the
editing loop, where the author ran the checks before emitting.

## Tuning knobs

| Env var | Default | Effect |
|---------|---------|--------|
| `ARSENAL_MAX_WORKERS` | `2` | Workers per batch. `2` is the validated git-push concurrency ceiling; higher N raises claim-race churn and PR/merge-conflict surface. **Forced to `1` when worktree isolation is unavailable** (loop step 0): parallel workers are unsafe sharing one tree. |
| `ARSENAL_QUOTA_STOP_PCT` | `90` | Stop the loop before dispatch at/above this used-percentage on either window. |
| `ARSENAL_MAX_ITERATIONS` | `50` | Always-available per-session dispatch-round cap (quota-independent). `0` disables it. |
| `ARSENAL_RATE_LIMITS_FILE` | `<session>/rate_limits.json` | Where the quota guard reads its snapshot. Override it to feed quota from a surface with no statusLine — a cloud session writes this file for itself or the percentage guard never engages. See `references/quota-governance.md`. |
| `ARSENAL_GATE_INHERIT_ENV` | _(unset)_ | Set `1` to run gate blocks with the caller's full environment instead of the hardened throwaway HOME + restricted PATH. |
| `LOOP_WORKSPACE` | _(unset)_ | Workspace scope; set by `/queue-next` token inference. |
| `LOOP_TAGS` | _(unset)_ | Comma/space-separated tag scope (ANDed); set by `/queue-next` token inference. |
| `ARSENAL_QUEUE_REMOTE` | `origin` | Remote for claim refs + per-task pushes. |
| `ARSENAL_CLAIM_PREFIX` | `arsenal/claims` | Ref namespace for atomic claim refs. |
| `ARSENAL_HOME` | `arsenal` | Host-owned tree (tasks, specs, plans, config, session). |
