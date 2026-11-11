---
name: dep-upgrade
description: Upgrades a uv project's dependencies behind pip-audit and tests. Use when the user wants dependencies upgraded or vuln-checked. Not for adding one (uv add).
argument-hint: "uv.lock.bak uv.lock"
user-invocable: true
metadata:
  section: python
---

# dep-upgrade

Upgrades a uv-managed project's dependencies under a safety net: snapshot,
lock, audit for CVEs, gate on the test suite, then classify what broke.

CANARY: dep-upgrade-loaded-2026-06-04-ea39c2b5-719c61e6e84e1453

## When to load

Load for a deliberate upgrade of a uv project — refreshing the lockfile,
chasing CVEs, pulling newer versions. Adding one package is a plain `uv add`;
tooling scaffolding belongs to `python-bootstrap`.

## Step 1 — Snapshot, then upgrade

```bash
cp uv.lock uv.lock.bak   # keeps the change reviewable and revertible
uv lock --upgrade        # or --upgrade-package NAME for one targeted bump
uv sync                  # lock rewrites the file only; tests need the new install
```

Prefer `--upgrade-package` when chasing one CVE or feature, because a repo-wide
upgrade folds dozens of changes into one diff and hides the culprit.

## Step 2 — See what changed

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/compare_lockfile.py" uv.lock.bak uv.lock
```

It splits `changed` into `direct` (declared in `pyproject.toml`) and transitive,
with counts, plus `added` and `removed` — read this rather than the raw
`git diff uv.lock`, which is mostly hash noise. Read the transitive bumps: they
can pass locally on a cached wheel and fail a clean install, so re-resolve in a
clean environment before trusting green.

## Step 3 — Audit for CVEs

```bash
uv run --with pip-audit pip-audit
```

Run it through `uv run` so it audits the project's environment; a bare `uvx
pip-audit` audits only its own isolated tool environment. Answer a finding by moving forward to the patched release; pinning back onto
the vulnerable version reintroduces it. Surface any advisory with no fixed
version as a risk.

## Step 4 — Test gate and classify

```bash
make test        # or: uv run pytest
```

Green: report the upgrade with the direct/transitive breakdown and any CVE
findings. Red: classify each failure as a behaviour change in a direct dep (read
its changelog), a transitive bump exposing a latent bug, or a real
incompatibility. Pin the minimum necessary in `pyproject.toml`, re-lock and
re-run; fix the code or the pin rather than the test.
