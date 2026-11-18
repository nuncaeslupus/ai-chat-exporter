---
name: python-bootstrap
description: Scaffolds or retrofits a Python project with uv, ruff, strict mypy and a standard Makefile. Use when the user sets up Python tooling. Not for publishing.
argument-hint: "[project_dir]"
metadata:
  section: python
  type: capability
user-invocable: true
---

# python-bootstrap

Brings a Python project in line with the arsenal defaults — uv, ruff, strict
mypy, the standard Makefile, `requires-python>=3.12` — from scratch or as a
retrofit.

CANARY: python-bootstrap-loaded-2026-06-04-ea39c2b5-394e8afa1019319d

## When to load

Load when a Python repo needs its tooling created or brought up to standard: no
`pyproject.toml` yet, or one missing the ruff select list, the strict mypy
block, or the Makefile targets. Publishing belongs to `pypi-release`, upgrades
to `dep-upgrade`.

## Step 1 — Report the gaps

Run from the target project root, since the script reads the current directory:

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/analyze_project.py" [project_dir]
```

The JSON gives `mode` (`scaffold` without `pyproject.toml`, else `retrofit`),
`ruff.missing_select`, `mypy.missing_keys`, `makefile.missing_targets`,
`requires_python_ok`, and `model_gen`.

## Step 2 — Apply the canonical blocks

Load `references/canonical-config.md` before applying any block: it holds the
pyproject (ruff + mypy), Makefile and uv blocks. Apply only what the report flags:

- Merge into existing `[tool.ruff]` and `[tool.mypy]` tables, keeping the
  project's `per-file-ignores`, extra `select` codes and module overrides.
- Match `target-version`, `python_version` and `requires-python` to what the
  project supports; the flags are defaults, the versions are not.
- Remove `black` when adding `ruff format`, so the two do not fight.
- On an untyped codebase, stage strict mypy with per-module
  `[[tool.mypy.overrides]]` rather than weakening the global block.

When the retrofit writes or changes a CI workflow or the test target, load
`claude-arsenal:core:init § references/ci-minutes.md` (§ CI defaults) first: one
Python version and Linux only on pull requests, parallel pytest.

Then run the project's `make lint` and `make test` (or `uv run ruff check .`
and `uv run mypy .`) to confirm the new config is clean.

## Step 3 — Hand off model specs

If `model_gen.specs_present` is true, the project drives a JSON-spec backend
generator; SQLAlchemy models, Pydantic schemas and FastAPI routes belong to the
model-generator toolkit (`model-gen` / `model-val`). This skill sets up repo
tooling only.
