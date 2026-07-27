---
name: gate-check
description: Use whenever the user wants an objective PASS/FAIL on a task's measurable acceptance gate from status/plan.md, with the measured numbers — runs run_gate.py to read the gate (metric, op, threshold) and recorded evidence, or audit every task's gate at once. Triggers — "did this task pass its gate", "verify the acceptance condition", "are all gates met". Owns scripts — run_gate. The generic engine a project wraps with its own measurement. Do NOT use to write code (see execution) or rank missing tests (see coverage-gaps).
user-invocable: true
---

# gate-check

Read a task's measurable acceptance gate from `status/plan.md`, compare a measured
value to its threshold, and report an objective PASS/FAIL with the numbers — the
generic engine behind the "every step has an exact, recorded gate" discipline.

CANARY: gate-check-loaded-2026-06-06-fb78d23e-e26f5d00ce664711

## When to load

Load when a `status/plan.md` (the `design` skill's plan) already carries a `Gate`
column and the question is whether a finished task actually met it — objectively,
with the measured number, not "the tests pass." This is the read-and-report side
of the gate kernel: `execution` writes the evidence; `gate-check` verifies it, and
`review` / `ship` lean on it to confirm every gate is recorded and met.

If the task is to *write* the implementation, defer to `execution`; to *scope* a
feature's success criteria, defer to `specify`; to rank untested lines, defer to
`coverage-gaps`.

## The gate contract

A gate is a measurable acceptance condition in the plan's task table, written
`<metric> <op> <threshold>` with one of `< <= > >= == !=`:

```
| T# | Description | Gate                    | Tests |
|----|-------------|-------------------------|-------|
| T1 | parser      | `line_coverage >= 0.90` | …     |
| T2 | endpoint    | `p95_latency_ms <= 200` | …     |
```

The matching evidence — measured value, command run, commit SHA, environment
provenance — lives in the plan's `Evidence log` table. The full grammar, the
evidence schema, the exit codes, and how non-numeric gates are handled are in
`references/gate-grammar.md` — load it when writing a gate the parser must read,
or when a gate is being reported "manual" unexpectedly.

## How to use

The script defaults to `status/plan.md`; pass `--input` for any other path.

### Audit every task

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/run_gate.py" --input status/plan.md
```

Prints one line per task — gate, whether its evidence is complete, and PASS/FAIL —
then a summary. Exit 0 when every gated task passes with complete evidence; exit 1
when any gate fails or lacks evidence. This is the line `review` and `ship` run.

Add `--strict` to also fail tasks that have no gate at all — new plans should gate
every task, so `--strict` is the "is this plan fully gated?" check; without it,
ungated tasks are grandfathered (the older behavior, for plans predating gates).

### Focus one task, compare a measured value

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/run_gate.py" --input status/plan.md --id T2 187
```

Surfaces T2's gate and recorded command, then compares the measured `187` to the
threshold and reports PASS/FAIL with both numbers. Omit the number to report
against the value already recorded in the Evidence log. Add `--json` for a machine
-readable verdict a wrapper can consume.

## Recording stays a markdown edit

`run_gate.py` is read-only — it never writes the plan. Recording a task's evidence
is a markdown edit into the plan's `Evidence log`, owned by `execution`'s RECORD
step (its template carries the row shape). Keeping the engine read-only means
running it to check a gate can never mutate the record it is auditing.

## Specialising it downstream

A project keeps its own thin wrapper that knows its build ladder, status filename,
and how to *measure* a metric. The wrapper runs the measurement, then calls
`run_gate.py --id <task> <measured>` (or parses `--json`) for the comparison and
PASS/FAIL — so the gate grammar and the verdict logic stay shared, while every
project-specific lookup stays in the wrapper.

## References — load on demand

- [Gate grammar and evidence schema](references/gate-grammar.md) — load when authoring a gate the parser must read, defining the Evidence log columns, or diagnosing a gate reported as "manual" / a task reported "grandfathered".

## Gotchas

- **Threshold and measured value must share a unit.** The parser reads the first
  number after the operator (`>= 90%` → `90`); it does not convert. A gate of
  `>= 90` checked against a measured `0.93` fails — pick one scale and keep the
  measurement on it.
- **Non-numeric gates report "manual", never PASS.** A gate the grammar cannot
  parse (e.g. "all golden files identical") is surfaced for human judgement and is
  never auto-passed — rewrite it as a measurable condition where one exists.
- **Exit 2 means no Gate column found or a usage error** (plan file missing, bad
  `--id`). Confirm the `--input` path is correct and the file exists before
  treating exit 2 as the grandfathered signal — a wrong invocation silently
  produces the same exit code. Treat exit 2 as a should-flag (not a blocker) only
  after confirming the plan genuinely predates the gate convention.
- **Stale evidence after a re-run.** The Evidence log records one measurement at a
  point in time (its SHA + provenance say which). After re-measuring, update the
  row — `run_gate.py` trusts the recorded number; it does not re-run the command.
