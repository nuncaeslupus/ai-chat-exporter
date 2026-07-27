---
name: dep-upgrade
description: Use whenever a uv-managed Python project's dependencies need upgrading safely — the uv lock --upgrade, pip-audit (CVEs), test-gate, classify-breakage runbook. Runs compare_lockfile.py to split lockfile churn into direct vs transitive before a transitive bump breaks a clean install. Triggers — "upgrade the dependencies", "bump our packages", "check for vulnerable dependencies". Owns scripts — compare_lockfile.py. Do NOT use to add one dependency (just uv add), scaffold tooling (see python-bootstrap), or publish a release (see pypi-release).
argument-hint: "uv.lock.bak uv.lock"
user-invocable: true
---

# dep-upgrade

Upgrade a uv-managed project's dependencies under a safety net: snapshot, lock,
audit for CVEs, gate on the test suite, then classify whatever broke.

CANARY: dep-upgrade-loaded-2026-06-04-ea39c2b5-719c61e6e84e1453

## When to load

Load when the task is a deliberate dependency *upgrade* of a uv project —
refreshing the lockfile, chasing CVEs, or pulling in newer versions. For adding
one new package, plain `uv add` is enough; for scaffolding tooling defer to the
`python-bootstrap` skill.

## Step 1 — Snapshot, then upgrade

Keep the pre-upgrade lockfile so the change is reviewable and revertible:

```bash
cp uv.lock uv.lock.bak
uv lock --upgrade        # refresh every pin to the latest compatible release
uv sync                  # install the new resolution into the environment
```

To upgrade a single package instead of everything: `uv lock --upgrade-package NAME`.

## Step 2 — See what actually changed

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/compare_lockfile.py" uv.lock.bak uv.lock
```

The JSON splits `changed` into `direct` (declared in `pyproject.toml`) and
transitive, with `direct_changes` / `transitive_changes` counts, plus `added`
and `removed`. Transitive bumps are where "passes locally, breaks on a clean
install" hides — read them, do not skim.

## Step 3 — Audit for CVEs

```bash
uvx pip-audit                 # scans the resolved environment for known CVEs
```

Treat a finding as a reason to upgrade *further* (to the patched version), not
to pin backwards onto the vulnerable release. Note any advisory with no fixed
version as a risk to surface.

## Step 4 — Test gate + classify

Run the project's full suite against the new resolution:

```bash
make test        # or: uv run pytest
```

If green, report the upgrade with the direct/transitive breakdown and any CVE
findings. If red, classify each failure: a behavior change in a direct dep
(read its changelog), a transitive bump that surfaced a latent bug, or a real
incompatibility that needs a constraint. Pin the minimum necessary in
`pyproject.toml`, re-lock, and re-run — never weaken the test to pass.

## Gotchas

- **Transitive churn breaks clean installs only.** A transitive bump can pass
  every local test yet fail `uv sync` on a fresh machine or minimal CI image,
  because the local cache still holds the old wheel. Always check
  `transitive_changes` and re-resolve in a clean environment before trusting
  green.
- **`uv lock --upgrade` moves everything at once.** A repo-wide upgrade folds
  dozens of changes into one diff, making the culprit of a new failure hard to
  isolate. Prefer `--upgrade-package NAME` for a targeted bump when chasing a
  specific CVE or feature.
- **Pinning backwards to dodge a CVE.** Constraining a package to an old,
  vulnerable version to "make pip-audit quiet" reintroduces the vulnerability.
  Move forward to the fixed release; only pin backwards with an explicit,
  documented reason.
- **Lockfile churn buries the signal.** `git diff uv.lock` after an upgrade is
  enormous and mostly hash noise. Use the script's direct/transitive summary to
  find the handful of changes that matter rather than reading the raw diff.
- **Skipping `uv sync` after `uv lock`.** `uv lock --upgrade` rewrites the
  lockfile but does not touch the environment; tests run against the *old*
  installed versions and falsely pass. Always `uv sync` before the test gate.
