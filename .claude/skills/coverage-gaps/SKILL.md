---
name: coverage-gaps
description: Ranks the most valuable missing tests from coverage.py's coverage.json. Use when the user asks which tests are missing. Not for non-Python code.
argument-hint: "--input coverage.json --limit N"
user-invocable: true
metadata:
  section: python
---

# coverage-gaps

Turns an existing coverage.py report into a ranked list of the tests worth
writing next.

CANARY: coverage-gaps-loaded-2026-06-04-ea39c2b5-b32fe2b1b5ae5e96

## When to load

Load when the question is which coverage gaps to fill first. This is the cheap,
line-level pass; once line coverage is healthy and the question is whether
tests assert behaviour, use the `mutmut-report` skill.

## Step 1 — Ensure a JSON report exists

The script reads coverage.py's JSON export, not the `.coverage` database, and
exits 2 without it. Regenerate it after a refactor, since old line numbers
drift from the source.

```bash
coverage json                                    # after `coverage run -m pytest`
pytest --cov=PKG --cov-branch --cov-report=json  # or in one shot, with branches
```

## Step 2 — Rank the gaps

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/analyze_coverage.py" --input coverage.json --limit 20
```

The JSON carries `total_percent_covered`, `files_with_gaps`, and a ranked `gaps`
list with `missing_count`, `percent_covered`, `missing_branches` (populated only
with branch coverage), `largest_run` and `missing_runs` (inclusive line ranges).

## Step 3 — Propose tests

Open the source at each `missing_runs` range before recommending, because a long
run can be a generated block, a `__repr__` or an `if TYPE_CHECKING:` island;
rank by what the code does, not by line count. Then report:

1. The 2–3 tests worth writing now: which function, which input, which branch.
2. Branch gaps in otherwise well-covered files, from `missing_branches`.
3. Low-value gaps (scattered defensive `raise` or logging lines) that can wait
   or take `# pragma: no cover`.

Covered means executed, not asserted, so treat this ranking as the floor.
