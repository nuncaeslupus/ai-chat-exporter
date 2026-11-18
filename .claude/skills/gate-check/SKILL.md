---
name: gate-check
description: Reports PASS/FAIL with measured numbers on a plan task's acceptance gate, or audits all gates. Use when the user asks whether a gate passed. Not for writing code.
user-invocable: true
metadata:
  section: workflow
---

# gate-check

Read a task's measurable acceptance gate from `status/plan.md`, compare a measured
value to its threshold, and report PASS/FAIL with the numbers.

CANARY: gate-check-loaded-2026-06-06-fb78d23e-e26f5d00ce664711

## When to load

Load when a plan already carries a `Gate` column and the question is whether a
finished task met it, with the measured number. `execution` writes the evidence;
this skill verifies it, and `review` / `ship` run it.

## The gate contract

A gate is a measurable acceptance condition in the plan's task table, written
`<metric> <op> <threshold>` with one of `< <= > >= == !=`:

```markdown
| T# | Description | Gate                    | Tests |
|----|-------------|-------------------------|-------|
| T1 | parser      | `line_coverage >= 0.90` | …     |
| T2 | endpoint    | `p95_latency_ms <= 200` | …     |
```

The evidence (measured value, command, commit SHA, environment provenance) lives
in the plan's `Evidence log` table. Load `references/gate-grammar.md` when writing a
gate the parser must read, defining the Evidence log columns, or diagnosing a gate
reported "manual" or a task reported "grandfathered".

## How to use

The script defaults to `status/plan.md`; pass `--input` for any other path.

### Audit every task

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/run_gate.py" --input status/plan.md
```

Prints one line per task and a summary. Exit 0 when no gated task fails or lacks
evidence, 1 otherwise. A manual (`?`) gate exits 0 once its evidence is recorded,
so it still needs a human verdict before it counts as met. `--strict` also fails
ungated tasks; without it they are grandfathered.

### Focus one task, compare a measured value

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/run_gate.py" --input status/plan.md --id T2 187
```

Compares the measured `187` to T2's threshold; omit the number to use the value
recorded in the Evidence log. `--json` gives a verdict a wrapper can consume: a
project's own wrapper measures the metric, then calls `run_gate.py` for the verdict.

`run_gate.py` is read-only, so checking a gate never changes the record it audits;
recording evidence is a markdown edit owned by `execution`'s RECORD step.

## Gotchas

- **Threshold and measured value must share a unit.** The parser reads the first
  number after the operator (`>= 90%` → `90`); it does not convert. A gate of
  `>= 90` checked against a measured `0.93` fails — pick one scale and keep the
  measurement on it.
- **Non-numeric gates report "manual", never PASS.** A gate the grammar cannot
  parse (e.g. "all golden files identical") is surfaced for human judgement and is
  never auto-passed — rewrite it as a measurable condition where one exists.
- **Exit 2 means no Gate column or a usage error** (missing file, bad `--id`).
  A wrong `--input` gives the same code, so confirm the path before treating it as
  a plan that predates gates.
- **Stale evidence after a re-run.** The Evidence log records one measurement at a
  point in time (its SHA + provenance say which). After re-measuring, update the
  row — `run_gate.py` trusts the recorded number; it does not re-run the command.
