# Canonical config blocks

Load when applying or repairing a project's tooling. These are the exact
blocks `analyze_project.py` checks against — copy them verbatim, then adjust
only the version strings (`target-version` / `python_version` /
`requires-python`) to whatever the project actually supports. The *flags* are
the defaults; the version strings are not.

## `pyproject.toml` — build backend + Python floor

```toml
[project]
name = "PROJECT_NAME"
version = "0.1.0"
requires-python = ">=3.12"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

`requires-python = ">=3.12"` unless the project must support older Pythons.

## `pyproject.toml` — Ruff (lint + format)

```toml
[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = [
    "E",   # pycodestyle errors
    "W",   # pycodestyle warnings
    "F",   # pyflakes
    "I",   # isort
    "UP",  # pyupgrade
    "RUF", # ruff-specific
    "B",   # flake8-bugbear (real bug patterns)
    "SIM", # flake8-simplify (cleaner equivalents)
    "PTH", # flake8-use-pathlib (prefer Path.open over open)
]
```

`ruff format` is the canonical formatter. Do **not** add `black` alongside it.

When a rule group generates unfixable noise in a large legacy codebase, narrow
it via `[tool.ruff.lint.per-file-ignores]` rather than dropping the group, and
leave a comment saying why.

## `pyproject.toml` — Mypy (strict-by-default)

```toml
[tool.mypy]
python_version = "3.12"
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true
disallow_incomplete_defs = true
check_untyped_defs = true
warn_redundant_casts = true
warn_unused_ignores = true
warn_no_return = true
show_error_codes = true
```

## Makefile

The Makefile is the entry point for every routine action. Required targets:
`sync`, `build`, `lint`, `format`, `test`, `clean`. Add `publish: build` only
when the project ships to PyPI (the `pypi-release` skill owns that runbook).

```makefile
.PHONY: sync build lint format test clean

sync:
	uv sync

build:
	uv build

lint:
	uv run ruff check .
	uv run mypy .

format:
	uv run ruff format .
	uv run ruff check --fix .

test:
	uv run pytest

clean:
	rm -rf dist build .mypy_cache .pytest_cache .ruff_cache
	find . -type d -name __pycache__ -exec rm -rf {} +
```

## uv

Use `uv` for dependency management. `uv sync` installs; `uv add PKG` adds a
dependency and updates `uv.lock`; `uv run CMD` runs inside the project env.
Commit `uv.lock` after any dependency change.
