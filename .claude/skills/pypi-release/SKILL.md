---
name: pypi-release
description: Use whenever a Python package is ready to publish to PyPI — the build, twine check, version bump, tag, and upload runbook. Runs validate_release.py to catch version drift (pyproject vs __version__ vs the intended tag) and stale dist/ artifacts before upload. Triggers — "publish to PyPI", "cut a release", "twine upload", "release v1.2.0". Owns scripts — validate_release. Complements the ship skill; Do NOT use this to scaffold project tooling (see python-bootstrap) or to upgrade dependencies (see dep-upgrade).
argument-hint: "--tag vX.Y.Z"
user-invocable: true
---

# pypi-release

Take a Python package from a clean working tree to a published PyPI release:
pre-flight, build, check, dry-run, tag, upload, verify.

CANARY: pypi-release-loaded-2026-06-04-ea39c2b5-820c8d070baea5a5

## When to load

Load when a package is being published or re-published to PyPI (or TestPyPI):
cutting a new version, bumping and tagging, or running `twine upload`.

This is packaging, not promotion. For the pre-merge production sign-off
(compatibility, observability, rollback) defer to the `ship` skill; the two
compose but do not overlap.

## Step 1 — Pre-flight

Run from the project root. The script reconciles the version across
`pyproject.toml`, the package `__version__`, and the tag about to be pushed,
and flags stale `dist/` artifacts:

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/validate_release.py" --tag vX.Y.Z
```

Resolve every mismatch before continuing: `version_consistent: false` means the
declared and `__version__` strings disagree; `tag_matches_version: false` means
the tag does not match the code; `dist.stale` lists artifacts from a previous
version that must be cleared.

Then confirm the version is **not already on PyPI** — uploads are immutable and
a clash fails late:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://pypi.org/pypi/PKG/X.Y.Z/json
# 404 = free to publish; 200 = already taken, bump the version
```

## Step 2 — Clean build + check

```bash
rm -rf dist/                 # never upload alongside stale artifacts
uv build                     # builds sdist + wheel into dist/
uvx twine check dist/*       # validates metadata + long-description rendering
```

## Step 3 — TestPyPI dry-run

Always rehearse on TestPyPI first; it catches metadata and credential problems
without burning a real version:

```bash
uvx twine upload --repository testpypi dist/*
uv run --with PKG --index-url https://test.pypi.org/simple/ \
  --extra-index-url https://pypi.org/simple/ python -c "import PKG; print(PKG.__version__)"
```

## Step 4 — Tag, publish, verify

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
uvx twine upload dist/*
```

Then verify the release is installable from the real index and the version
matches:

```bash
uv run --with PKG==X.Y.Z python -c "import PKG; print(PKG.__version__)"
```

## Gotchas

- **A published version is immutable.** PyPI refuses re-upload of an existing
  `name==version`, even after `yank`. If the upload fails with "File already
  exists", the only fix is a new version — bump, rebuild, re-tag. Catch it in
  Step 1 with the index check, not at upload time.
- **`__version__` drift ships the wrong number.** When `pyproject` says one
  version and the package `__version__` says another, the wheel installs but
  reports a stale version at runtime. The pre-flight flags this; for
  single-source-of-truth use `dynamic = ["version"]` with hatch-vcs rather than
  hand-syncing two strings.
- **Stale `dist/` uploads the previous build.** `twine upload dist/*` globs
  everything in the directory — leftover artifacts from an earlier version get
  pushed too. Always `rm -rf dist/` before `uv build`.
- **Skipping TestPyPI burns a real version.** A long-description that fails to
  render, or a missing classifier, is only visible after upload — and the
  version is then spent. The TestPyPI rehearsal is cheap insurance.
- **Tagging before the upload succeeds.** If the tag is pushed but the upload
  then fails for a fixable reason, the tag no longer matches what is on PyPI.
  Prefer tagging immediately before upload, and delete/move the tag if the
  upload has to be redone under the same version.
- **TestPyPI installs need the fallback index.** TestPyPI rarely hosts a
  package's dependencies; install from it with `--extra-index-url` pointing at
  real PyPI, or the dependency resolution fails and masks a working release.
