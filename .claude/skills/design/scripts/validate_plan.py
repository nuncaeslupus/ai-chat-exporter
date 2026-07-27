#!/usr/bin/env python3
"""validate_plan.py — structural lint for a status/plan.md document.

Checks that a produced plan has the sections and table columns the `design`
workflow requires — shape, not content. It confirms the Technical solution,
Implementation tasks, Evidence log, and Sign-off sections exist, that the task
table carries the required columns (including the measurable Gate), and that the
Evidence log table carries the columns gate-check's run_gate.py expects.

It is deliberately shallow: gate values and evidence completeness are checked by
the `gate-check` skill (run_gate.py), not here. This script only verifies the
plan is well-formed enough for that audit to run.

Human-readable on stdout; problems on stderr. Exit 0 = well-formed, 1 = missing
sections or columns, 2 = usage error (file missing).
"""

import argparse
import re
import sys
from pathlib import Path

REQUIRED_SECTIONS = ("Technical solution", "Implementation tasks", "Evidence log", "Sign-off")
TASK_COLUMNS = ("t#", "description", "gate", "tests")
EVIDENCE_COLUMNS = ("measured", "command", "sha", "env")
DELIM_CELL = re.compile(r"^:?-+:?$")


def headings(text: str) -> list[str]:
    return [ln[3:].strip().lower() for ln in text.splitlines() if ln.startswith("## ")]


def table_rows(text: str) -> list[list[str]]:
    """Return normalized non-empty cells for every table row, skipping delimiter rows."""
    rows: list[list[str]] = []
    for line in text.splitlines():
        if "|" not in line:
            continue
        cells = [c.strip().strip("`").lower() for c in line.split("|") if c.strip()]
        if not cells or all(DELIM_CELL.match(c) for c in cells):
            continue
        rows.append(cells)
    return rows


def find_table(rows: list[list[str]], marker: str) -> list[str] | None:
    """The first table row whose cells include the marker column exactly (the header).

    Exact match (not substring) mirrors run_gate.py's `"gate" in headers`, so the two
    scripts agree on which table is the gate/evidence table and a stray body cell
    containing the word is never mistaken for a header.
    """
    for cells in rows:
        if marker in cells:
            return cells
    return None


def lint(text: str) -> list[str]:
    problems: list[str] = []
    present = headings(text)
    for name in REQUIRED_SECTIONS:
        if not any(name.lower() in h for h in present):
            problems.append(f"missing required section ## {name}")

    rows = table_rows(text)
    task_hdr = find_table(rows, "gate")
    if task_hdr is None:
        problems.append("no Implementation tasks table with a Gate column found")
    else:
        for col in TASK_COLUMNS:
            if not any(col in c for c in task_hdr):
                problems.append(f"task table missing required column '{col}'")

    ev_hdr = find_table(rows, "measured")
    if ev_hdr is None:
        problems.append("no Evidence log table (a 'Measured' column) found")
    else:
        for col in EVIDENCE_COLUMNS:
            if not any(col in c for c in ev_hdr):
                problems.append(f"evidence table missing required column '{col}'")

    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--input",
        default="status/plan.md",
        help="plan file to check (default: status/plan.md)",
    )
    args = parser.parse_args()

    path = Path(args.input)
    if not path.exists():
        print(f"✗ {path} not found — pass --input <plan>", file=sys.stderr)
        return 2
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"✗ failed to read {path}: {exc}", file=sys.stderr)
        return 2

    problems = lint(text)
    if problems:
        for p in problems:
            print(f"  ✗ {p}")
        print(f"\n{path}: {len(problems)} structural problem(s)")
        return 1
    print(f"✓ {path}: required sections and table columns present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
