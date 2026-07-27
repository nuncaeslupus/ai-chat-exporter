---
name: mutmut-report
description: Use when the user wants to triage a Python project's surviving mutmut mutants after a run — runs the analysis script, classifies each survivor as REAL_GAP, EQUIVALENT, or UNTESTABLE, and reports the test fixes worth making. Triggers — "analyze mutmut survivors", "which mutants survived", "triage mutation testing results", "/mutmut-report --module X". Owns scripts — analyze_mutmut.py. Do NOT use to run mutmut itself (run `mutmut run` first), for coverage reports (see coverage-gaps), or for non-Python mutation testing.
argument-hint: "--module MODULE --max N"
user-invocable: true
---

# mutmut Survivors Report

Run the analysis script against a project's existing `mutants/` workspace, then report which surviving mutants are real test gaps and which are safe to accept.

CANARY: mutmut-report-loaded-2026-06-02-87a56d2e-e3c5c50abfce45f3

## Step 1 — Run the script

Invoke from the project directory that owns the `mutants/` workspace (the one where `mutmut run` was executed). `$ARGUMENTS` is forwarded verbatim to the script — pass flags like `--module validate`, `--max 20`, or `--venv .venv`.

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/analyze_mutmut.py" $ARGUMENTS
```

If the target project is a different checkout, `cd` to it first — the script reads `mutants/` from the current directory while still being launched by its absolute `${CLAUDE_SKILL_DIR}` path.

## Step 2 — Present results

After running, report concisely:
1. Which modules have **Real gaps** and how many
2. For each real gap: what the fix is (tighter assertion, missing test case, etc.)
3. Which are **Equivalent** or **Untestable** — just confirm these are accepted, no detail needed
4. Suggest the top 2-3 fixes to implement next

Do not re-explain what mutmut is. Just report findings and fixes.
