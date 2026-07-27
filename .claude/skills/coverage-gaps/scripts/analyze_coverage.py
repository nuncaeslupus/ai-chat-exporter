#!/usr/bin/env python3
"""analyze_coverage.py — rank a coverage.py report's gaps by test value.

Reads a coverage.py JSON report (produced by `coverage json`) and emits a
ranked JSON list of the files with the most to gain from new tests. For each
file it reports the uncovered line count, the percent covered, and the
*contiguous* missing-line runs — a run of consecutive uncovered lines usually
marks a whole untested function or branch, which is higher-value than the
scattered single lines that tend to be defensive error handlers.

JSON-only on stdout; errors on stderr. Exit 0 when the report builds; exit 2 on
a usage error (e.g. the input file is missing — run `coverage json` first).
"""

import argparse
import json
import sys
from pathlib import Path


def contiguous_runs(lines: list[int]) -> list[list[int]]:
    """Collapse a sorted line list into [start, end] inclusive runs."""
    runs: list[list[int]] = []
    for line in sorted(lines):
        if runs and line == runs[-1][1] + 1:
            runs[-1][1] = line
        else:
            runs.append([line, line])
    return runs


def build_report(data: dict, limit: int) -> dict:
    files_data = data.get("files")
    files = []
    for path, info in (files_data if isinstance(files_data, dict) else {}).items():
        if not isinstance(info, dict):
            continue
        missing = info.get("missing_lines", [])
        missing_branches = info.get("missing_branches", [])
        # Include files with missing lines OR with missing branch coverage (a file
        # at 100% line coverage can still have untaken branches — see Gotchas).
        if not missing and not missing_branches:
            continue
        summary = info.get("summary") or {}
        runs = contiguous_runs(missing)
        files.append(
            {
                "file": path,
                "percent_covered": round(summary.get("percent_covered", 0.0), 1),
                "missing_count": len(missing),
                "missing_branches": len(missing_branches),
                "largest_run": max((r[1] - r[0] + 1 for r in runs), default=0),
                "missing_runs": runs,
            }
        )

    # Most uncovered lines first; break ties toward the least-covered file.
    files.sort(key=lambda f: (-f["missing_count"], f["percent_covered"]))
    totals = data.get("totals", {})
    return {
        "total_percent_covered": round(totals.get("percent_covered", 0.0), 1),
        "files_with_gaps": len(files),
        "gaps": files[:limit],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--input",
        default="coverage.json",
        help="coverage.py JSON report (default: coverage.json). Generate with `coverage json`.",
    )
    parser.add_argument("--limit", type=int, default=20, help="Max files to report (default: 20)")
    args = parser.parse_args()

    path = Path(args.input)
    if not path.exists():
        print(
            f"✗ {path} not found — run `coverage json` (or `pytest --cov ... "
            "--cov-report json`) first",
            file=sys.stderr,
        )
        return 2
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"✗ {path} is not valid JSON: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"✗ failed to read {path}: {exc}", file=sys.stderr)
        return 2

    if not isinstance(data, dict):
        print(f"✗ {path} is not a coverage.py report (expected a JSON object)", file=sys.stderr)
        return 2

    print(json.dumps(build_report(data, args.limit), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
