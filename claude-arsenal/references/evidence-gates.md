# Acceptance gates — what makes one real

Read this when writing a gate, when a gate passed and should not have, or when a
numeric threshold has no number behind it yet.

## Contents

- [The fence is what makes a gate mechanical](#the-fence-is-what-makes-a-gate-mechanical)
- [Gate blocks run verbatim](#gate-blocks-run-verbatim)
- [The gate is fixed for the life of the task](#the-gate-is-fixed-for-the-life-of-the-task)
- [Evidence gates (numeric acceptance)](#evidence-gates-numeric-acceptance)
- [Unmeasured — the third outcome](#unmeasured--the-third-outcome)
- [The placeholder, and the first PR that replaces it](#the-placeholder-and-the-first-pr-that-replaces-it)

---

## The fence is what makes a gate mechanical

Prose, and inline `single-backtick` commands, are NOT executed — a payload
without a fenced ` ```bash ` block runs nothing, and `gate_run.sh` then prints
`gate: prose-only` (or `gate: none`) with a stderr warning instead of the
`gate: passed` it prints when a block really ran. Check that line before
trusting a gate: one consumer audit found 0 of 70 payloads carried a fenced
block, so its entire gate layer had been inert. Set
`ARSENAL_GATE_REQUIRE_BLOCK=1` to turn "nothing ran" into a hard failure
when every task in a repo is meant to carry a mechanical gate.

`query_status.py` and `task_select.py` both report a task with no block, because
an entire gate layer can go inert without anyone noticing.

## Gate blocks run verbatim

`gate_run.sh` executes the bash block as code in the worker's tree (hardened by
default: throwaway HOME + a PATH without `$HOME` shims, except the dirs holding
the package manager / language runtime, which stay reachable so a `pnpm …` gate
runs instead of dying at exit 127; `ARSENAL_GATE_INHERIT_ENV=1` opts out
entirely). Treat a gate block from an untrusted plan/payload as you would any
code to run — review it. A gate that could not run exits **3**, never 0 or 1,
and a worker treats it as "could not run" rather than reading it as a verdict.

## The gate is fixed for the life of the task

`open_task_pr.sh` runs the gate with `ARSENAL_GATE_FROM_DEFAULT=1`, so
`gate_run.sh` reads the task file **from the default branch** and not from the
branch under test. A worker whose own branch supplies the gate it is being held
to is certifying itself, so this is not a setting to relax.

The consequence is the part that costs a session if it is not said out loud:
**a task's own PR can never amend an acceptance gate that is already real.** Not
the assertions, not the test names it calls, not a symbol it renamed. The edit is
not rejected — it is simply never read, and the failure that follows names a
missing test rather than the reason for it.

**The one exception is the placeholder, and it is not a relaxation.** A task
seeded from a plan ships with the placeholder command (`# arsenal:gate-placeholder`),
which asserts nothing: there is no criterion yet for a branch to weaken. So when
the default branch still carries the placeholder and the working copy supplies a
real command, `gate_run.sh` runs the working copy's — and says so on stderr. That
is how a task defines its first gate, in its own PR, and it is the intended
bootstrap. The gate *block* around it — metric, operator, threshold, evidence
path — is still read from the default branch, so the threshold is the board's
either way. Once the default branch carries a real command the exception is
closed for good, and the paragraph above is the whole of the rule.

Two things follow for a worker. Replacing a placeholder in a task's own PR is
correct work, not self-certification — do not preserve the placeholder to look
compliant. And a `gate_run` line saying it ran the working copy's command is that
bootstrap, not a bug to chase.

So a task text must not invite the amendment. This sentence, from a real task,
describes something the toolkit refuses:

> `build_list_requests` is the name this task gives that seam; an implementation
> choosing another name **updates this block in the same diff**.

Write the constraint instead: the gate is a precondition the board sets, and an
implementation that cannot satisfy it as written needs a **board-side edit merged
to the default branch first**, or a new task. Restoring the block byte-for-byte
from the default branch is the correct recovery when a branch has already
diverged.

`gate_run.sh` says which file it read on every run, and says explicitly when a
working-copy gate exists and was not used. Read that line before looking for a
bug in the implementation.

---

## Evidence gates (numeric acceptance)

A numeric gate — a Sharpe floor, a coverage floor, a latency ceiling — must be
backed by a **committed measurement**, not a worker's word. Declare it in the
payload's `## Acceptance gate` section as a fenced `gate` block:

````markdown
```gate
line_coverage >= 0.90
evidence: coverage.json
key: totals.percent_covered
```
````

Line 1 is the gate in `<metric> <op> <threshold>` grammar (the same grammar the
`gate-check` skill uses); `evidence` is a committed JSON file; `key` is a dotted
path to the measured number inside it. `gate_run.sh` asserts `measured <op>
threshold` over that file: a declared evidence gate with **no** evidence file, or
evidence that **violates** the threshold, is a hard failure — it can never pass
vacuously. This is the machine-checkable half of "`done` means the gate passed"
(closes the false-`done` hole for `[LAPTOP]`/science gates). The release-side
half is enforced at the choke point: a worker opens no PR unless
the PR is opened (not a bare `branch:` ref) and not closed-without-merge; the
payload's mechanical gate passes (`open_task_pr.sh` runs `gate_run.sh` itself, so
the evidence/bash gate is a hard precondition, and so is the host's own
`host-gate` when the repo declares one); and — for a task tagged **`laptop`** — the session
is not a cloud session. A cloud worker (`CLAUDE_CODE_REMOTE=true`) physically
cannot satisfy a `[LAPTOP]`-only gate (model training, CPCV Sharpe, soak,
paper-trade), so tag such tasks `laptop` (`create_task.py --tag laptop`) and the
laptop session records `done`; a cloud session is refused.

Evidence files are build products, and that shows up in git: every branch
rewrites them, so every rebase onto a moved base conflicts on them. Do not
hand-merge one — the right content is neither side, it is what the code measures
on the resulting tree. `bin/rebase_stack.sh` handles this: an evidence-only
conflict is regenerated with the repo's `host-gate` and the rebase continues; a
conflict anywhere else stops it.

---

## Unmeasured — the third outcome

A numeric gate is routinely in a state that is neither pass nor fail: the check
ran, and what it found is that this cannot be scored yet — the prerequisite data
has not arrived. Without somewhere to put that, the honest evidence (a `null`)
lands in the non-numeric branch and reads as a hard failure, which pressures the
author into weakening the gate to something measurable — exactly the pressure
these gates exist to remove.

Declare it with an optional `status-key`, a dotted path to a string that may read
`unmeasured`:

````markdown
```gate
extraction_macro_f1 >= 0.75
evidence: metrics.json
key: extraction.macro_f1
status-key: extraction.status
```
````

`gate_evidence.py` then exits **3**, which `gate_run.sh` already treats as "could
not run" rather than as a verdict. It must be **positively asserted** in the
evidence file: treating any missing or null value as unmeasured would let a gate
stop checking by omission, which is the vacuous-pass hole these gates were added
to close, reopened somewhere new.

---

## The placeholder, and the first PR that replaces it

Every task is filed with a gate command that fails on purpose:

````markdown
```bash
# arsenal:gate-placeholder — replace with the real check; it may land in this task's own PR
false
```
````

`open_task_pr.sh` resolves the gate from the **default branch**, because a worker
whose own branch supplies the gate it is held to is certifying itself. Those two
rules used to collide: the placeholder on the default branch failed, so no PR
opened — and the only change that could replace the placeholder was the one that
PR carried.

The command is now the one part that defers. When the default branch's `bash`
block is still the placeholder — the marker above on the block's first line,
or a lone `false` from an earlier template — `gate_run.sh` runs the **working copy's** command instead and
says so on stderr. The `gate` block is unaffected: the metric, operator,
threshold and evidence path are still read from the default branch, every time,
so the assertion a worker is measured against is always the board's. Once a real
command has merged, the working copy stops being consulted.
