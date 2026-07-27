#!/usr/bin/env python3
"""analyze_project.py — report a Python project's gaps against the arsenal defaults.

Reads the project rooted at the given dir (default: cwd) and emits a JSON gap
report on stdout: which of the canonical tooling pieces (uv, ruff select list,
strict mypy block, Makefile targets, requires-python) are present or missing,
plus whether a `models/*.json` spec dir exists (the model-gen hand-off signal).

JSON-only on stdout; progress/errors on stderr. Exit 0 always when the report
builds (a project with gaps is a valid result, not a failure); exit 2 on a
usage/internal error.
"""

import argparse
import json
import re
import sys
import tomllib
from pathlib import Path

REQUIRED_RUFF_SELECT = ["E", "W", "F", "I", "UP", "RUF", "B", "SIM", "PTH"]
REQUIRED_MYPY_KEYS = [
    "python_version",
    "warn_return_any",
    "warn_unused_configs",
    "disallow_untyped_defs",
    "disallow_incomplete_defs",
    "check_untyped_defs",
    "warn_redundant_casts",
    "warn_unused_ignores",
    "warn_no_return",
    "show_error_codes",
]
REQUIRED_MAKE_TARGETS = ["sync", "build", "lint", "format", "test", "clean"]


def load_pyproject(root: Path) -> dict | None:
    path = root / "pyproject.toml"
    if not path.exists():
        return None
    with path.open("rb") as fh:
        return tomllib.load(fh)


def analyze_ruff(tool: dict) -> dict:
    ruff = tool.get("ruff")
    if not isinstance(ruff, dict):
        return {"present": False, "missing_select": REQUIRED_RUFF_SELECT}
    lint = ruff.get("lint", {})
    select = lint.get("select", []) if isinstance(lint, dict) else []
    if not isinstance(select, list):
        select = []
    return {
        "present": True,
        "missing_select": [code for code in REQUIRED_RUFF_SELECT if code not in select],
        "line_length_ok": ruff.get("line-length") == 100,
        "target_version_present": "target-version" in ruff,
    }


def analyze_mypy(tool: dict) -> dict:
    mypy = tool.get("mypy")
    if not isinstance(mypy, dict):
        return {"present": False, "missing_keys": REQUIRED_MYPY_KEYS}
    return {
        "present": True,
        "missing_keys": [key for key in REQUIRED_MYPY_KEYS if key not in mypy],
    }


def analyze_makefile(root: Path) -> dict:
    path = root / "Makefile"
    if not path.exists():
        return {"present": False, "missing_targets": REQUIRED_MAKE_TARGETS}
    targets: set[str] = set()
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if ":" not in line or line.startswith((" ", "\t", "#")):
            continue
        lhs, _, rhs = line.partition(":")
        # skip variable assignments (VAR =, VAR :=, VAR ::=, VAR :::=); lstrip(": ")
        # consumes the extra colons of GNU Make's ::= / :::= while keeping real
        # double-colon-rule targets (foo:: bar) as targets.
        if "=" in lhs or rhs.lstrip(": ").startswith("="):
            continue
        targets.update(lhs.split())  # a line may declare several targets: "lint format:"
    return {
        "present": True,
        "missing_targets": [t for t in REQUIRED_MAKE_TARGETS if t not in targets],
    }


def build_report(root: Path) -> dict:
    pyproject = load_pyproject(root)
    spec_files = sorted(str(p.relative_to(root)) for p in root.glob("models/*.json"))
    model_gen = {"specs_present": bool(spec_files), "spec_files": spec_files}

    if pyproject is None:
        return {
            "mode": "scaffold",
            "pyproject_present": False,
            "requires_python": None,
            "requires_python_ok": False,
            "ruff": {"present": False, "missing_select": REQUIRED_RUFF_SELECT},
            "mypy": {"present": False, "missing_keys": REQUIRED_MYPY_KEYS},
            "makefile": analyze_makefile(root),
            "uv_lock_present": (root / "uv.lock").exists(),
            "model_gen": model_gen,
        }

    project = pyproject.get("project", {})
    tool = pyproject.get("tool", {})
    if not isinstance(project, dict):
        project = {}
    if not isinstance(tool, dict):
        tool = {}
    requires_python = project.get("requires-python")
    return {
        "mode": "retrofit",
        "pyproject_present": True,
        "requires_python": requires_python,
        "requires_python_ok": isinstance(requires_python, str)
        and bool(re.search(r">=\s*(?:3\.(?:1[2-9]|[2-9]\d+)|[4-9]\d*)", requires_python)),
        "ruff": analyze_ruff(tool),
        "mypy": analyze_mypy(tool),
        "makefile": analyze_makefile(root),
        "uv_lock_present": (root / "uv.lock").exists(),
        "model_gen": model_gen,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "project_dir",
        nargs="?",
        default=".",
        help="Project root to analyze (default: current directory)",
    )
    args = parser.parse_args()

    root = Path(args.project_dir).resolve()
    if not root.is_dir():
        print(f"✗ not a directory: {root}", file=sys.stderr)
        return 2

    try:
        report = build_report(root)
    except tomllib.TOMLDecodeError as exc:
        print(f"✗ malformed pyproject.toml: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
