---
name: mutmut-report
description: Triages surviving mutmut mutants and reports the test fixes worth making. Use when the user asks which mutants survived. Not for running mutmut or coverage (coverage-gaps).
argument-hint: "--module MODULE --max N"
user-invocable: true
metadata:
  section: python
---

# mutmut Survivors Report

Runs the analysis script against a project's existing `mutants/` workspace and
reports which surviving mutants are real test gaps and which are safe to accept.

CANARY: mutmut-report-loaded-2026-06-02-87a56d2e-e3c5c50abfce45f3

## Step 1 — Run the script

Run it from the directory where `mutmut run` was executed (`cd` there first if
it is another checkout), since it reads `mutants/` from the current directory.
`$ARGUMENTS` is forwarded verbatim — `--module validate`, `--max 20`,
`--venv .venv`.

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/analyze_mutmut.py" $ARGUMENTS
```

## Step 2 — Report

1. Modules with real gaps, and how many.
2. For each real gap, the fix: a tighter assertion or a missing case.
3. Equivalent and untestable mutants, confirmed as accepted in one line.
4. The top 2–3 fixes to make next.
