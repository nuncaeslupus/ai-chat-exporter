#!/usr/bin/env python3
"""compare_lockfile.py — diff two uv.lock files and classify what changed.

Takes the lockfile from before an upgrade and the lockfile after, and emits a
JSON summary on stdout: which packages were added, removed, or version-bumped,
and for each change whether the package is a *direct* dependency (declared in
pyproject.toml) or *transitive* (pulled in by something else). Transitive churn
is the usual source of "passes locally, breaks on a clean install" surprises,
so separating it from the deps actually requested is the point.

JSON-only on stdout; errors on stderr. Exit 0 when the diff builds; exit 2 on a
usage error (missing file, malformed TOML).
"""

import argparse
import json
import re
import sys
import tomllib
from pathlib import Path

NAME_RE = re.compile(r"^([A-Za-z0-9._-]+)")


def load_lock(path: Path) -> dict[str, str]:
    with path.open("rb") as fh:
        data = tomllib.load(fh)
    packages = data.get("package", [])
    if not isinstance(packages, list):
        return {}
    return {
        pkg["name"]: pkg.get("version", "")
        for pkg in packages
        if isinstance(pkg, dict) and "name" in pkg
    }


def direct_dep_names(pyproject: Path) -> set[str]:
    """Canonical names of every dependency declared in pyproject.toml."""
    if not pyproject.exists():
        return set()
    with pyproject.open("rb") as fh:
        data = tomllib.load(fh)

    specs: list[str] = []
    project = data.get("project", {})
    if isinstance(project, dict):
        deps = project.get("dependencies", [])
        if isinstance(deps, list):
            specs += deps
        opt_deps = project.get("optional-dependencies", {})
        if isinstance(opt_deps, dict):
            for group in opt_deps.values():
                if isinstance(group, list):
                    specs += group
    dep_groups = data.get("dependency-groups", {})
    if isinstance(dep_groups, dict):
        for group in dep_groups.values():
            if isinstance(group, list):
                specs += group
    tool = data.get("tool", {})
    uv = tool.get("uv", {}) if isinstance(tool, dict) else {}
    if isinstance(uv, dict):
        dev_deps = uv.get("dev-dependencies", [])
        if isinstance(dev_deps, list):
            specs += dev_deps

    names = set()
    for spec in specs:
        if not isinstance(spec, str):
            continue
        match = NAME_RE.match(spec.strip())
        if match:
            names.add(match.group(1).lower().replace("_", "-"))
    return names


def build_report(before: dict[str, str], after: dict[str, str], direct: set[str]) -> dict:
    def is_direct(name: str) -> bool:
        return name.lower().replace("_", "-") in direct

    changed = [
        {"name": n, "from": before[n], "to": after[n], "direct": is_direct(n)}
        for n in sorted(before.keys() & after.keys())
        if before[n] != after[n]
    ]
    added = [
        {"name": n, "version": after[n], "direct": is_direct(n)}
        for n in sorted(after.keys() - before.keys())
    ]
    removed = [{"name": n, "version": before[n]} for n in sorted(before.keys() - after.keys())]
    return {
        "changed": changed,
        "added": added,
        "removed": removed,
        "direct_changes": sum(1 for c in changed if c["direct"]),
        "transitive_changes": sum(1 for c in changed if not c["direct"]),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("before", help="uv.lock from before the upgrade (e.g. uv.lock.bak)")
    parser.add_argument("after", help="uv.lock after the upgrade")
    parser.add_argument(
        "--input",
        default="pyproject.toml",
        help="pyproject.toml used to classify direct vs transitive (default: pyproject.toml)",
    )
    args = parser.parse_args()

    try:
        before = load_lock(Path(args.before))
        after = load_lock(Path(args.after))
        direct = direct_dep_names(Path(args.input))
    except FileNotFoundError as exc:
        print(f"✗ {exc}", file=sys.stderr)
        return 2
    except tomllib.TOMLDecodeError as exc:
        print(f"✗ malformed TOML: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"✗ failed to read file: {exc}", file=sys.stderr)
        return 2

    report = build_report(before, after, direct)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
