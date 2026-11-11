# Acceptance gates — what makes one real

Read this when writing a gate, when a gate passed and should not have, or when a
numeric threshold has no number behind it yet. For making a gate faster, read
`references/performance-tuning.md` § Making the gate faster.

## Contents

- [The fence is what makes a gate mechanical](#the-fence-is-what-makes-a-gate-mechanical)
- [Gate blocks run verbatim](#gate-blocks-run-verbatim)
- [The gate is fixed for the life of the task](#the-gate-is-fixed-for-the-life-of-the-task) — and the placeholder exception
- [The task gate measures the pre-archive tree](#the-task-gate-measures-the-pre-archive-tree)
- [Asking whether the gates would run, without running them](#asking-whether-the-gates-would-run-without-running-them) — `--preflight`
- [Evidence gates (numeric acceptance)](#evidence-gates-numeric-acceptance)
- [Unmeasured — the third outcome](#unmeasured--the-third-outcome)
- [Would the number move if the thing it measures broke?](#would-the-number-move-if-the-thing-it-measures-broke)
- [How often to run the whole gate](#how-often-to-run-the-whole-gate) — and why the gate never caches outcomes

---

## The fence is what makes a gate mechanical

Only a fenced ` ```bash ` block runs. Prose and inline `single-backtick`
commands run nothing, and `gate_run.sh` then prints `gate: prose-only` (or
`gate: none`) with a stderr warning instead of `gate: passed`, so read that line
before trusting a gate. `query_status.py` and `task_select.py` both report a task
with no block, because a whole gate layer can go inert unnoticed. Set
`ARSENAL_GATE_REQUIRE_BLOCK=1` to make "nothing ran" a hard failure when every
task in a repo is meant to carry a mechanical gate.

## Gate blocks run verbatim

`gate_run.sh` executes the block as code in the worker's tree. By default it is
hardened: a throwaway `HOME` and a `PATH` without `$HOME` shims, except that the
package manager or language runtime itself is symlinked in so a `pnpm …` gate
runs. `ARSENAL_GATE_INHERIT_ENV=1` opts out. Review a gate block from an
untrusted plan or payload as you would any code you run. A gate that could not
run exits **3**, and a worker reads that as "could not run", not as a verdict.

## The gate is fixed for the life of the task

`open_task_pr.sh` runs the gate with `ARSENAL_GATE_FROM_DEFAULT=1`, so
`gate_run.sh` reads the task file from the **default branch**, not from the
branch under test, because a branch that supplies its own gate is certifying
itself. So a task's own PR cannot amend a gate that is already real: not the
assertions, the test names it calls, or a symbol it renames. The edit is not
rejected, it is never read, and the failure that follows names a missing test
rather than the cause. `gate_run.sh` says which file it read on every run, and
when a working-copy gate existed and was not used; read that line before hunting
for a bug in the implementation.

Write task text accordingly. A task must not say "an implementation choosing
another name updates this block in the same diff". An implementation that cannot
meet the gate as written needs a board-side edit merged to the default branch
first, or a new task. When a branch has already diverged, restore the block
byte-for-byte from the default branch.

**The placeholder is the one exception.** Every task is filed with a command
that fails on purpose:

````markdown
```bash
# arsenal:gate-placeholder — replace with the real check; it may land in this task's own PR
false
```
````

It asserts nothing, so there is no criterion for a branch to weaken. While the
default branch still carries it (the marker on the block's first line, or a lone
`false` from an earlier template), `gate_run.sh` runs the **working copy's**
command and says so on stderr. The `gate` block around it (metric, operator,
threshold, evidence path) is still read from the default branch, so the
threshold stays the board's. Replacing the placeholder in the task's own PR is
correct work, and that stderr line is this bootstrap, not a bug. Once a real
command has merged, the working copy is no longer consulted.

## The task gate measures the pre-archive tree

`open_task_pr.sh` runs the task's own gate **before** archiving the task file
into `tasks/_history/`, and the repo's `host-gate` **after**. The host gate runs
last because the archived tree is the one the PR ships; the task gate runs first
because `gate_run.sh` needs the working copy of the task file to resolve which
copy to read.

So a task gate must not depend on state the archive produces. A gate asserting
"every merged task is archived", or one that reuses `host-gate`, fails on a
correct tree and is reported as `the task gate failed`. A check that needs the
final tree belongs in `host-gate`.

## Asking whether the gates would run, without running them

```bash
bash claude-arsenal/bin/open_task_pr.sh <task-id> --preflight
```

It runs the cheap half of the real run in the real order (review receipt, task
gate, shared-checkout guard, issue handle, archive), puts the tree back, and
prints `preflight:ok` with exit 0. It needs no `<title>` and opens nothing: no
branch, commit, issue edit or PR. It stops at the first refusal, since each
refusal names its own cause and fix; fix it and re-run. A signal during the run,
such as `Ctrl-C`, restores the task file before exiting.

It cannot tell you whether `host-gate` passes, because running that is the cost
being avoided. It only notes whether the gate's first word resolves on this
machine, which catches a gate naming a tool a fresh worktree lacks. For more, a
repo declares its own fast check:

```toml
# arsenal/config.toml
host-gate = "make lint test"
preflight-gate = "make verify-gates"
```

`preflight-gate` runs under `--preflight` after the archive, on the same side as
`host-gate`, so a check over the repo's task files sees the tree the PR ships.
Name something that takes seconds. It is also the fast gate every review round
after the first runs on the delta through `bin/fast_gate.sh`; see
`references/ci-minutes.md` § Two gate levels.

## Evidence gates (numeric acceptance)

A numeric gate (a coverage floor, a latency ceiling, a score threshold) is backed
by a **committed measurement**, not a worker's word. Declare it in the payload's
`## Acceptance gate` section as a fenced `gate` block:

````markdown
```gate
line_coverage >= 0.90
evidence: coverage.json
key: totals.percent_covered
```
````

Line 1 is `<metric> <op> <threshold>`, the grammar the `gate-check` skill uses;
`evidence` is a committed JSON file and `key` a dotted path to the number in it.
`gate_run.sh` asserts `measured <op> threshold`. A missing evidence file, or
evidence that violates the threshold, is a hard failure, so the gate cannot pass
vacuously.

`open_task_pr.sh` runs `gate_run.sh` itself, plus `host-gate` when the repo
declares one, so both are preconditions of opening the PR. `done` additionally
needs an opened PR (not a bare `branch:` ref) that was not closed without merge.
A gate only a local machine can satisfy (model training, a long soak, anything
needing local hardware) belongs on a task tagged `laptop`
(`create_task.py --tag laptop`); a cloud session (`CLAUDE_CODE_REMOTE=true`) is
refused on it and the laptop session records `done`.

Evidence files are build products, so every rebase onto a moved base conflicts on
them. Do not hand-merge one; the right content is what the code measures on the
resulting tree. `bin/rebase_stack.sh` regenerates an evidence-only conflict with
`host-gate` and continues, and stops on a conflict anywhere else.

## Unmeasured — the third outcome

A numeric gate can be neither pass nor fail: the check ran and found that the
prerequisite data has not arrived. Without a place for that, an honest `null`
reads as a hard failure and pushes the author to weaken the gate. Declare a
`status-key`, a dotted path to a string that may read `unmeasured`:

````markdown
```gate
extraction_macro_f1 >= 0.75
evidence: metrics.json
key: extraction.macro_f1
status-key: extraction.status
```
````

`gate_evidence.py` then exits **3**, which `gate_run.sh` treats as "could not
run". The status must be asserted positively in the evidence file, because
treating a missing or null value as unmeasured would let a gate stop checking by
omission.

## Would the number move if the thing it measures broke?

A gate that cannot move passes forever. Checking that takes one deliberate revert
per claim: the `pin-check` skill (in the `python` section) changes the line a case
claims to pin, runs only that case, restores it, and reports `PINNED` /
`NOT PINNED` / `NOT MUTATED`. Run it on the claim rather than the module; it
takes seconds where a whole-module mutation score takes hours.

## How often to run the whole gate

Run the full gate **once, before opening the PR**, and while editing run only the
suite covering what changed. The pre-PR run is the one that decides, so this
costs nothing and weakens nothing, and it usually saves more time than any
parallelism change.

Keep that selectivity in the editing loop, where a wrong choice costs a re-run and
certifies nothing. Do not make the gate itself skip suites based on what changed:
a gate that verifies a subset verifies nothing in particular, and its selection
logic becomes the least-tested code with the most authority.

For the same reason `host-gate` never caches **outcomes**. Tooling that skips
tests it believes a change could not affect (`pytest --lf`, `testmon`, a
"no relevant files changed" branch in CI) turns *this tree passes* into *nothing
I chose to run failed*, with no signal that the check narrowed. Use it in the
edit loop only. Caching **inputs** is safe;
`references/performance-tuning.md` § Caching inputs says how to key them.
