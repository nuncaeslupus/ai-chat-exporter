#!/usr/bin/env python3
"""
Analyze mutmut surviving mutants and output a structured, actionable report.

Usage:
    python analyze_mutmut.py [--venv VENV] [--module MODULE] [--max N]
"""

import argparse
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path


def run_cmd(cmd: list[str]) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise subprocess.CalledProcessError(
            result.returncode, result.args, output=result.stdout, stderr=result.stderr
        )
    return result.stdout


def find_mutmut(venv_hint: str | None) -> str:
    candidates: list[str] = []
    if venv_hint:
        candidates.append(str(Path(venv_hint) / "bin" / "mutmut"))
    candidates += ["venv/bin/mutmut", ".venv/bin/mutmut"]
    for c in candidates:
        if Path(c).exists():
            return c
    if resolved := shutil.which("mutmut"):
        return resolved
    print("ERROR: mutmut executable not found in PATH.", file=sys.stderr)
    sys.exit(1)


def get_survivors(mutmut_bin: str) -> list[str]:
    output = run_cmd([mutmut_bin, "results"])
    return [line.split(":")[0].strip() for line in output.splitlines() if ": survived" in line]


def get_diff(mutmut_bin: str, mutant_id: str) -> str:
    return run_cmd([mutmut_bin, "show", mutant_id])


def classify(diff: str) -> tuple[str, str]:
    """Return (category, reason). Category: EQUIVALENT | REAL_GAP | UNTESTABLE."""
    lines = diff.splitlines()
    removed = [
        line[1:].strip() for line in lines if line.startswith("-") and not line.startswith("---")
    ]
    added = [
        line[1:].strip() for line in lines if line.startswith("+") and not line.startswith("+++")
    ]
    rem = " ".join(removed)
    add = " ".join(added)

    # Sort key: only affects display order
    if re.search(r"key=lambda \w+: \w+\.path", rem) and (
        re.search(r"key=None|key=lambda \w+: None", add) or ("key=" not in add and "sorted(" in add)
    ):
        return "EQUIVALENT", "Sort key mutation — only affects error display order"

    # cast() is a type annotation no-op at runtime
    if "cast(" in rem and "cast(None," in add:
        return "EQUIVALENT", "cast() is a type annotation no-op at runtime"

    # sys.exit() code change
    if re.search(r"sys\.exit\(1\)", rem) and re.search(r"sys\.exit\(", add):
        return (
            "UNTESTABLE",
            "exit code mutation — testing sys.exit() value is impractical",
        )

    # print() in error path
    if "print(" in rem and "print(None)" in add:
        return "UNTESTABLE", "print() in error path — untested by design"

    # .get("key", {}) or .get("key", []) default changed to None / missing
    m = re.search(r'\.get\(["\']([^"\']+)["\'],\s*(\{\}|\[\])\)', rem)
    if m and re.search(r'\.get\(["\'][^"\']+["\'],?\s*(?:None)?\s*\)', add):
        key, default = m.group(1), m.group(2)
        return (
            "REAL_GAP",
            f'.get("{key}", {default}) default changed to None/missing'
            f' — add test where "{key}" key is absent',
        )

    # .get("key", False/True/None) default changed to another falsy value — equivalent
    # False → None: both falsy, any() behaves identically
    m_false = re.search(r'\.get\(["\']([^"\']+)["\'],\s*False\)', rem)
    if m_false and re.search(r'\.get\(["\'][^"\']+["\'],?\s*(?:None)?\s*\)', add):
        return "EQUIVALENT", (
            f'.get("{m_false.group(1)}", False) → None/missing — '
            "both falsy, any() behaves identically"
        )

    # .get("key", True/False) default changed to a different value
    m = re.search(r'\.get\(["\']([^"\']+)["\'],\s*(True|False)\)', rem)
    if m:
        key, default = m.group(1), m.group(2)
        if not re.search(rf'\.get\(["\'][^"\']+["\'],\s*{default}\)', add):
            return (
                "REAL_GAP",
                f'.get("{key}", {default}) default changed'
                f' — add test where "{key}" key is absent and {default} default matters',
            )

    # String literal wrapped in XX...XX  (mutmut string mutation)
    for a_line in added:
        if re.search(r'"XX.+XX"', a_line):
            # Find what changed
            for r_line in removed:
                r_stripped = re.sub(r"\s+", " ", r_line)
                a_stripped = re.sub(r"\s+", " ", a_line)
                if len(r_stripped) > 4 and len(a_stripped) > 4:
                    # Extract original string content
                    orig = re.search(r'(["\'])(.+?)\1', r_stripped)
                    if orig:
                        orig_str = orig.group(2)
                        return (
                            "REAL_GAP",
                            f'String "{orig_str[:40]}" wrapped in XX — test '
                            f"assertion likely uses substring that still matches; "
                            f'check for boundary context like "prefix: {orig_str[:15]}"',
                        )
            return (
                "REAL_GAP",
                "String literal wrapped in XX — test assertion uses substring "
                "that still matches; use boundary context to tighten assertion",
            )

    # None introduced where there was no None
    if add.count("None") > rem.count("None"):
        return "REAL_GAP", "None introduced — test may not exercise this path with None"

    return "REAL_GAP", "Unclassified — review diff manually"


