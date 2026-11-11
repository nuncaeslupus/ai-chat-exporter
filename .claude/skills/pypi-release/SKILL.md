---
name: pypi-release
description: Runs the PyPI release runbook — build, twine check, version bump, tag, upload. Use when the user wants a Python package published. Not for project scaffolding.
argument-hint: "--tag vX.Y.Z"
user-invocable: true
metadata:
  section: python
---

# pypi-release

Takes a Python package from a clean working tree to a published PyPI release:
pre-flight, build, check, rehearse, tag, upload, verify.

CANARY: pypi-release-loaded-2026-06-04-ea39c2b5-820c8d070baea5a5

## When to load

Load when a package is being published to PyPI or TestPyPI. Pre-merge
production sign-off (compatibility, observability, rollback) belongs to the
`ship` skill; the two compose.

Load [automated release](references/automated-release.md) when the project
should publish from CI on a version bump instead of by hand (setting up or
fixing a `release.yml`, trusted publishing, an approval gate) — it holds the
workflow, the owner's one-time setup, and when to prefer it over this runbook.

## Step 1 — Pre-flight

From the project root:

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/validate_release.py" --tag vX.Y.Z
curl -s -o /dev/null -w "%{http_code}\n" https://pypi.org/pypi/PKG/X.Y.Z/json
```

Resolve every mismatch first: `version_consistent: false` means `pyproject.toml`
and `__version__` disagree (`dynamic = ["version"]` with hatch-vcs removes the
second string); `tag_matches_version: false` means the tag does not match the
code; `dist.stale` lists old artifacts. The `curl` should print 404 — a 200
means the version exists, and PyPI never accepts a re-upload of a
`name==version`, even after a yank, so bump instead.

## Step 2 — Clean build and check

```bash
rm -rf dist/                 # twine uploads everything in dist/, old builds included
uv build
uvx twine check dist/*
```

## Step 3 — Rehearse on TestPyPI

Rendering and metadata problems only show after upload, and a real upload
spends the version, so rehearse first:

```bash
uvx twine upload --repository testpypi dist/*
uv run --with PKG --index-url https://test.pypi.org/simple/ \
  --extra-index-url https://pypi.org/simple/ python -c "import PKG; print(PKG.__version__)"
```

The extra index supplies dependencies TestPyPI rarely hosts.

## Step 4 — Tag, publish, verify

Tag immediately before uploading, so a failed upload leaves at most a tag to
move rather than a mismatch with PyPI:

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
uvx twine upload dist/*
uv run --with PKG==X.Y.Z python -c "import PKG; print(PKG.__version__)"
```
