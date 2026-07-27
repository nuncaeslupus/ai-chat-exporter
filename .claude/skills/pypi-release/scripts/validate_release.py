#!/usr/bin/env python3
"""validate_release.py — offline pre-flight checks before a PyPI release.

Reads the project rooted at the current directory and emits a JSON report on
stdout covering the version-drift and stale-artifact footguns that bite right
before an upload:

- declared version (pyproject `[project].version`, or null when dynamic),
- the package's runtime `__version__` (scanned from `__init__.py`),
- whether those agree, and whether they match an intended `--tag`,
- what sits in `dist/` and whether any of it is stale (built for a different
  version than the one about to ship).

It does NOT touch the network — the "is this version already on PyPI?" check
lives in the skill runbook (it needs an index query). JSON-only on stdout;
errors on stderr. Exit 0 when the report builds; exit 2 on usage error.
"""

import argparse
import json
import re
import sys
import tomllib
from pathlib import Path

DUNDER_RE = re.compile(r"""^__version__\s*=\s*['"]([^'"]+)['"]""", re.MULTILINE)


def load_pyproject(root: Path) -> dict:
    path = root / "pyproject.toml"
    if not path.exists():
        raise FileNotFoundError("no pyproject.toml in current directory")
    with path.open("rb") as fh:
        return tomllib.load(fh)


def find_dunder_version(root: Path) -> str | None:
    """Scan the most likely package __init__.py files for __version__."""
    skip_parts = {"tests", "test", "build", "dist", ".venv", "venv", ".tox"}
    candidates = sorted(root.glob("src/*/__init__.py")) + sorted(root.glob("*/__init__.py"))
    for path in candidates:
        # parts are checked relative to root: an absolute path could match a
        # skip dir in an ancestor (e.g. repo cloned under a dir named "build").
        if skip_parts & set(path.relative_to(root).parts):
            continue
        match = DUNDER_RE.search(path.read_text(encoding="utf-8", errors="ignore"))
        if match:
            return match.group(1)
    return None


def _artifact_has_version(artifact: str, version: str) -> bool:
    """Return True only when the artifact filename contains *exactly* this version
    as a delimited segment — not as a prefix of a longer version string.

    Wheel filenames: ``pkg_name-1.2-py3-none-any.whl`` — version is always parts[1]
    because PEP 427 normalises package-name dashes to underscores.
    Sdist filenames: ``pkg_name-1.2.tar.gz`` — version is the *last* dash-segment,
    because package names may contain dashes (e.g. ``my-pkg-1.2.tar.gz``).
    """
    name = artifact
    matched_suffix = None
    for suffix in (".tar.gz", ".whl", ".zip"):
        if name.endswith(suffix):
            matched_suffix = suffix
            name = name[: -len(suffix)]
            break
    if not matched_suffix:
        return False
    parts = name.split("-")
    if len(parts) <= 1:
        return False
    if matched_suffix == ".whl":
        return parts[1] == version
    return parts[-1] == version


def inspect_dist(root: Path, version: str | None) -> dict:
    dist = root / "dist"
    if not dist.is_dir():
        return {"present": False, "artifacts": [], "matching": [], "stale": []}
    artifacts = sorted(p.name for p in dist.iterdir() if p.suffix in {".whl", ".gz"})
    matching = [a for a in artifacts if version and _artifact_has_version(a, version)]
    stale = [a for a in artifacts if version and not _artifact_has_version(a, version)]
    return {
        "present": bool(artifacts),
        "artifacts": artifacts,
        "matching": matching,
        "stale": stale,
    }


def build_report(root: Path, tag: str | None) -> dict:
    pyproject = load_pyproject(root)
    project = pyproject.get("project", {})
    if not isinstance(project, dict):
        project = {}
    name = project.get("name")
    dynamic_fields = project.get("dynamic", [])
    dynamic = isinstance(dynamic_fields, list) and "version" in dynamic_fields
    declared = project.get("version")
    dunder = find_dunder_version(root)

    tag_version = tag.lstrip("v") if tag else None
    reference = declared or dunder
    return {
        "name": name,
        "dynamic_version": dynamic,
        "declared_version": declared,
        "dunder_version": dunder,
        "version_consistent": (
            None if (declared is None or dunder is None) else declared == dunder
        ),
        "tag": tag,
        "tag_matches_version": (
            None if (tag_version is None or reference is None) else tag_version == reference
        ),
        "dist": inspect_dist(root, reference),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--tag", help="Intended git tag to reconcile, e.g. v0.1.1")
    args = parser.parse_args()

    root = Path.cwd()
    try:
        report = build_report(root, args.tag)
    except FileNotFoundError as exc:
        print(f"✗ {exc}", file=sys.stderr)
        return 2
    except tomllib.TOMLDecodeError as exc:
        print(f"✗ malformed pyproject.toml: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
