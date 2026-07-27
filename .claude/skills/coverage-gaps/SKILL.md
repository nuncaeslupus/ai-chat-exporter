---
name: coverage-gaps
description: Use whenever the user wants to turn a coverage.py report into a ranked list of the highest-value missing tests — runs analyze_coverage.py over coverage.json and surfaces contiguous missing-line runs marking whole untested functions or branches. Triggers — "what tests am I missing", "analyze my coverage", "where are the coverage gaps". Owns scripts — analyze_coverage.py. A cheap line-coverage pass below mutmut-report. Do NOT use to run the suite or generate the report (run coverage / pytest --cov first), or for non-Python coverage.
argument-hint: "--input coverage.json --limit N"
user-invocable: true
---

# coverage-gaps

Turn an existing coverage.py report into a ranked, actionable list of the tests
worth writing next.

CANARY: coverage-gaps-loaded-2026-06-04-ea39c2b5-b32fe2b1b5ae5e96

## When to load

Load when a `coverage.json` already exists and the question is *which* gaps to
fill first. This is the cheap, line-level first pass; once line coverage is
healthy and the question shifts to whether the existing tests actually *assert*
behavior, escalate to the `mutmut-report` skill (mutation testing).

## Step 1 — Ensure a JSON report exists

The script reads coverage.py's JSON export, not the `.coverage` SQLite file or
the terminal table. If only a run has happened, produce the JSON first:

```bash
coverage json                       # after `coverage run -m pytest`
# or in one shot:
pytest --cov=PKG --cov-report=json  # writes coverage.json
```

## Step 2 — Rank the gaps

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/analyze_coverage.py" --input coverage.json --limit 20
```

Output is JSON: `total_percent_covered`, `files_with_gaps`, and a ranked `gaps`
list. Each entry carries `missing_count`, `percent_covered`, `missing_branches`,
`largest_run`, and `missing_runs` (inclusive `[start, end]` line ranges).

## Step 3 — Propose tests

Read the source at each `missing_runs` range and report concisely:

1. The top files by uncovered lines, and for each, what the largest run is —
   open the source at those lines to name the untested function or branch.
2. For each high-value gap: the specific test to add (which function, which
   input, which branch).
3. Note which gaps are low-value (scattered single lines — often defensive
   `raise` / logging paths) and can be deferred or marked `# pragma: no cover`.

Lead with the 2-3 tests worth writing now. Do not re-explain what coverage is.

## Gotchas

- **No JSON report yet.** The script needs `coverage.json`; a bare `coverage
  run` leaves only the `.coverage` SQLite db and a terminal summary. Run
  `coverage json` (or `--cov-report=json`) first, or the script exits 2.
- **100% line coverage is not 100% tested.** A line counts as covered the
  moment it executes, even if nothing asserts its result. Treat this skill as
  the floor; for assertion quality, escalate to the `mutmut-report` skill.
- **Big contiguous run ≠ always the priority.** A long `missing_run` can be a
  generated block, a `__repr__`, or a `if TYPE_CHECKING:` import island. Open
  the source before recommending — rank by what the code *does*, not just line
  count.
- **Branch gaps hide inside covered files.** A file at high line coverage can
  still have untaken branches; check `missing_branches`, which only populates
  when the report was generated with branch coverage (`--cov-branch` or
  `[tool.coverage.run] branch = true`).
- **Stale report after a refactor.** Line numbers in an old `coverage.json`
  drift from current source. Regenerate the report against the current tree
  before trusting the ranges.