def parse_id(mutant_id: str) -> tuple[str, str, str]:
    """Return (module, function_name, number)."""
    parts = mutant_id.rsplit(".", 1)
    if len(parts) == 2:
        m = re.match(r"x_(.+?)__mutmut_(\d+)", parts[1])
        if m:
            return parts[0], m.group(1), m.group(2)
    return mutant_id, "", ""


def main() -> None:
    try:
        _main()
    except subprocess.CalledProcessError as e:
        print(f"Error running {e.cmd}: {e.stderr}", file=sys.stderr)
        sys.exit(1)


def _main() -> None:
    parser = argparse.ArgumentParser(description="Analyze mutmut survivors")
    parser.add_argument("--venv", help="Path to virtualenv (auto-detected if omitted)")
    parser.add_argument("--module", help="Only report on modules matching this substring")
    parser.add_argument(
        "--max",
        type=int,
        default=50,
        dest="max_per_module",
        help="Cap survivors analysed per module to this many (default: 50)",
    )
    args = parser.parse_args()

    if not Path("mutants").exists():
        print("ERROR: no mutants/ directory — run mutmut run first.", file=sys.stderr)
        sys.exit(1)

    mutmut_bin = find_mutmut(args.venv)
    print("Fetching survivors...", file=sys.stderr)
    survivors = get_survivors(mutmut_bin)

    if not survivors:
        print("No surviving mutants found. All mutations were killed!")
        return

    # Group by module
    by_module: dict[str, list[str]] = defaultdict(list)
    for s in survivors:
        module, _, _ = parse_id(s)
        by_module[module].append(s)

    # ── Header ───────────────────────────────────────────────────────────────
    print(f"{'=' * 62}")
    print("MUTMUT SURVIVORS REPORT")
    print(f"{'=' * 62}\n")
    print(f"Total surviving mutants: {len(survivors)}\n")

    print("BY MODULE  (sorted smallest → largest — most actionable first):")
    for module, ids in sorted(by_module.items(), key=lambda x: len(x[1])):
        flag = ""
        if len(ids) > args.max_per_module:
            flag = f"  [capped at {args.max_per_module}]"
        if args.module and args.module not in module:
            flag = "  [filtered]"
        print(f"  {module:<58} {len(ids):>4}{flag}")

    # ── Detailed analysis ────────────────────────────────────────────────────
    totals: dict[str, int] = defaultdict(int)
    all_real_gaps: list[tuple[str, str]] = []  # (short_id, reason)

    print(f"\n{'=' * 62}")
    print("DETAILED ANALYSIS")
    print(f"{'=' * 62}")

    for module, ids in sorted(by_module.items(), key=lambda x: len(x[1])):
        if args.module and args.module not in module:
            continue
        capped = len(ids) > args.max_per_module
        analysed_ids = ids[: args.max_per_module] if capped else ids
        cap_note = f" [showing first {args.max_per_module} of {len(ids)}]" if capped else ""

        print(f"\n── {module} ({len(ids)} survivors){cap_note} ──")

        for mutant_id in analysed_ids:
            diff = get_diff(mutmut_bin, mutant_id)
            category, reason = classify(diff)
            totals[category] += 1

            _, func, num = parse_id(mutant_id)
            short_id = f"{func}#{num}" if func else mutant_id

            # Show the changed lines (up to 4)
            changed = [
                line
                for line in diff.splitlines()
                if (line.startswith("-") or line.startswith("+"))
                and not line.startswith("---")
                and not line.startswith("+++")
            ]
            preview = "\n    ".join(changed[:4])

            print(f"\n  [{short_id}]  {category}")
            if preview:
                print(f"    {preview}")
            print(f"  → {reason}")

            if category == "REAL_GAP":
                all_real_gaps.append((short_id, reason))

    # ── Summary ──────────────────────────────────────────────────────────────
    analysed_total = sum(totals.values())
    print(f"\n{'=' * 62}")
    print("SUMMARY")
    print(f"{'=' * 62}")
    print(f"  Analysed:                   {analysed_total} of {len(survivors)} surviving mutants")
    print(f"  Real gaps  (tests needed):  {totals['REAL_GAP']}")
    print(f"  Equivalent (accept):        {totals['EQUIVALENT']}")
    print(f"  Untestable (accept):        {totals['UNTESTABLE']}")

    if all_real_gaps:
        print(f"\nReal gaps to fix ({len(all_real_gaps)}):")
        for short_id, reason in all_real_gaps:
            print(f"  - {short_id}: {reason}")


if __name__ == "__main__":
    main()
