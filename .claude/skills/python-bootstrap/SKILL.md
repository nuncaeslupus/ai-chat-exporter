---
name: python-bootstrap
description: Use whenever a Python project needs scaffolding or retrofitting to the arsenal defaults — uv, ruff, strict mypy, the standard Makefile, a 3.12+ floor. Runs analyze_project.py to report the missing pieces and applies them; flags a models/*.json spec dir for model-gen hand-off. Triggers — "set up a Python project", "add ruff and mypy config", "bring this repo up to our standards". Owns scripts — analyze_project. Do NOT use to publish to PyPI (see pypi-release) or to upgrade dependencies (see dep-upgrade).
argument-hint: "[project_dir]"
user-invocable: true
---

# python-bootstrap

Bring a Python project in line with the arsenal defaults — uv, ruff, strict
mypy, the standard Makefile, `requires-python>=3.12` — whether scaffolding from
scratch or retrofitting an existing repo.

CANARY: python-bootstrap-loaded-2026-06-04-ea39c2b5-394e8afa1019319d

## When to load

Load when a Python repo needs its tooling created or brought up to standard:
a fresh project with no `pyproject.toml`, or an existing one missing the ruff
select list, the strict mypy block, or the Makefile targets.

If the request is to *publish* a package, defer to the `pypi-release` skill; if
it is to *upgrade dependencies*, defer to `dep-upgrade`.

## Step 1 — Report the gaps

Run from the target project root (the script reads the current directory by
default, like the other arsenal analysis skills):

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/analyze_project.py" [project_dir]
```

It emits a JSON report: `mode` (`scaffold` if no `pyproject.toml`, else
`retrofit`), per-tool present/missing detail (`ruff.missing_select`,
`mypy.missing_keys`, `makefile.missing_targets`), `requires_python_ok`, and
`model_gen` (whether a `models/*.json` spec dir exists).

## Step 2 — Apply the canonical blocks

Open `references/canonical-config.md` and apply only what the report flags as
missing. **Merge into existing tables — never overwrite a populated
`[tool.ruff]` or `[tool.mypy]` wholesale**; a project may carry its own
`per-file-ignores` or module overrides worth keeping. Match every version
string (`target-version`, `python_version`, `requires-python`) to what the
project actually supports.

After editing, run the project's own `make lint` / `make test` (or the raw
`uv run ruff check .` / `uv run mypy .`) to confirm the new config is clean.

## Step 3 — Hand off a model spec, don't duplicate it

If `model_gen.specs_present` is true, the project drives a JSON-spec backend
generator. Scaffolding SQLAlchemy models, Pydantic schemas, or FastAPI routes
by hand is out of scope — hand off to the model-generator toolkit (`model-gen`
/ `model-val`), which owns that layer. This skill only sets up repo tooling.

## References — load on demand

- [Canonical config](references/canonical-config.md) — load in Step 2; the
  verbatim pyproject (ruff + mypy), Makefile, and uv blocks to apply.

## Gotchas

- **Retrofit clobbers project-specific config.** Pasting the canonical
  `[tool.ruff]` over an existing one silently drops a project's
  `per-file-ignores` or extra `select` codes. Read the current table first and
  merge — add the missing pieces, keep the rest.
- **The flags are defaults; the version strings are not.** Copying
  `target-version = "py312"` / `requires-python = ">=3.12"` into a repo that
  supports 3.9 breaks installs and mis-lints. Always reconcile the versions
  with what the project ships.
- **`black` and `ruff format` fight.** If `black` is configured, retrofitting
  `ruff format` without removing `black` causes format thrash on every commit.
  Drop `black` as part of the change.
- **Strict mypy floods a legacy codebase.** Turning on the strict block over an
  untyped repo can surface thousands of errors at once. Apply per-module
  `[[tool.mypy.overrides]]` to stage adoption rather than weakening the global
  block.
- **Running from the arsenal repo, not the target.** The script reads the
  current directory; launched from this marketplace checkout it reports the
  marketplace's gaps, not the project's. `cd` to the target project first.
