# Gate grammar and evidence schema

## Contents

- [Gate grammar](#gate-grammar)
- [Operators](#operators)
- [Units](#units)
- [The Evidence log](#the-evidence-log)
- [Non-numeric gates](#non-numeric-gates)
- [Exit codes](#exit-codes)
- [Worked examples](#worked-examples)

## Gate grammar

A gate is the measurable acceptance condition for one task. It lives in the
`Gate` column of the plan's `Implementation tasks` table and reads:

```
<metric> <op> <threshold>
```

- **metric** — a short name for what is measured (`line_coverage`,
  `p95_latency_ms`, `error_rate`, `binary_size_kb`). Free text; everything before
  the operator is treated as the metric label.
- **op** — one comparison operator (see below).
- **threshold** — a single number (int or float, optional sign). A trailing unit
  is allowed for readers but ignored by the parser (`200ms` parses as `200`).

`run_gate.py` searches the cell for the first `op` followed by a number. Anything
that does not match that shape is treated as a non-numeric gate.

## Operators

| Op | Meaning | Passes when |
|----|---------|-------------|
| `<`  | strictly below | measured `<` threshold |
| `<=` | at most | measured `<=` threshold |
| `>`  | strictly above | measured `>` threshold |
| `>=` | at least | measured `>=` threshold |
| `==` | equals | measured `==` threshold |
| `!=` | differs | measured `!=` threshold |

Use `<=` / `>=` for budgets and floors (latency ceilings, coverage floors). Use
`== 0` for counts that must be zero (lint errors, golden-file diffs).

## Units

The parser does not convert units. The threshold and the measured value must be
expressed on the **same scale**. `coverage >= 90` checked against a measured
`0.93` *fails* — because `0.93 >= 90` is false. Pick one convention per metric
(fraction `>= 0.90` or percent `>= 90`) and record the measurement the same way.

## The Evidence log

The plan's `Evidence log` table records, per task, the proof the gate was met:

```
| T# | Gate                    | Measured | Command         | SHA     | Env     | Date       |
|----|-------------------------|----------|-----------------|---------|---------|------------|
| T1 | `line_coverage >= 0.90` | 0.93     | `make coverage` | a1b2c3d | [HERE]  | 2026-06-06 |
```

`run_gate.py` requires four fields to call a row **complete**:

- **measured** — the number the run produced (the parser reads the first number).
- **command** — the exact command that produced it, so it can be re-run.
- **sha** — the commit the measurement was taken at.
- **env** — environment provenance: which machine / runner produced the number.
  Projects pick their own tags; `[HERE]` / `[LAPTOP]` is one downstream's
  convention, `ci` / `local` works just as well.

`Gate` and `Date` are recorded for the human reader; they are not part of the
completeness check. A gated task whose evidence row is missing any of the four
required fields is reported incomplete and fails the audit (exit 1).

## Non-numeric gates

A gate the grammar cannot parse — "all 12 golden files byte-identical", "manual
QA sign-off" — is reported as **manual**. The engine never auto-passes a manual
gate; a human verifies it. Prefer a measurable restatement where one exists
(`golden_diffs == 0` instead of "files identical"); reserve manual gates for
conditions that genuinely cannot be reduced to a number.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | every gated task passes with complete evidence (or the focused task passes) |
| 1 | a gate fails, a gated task's evidence is incomplete, or the focused task fails |
| 2 | usage error: plan file missing, no table with a `Gate` column, or unknown `--id` |

Exit 2 covers two distinct conditions: a plan with no `Gate` column (genuinely
grandfathered — a plan predating the gate kernel) and usage errors (plan file
missing, unknown `--id`). Confirm the invocation uses `--input <plan>` and the
file exists before treating exit 2 as a should-flag; a wrong invocation produces
exit 2 and silently skips the audit just as a missing Gate column does.

With `--strict`, a task that has no gate of its own is also a failure (exit 1) —
use it on new plans, where every task is expected to carry a measurable gate. The
default (no `--strict`) grandfathers ungated tasks so older plans keep passing.

## Worked examples

```bash
# Audit the whole plan (the line review/ship run)
python3 "${CLAUDE_SKILL_DIR}/scripts/run_gate.py" --input status/plan.md

# Did T2 meet its latency budget? Compare a freshly measured 187 ms
python3 "${CLAUDE_SKILL_DIR}/scripts/run_gate.py" --input status/plan.md --id T2 187

# Re-check T1 against the value already recorded in the Evidence log
python3 "${CLAUDE_SKILL_DIR}/scripts/run_gate.py" --input status/plan.md --id T1

# Machine-readable verdict for a downstream wrapper to parse
python3 "${CLAUDE_SKILL_DIR}/scripts/run_gate.py" --input status/plan.md --id T1 0.93 --json
```
