# CI minutes — the local gates are the CI

Read this when a repo's GitHub Actions minutes run out (or are about to), when
choosing `merge-policy` for a private repo, when CI is slow, or when writing the host's own CI
workflow. It is the frugal default, not a ban on CI: a repo with minutes to spare
can keep every workflow it has.

- [Where the minutes go](#where-the-minutes-go)
- [Two gate levels](#two-gate-levels) — `host-gate` once, `preflight-gate` per round
- [Host CI: once per PR, not per push](#host-ci-once-per-pr-not-per-push)
- [CI defaults](#ci-defaults) — one version, Linux only, nothing twice
- [merge-policy when minutes are not guaranteed](#merge-policy-when-minutes-are-not-guaranteed)
- [What the queue workflow bills](#what-the-queue-workflow-bills)
- [Measuring it](#measuring-it)

---

## Where the minutes go

A private repo on GitHub Free gets 2,000 Actions minutes a month. GitHub bills
each **job** rounded up to a whole minute (Windows x2, macOS x10); a job whose
`if:` is false never gets a runner and bills nothing. The bill is a product:

    review rounds x a push per fix x the full CI suite per push
      + a billed workflow run per PR event

Measured on one host over two days: its CI, triggered on every push to a PR, ran
56 times at ~2.5 minutes; the queue workflow ran ~124 times, about half of them
billed. That pace empties the free tier in well under a month — and review bots
are no backstop, since some skip repos below a popularity threshold and never
report at all. The checks that always run are the ones on the session's machine.

## Two gate levels

Both live in `arsenal/config.toml`; both are host-defined commands.

| Key | What it is | When it runs |
|---|---|---|
| `host-gate` | The full suite — everything the repo checks. | **Once** before the PR opens (`open_task_pr.sh`, or the `github` skill's pre-PR gate), and once more before merge **only** if commits landed since — a passing run leaves a receipt for its tree, so `--full` over the same tree prints `reused` instead of re-running. |
| `preflight-gate` | Fast and change-scoped: lint/typecheck the changed files, the tests the change selects. | `open_task_pr.sh --preflight`, and **every review round after the first**, on the delta. |

```bash
bash claude-arsenal/bin/fast_gate.sh          # preflight-gate, scoped to the change
bash claude-arsenal/bin/fast_gate.sh --full   # host-gate — reuses a receipt for this tree
```

`fast_gate.sh` exports `ARSENAL_CHANGED_FILES` (one per line, deletions excluded)
and `ARSENAL_GATE_BASE` (the merge-base with the PR base), so a gate can scope
itself: `ruff check $ARSENAL_CHANGED_FILES`, `eslint $ARSENAL_CHANGED_FILES`,
`pytest --picked`. Empty means "check everything", so a scoped command degrades
safely. With no `preflight-gate` it runs `host-gate` and says so.

For the tests, `bin/select_tests.py` is a ready-made selector: it maps each
changed file to the tests named after it or naming it, and prints every test the
moment it meets a file it cannot place, so it costs speed, never coverage.

```toml
preflight-gate = 'pytest $(python3 claude-arsenal/bin/select_tests.py --tests "**/test_*.py")'
```

`--always <glob>` for changes that need the whole suite (a lockfile, a shared
fixture), `--ignore <glob>` for ones no test exercises, `--include <glob>` for
tests that scan the whole tree and so never name the file they would catch. It
cannot follow imports — a change to `foo` misses the test of `bar` that uses it
— which is why it belongs in `preflight-gate` and never in `host-gate`.

**Never re-run the full suite per review round.** The full gate already passed on
everything the round did not touch. A round is: fix every comment it raised, run
the fast gate once, push **once**. One push per round, not one per comment — each
push is a CI run anywhere CI still fires on `synchronize`.

The fast gate is an editing-loop tool, and the caching rule in
`references/evidence-gates.md` still holds for `host-gate`: it certifies *this
tree passes*, so it never skips what it believes a change could not affect.

## Host CI: once per PR, not per push

The bundle ships no CI workflow for the host — the host owns its CI. If it has
one, this is the trigger block that stops it billing per push:

```yaml
on:
  pull_request:
    types: [opened, ready_for_review]
    paths-ignore: ['**/*.md', 'docs/**']
  workflow_dispatch:

concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
```

The trade-off, stated plainly: pushes after the PR opens get no CI run. The local
gates carry those, which is the point. When a CI verdict on the final head is
wanted — before merge, or because a required check now shows "expected" on a new
head — dispatch it once on the branch:

```bash
gh workflow run <ci-file>.yml --ref <branch>
```

A check that is **required** by branch protection and triggered only on `opened`
blocks every PR that was pushed to after opening, until someone dispatches it.
Either dispatch before merge as above, or do not make that check required.

## CI defaults

What a host CI workflow looks like unless the project has a reason otherwise.
Measured across several host repos, these — not the number of tests — were
where slow and expensive CI came from. Each is a default; the override case is
named, and an override is written as a comment in the workflow.

| Default | Override when |
|---|---|
| **Pull requests run one language version: the oldest the project supports.** Newer versions rarely break what the oldest passes. | A PR changes version-conditional code or the supported range — dispatch the full matrix once on that branch. |
| **Pull requests run Linux only.** Windows bills x2 and macOS x10. | The PR touches platform-specific code — gate the extra leg on the files changed, inside a job, so required checks still report. |
| **The full version/OS matrix, release and installer builds, and the slow test tier run on the default branch, nightly or on tags** — never per PR push. | A release-packaging change: dispatch that job once on the branch. |
| **A superseded run is cancelled** (`concurrency` + `cancel-in-progress`, as in the block above). | Runs on the default branch that a release or tag step reads — give each its own group. |
| **Every job has `timeout-minutes`**, a few times its normal duration. A hang otherwise bills for six hours. | None. |
| **No step runs twice.** A typecheck followed by a build that typechecks is one step; a deploy or pages workflow depends on CI (`workflow_run`, `needs`) rather than repeating its tests; two jobs do not both install and build the same thing. | A second run that proves something different (bare interpreter versus dev toolchain) — say which in a comment. |
| **The test runner runs in parallel** across the runner's cores (`pytest -n auto`, the runner's worker setting). | Tests that share state they cannot yet give up — mark those serial, not the suite. |

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    strategy:
      matrix:
        # one version on pull requests; the full range on the default branch
        version: ${{ fromJSON(github.event_name == 'pull_request' && '["<oldest>"]' || '["<oldest>", "<newest>"]') }}
```

`scripts/ci_shape.py` (§ Measuring it) checks the ones a file spells out. The
matching defaults for the tests themselves — what is owed, fixtures built once,
the slow tier — are in the `execution` skill's `references/test-cost.md`.

## merge-policy when minutes are not guaranteed

`after-ci` treats an absent check as "wait" — correctly, since absent is not
green. But on a repo whose minutes can run out, or that has no CI, absent is
the steady state and `after-ci` waits forever. For a private repo on a metered
plan, or a repo with no CI workflow, the recommended setting is:

```toml
merge-policy = "always"
host-gate = "<the full suite>"     # never empty, never "none" here
pre-pr-review = "required"
```

The bar becomes the local gates plus a cold adversarial review of the exact tree
— both enforced by `open_task_pr.sh` before the PR exists. What is given up:
nothing independent of the session's machine re-runs the checks, so a weak
`host-gate` is the only gate. Choose `never` instead when a human must see every
merge. `/init` prints this advice; it never changes an existing value.

## What the queue workflow bills

`arsenal-queue.yml` bills, per task PR: one `keyword-guard` run per push or body
edit once the PR is out of draft (a commit can carry the `Closes` line, so a push
can change the verdict); one `pr-closed` run when it closes; one `sync-handles`
run when the merge lands task files. Plus one `sweep-claims` run a day. Every
other event — ordinary PRs, pushes to feature branches — is a skipped run and
costs nothing. Deleting the file is the supported opt-out
(`references/github-automation.md`).

## Measuring it

```bash
python3 claude-arsenal/scripts/usage_report.py --actions                 # this repo, this month
python3 claude-arsenal/scripts/usage_report.py --actions --repo o/r --since 2026-09-01
```

Per workflow: runs, runs that billed, estimated minutes. It is an estimate from
job timings; the repository's billing page is the authority. Needs `gh`, and
says so without it.

```bash
python3 claude-arsenal/scripts/ci_shape.py            # add --fail-on-problems to gate on it
```

Reads `.github/workflows/` and prints, per push/PR workflow, which of the
*CI defaults* it misses: no `cancel-in-progress`, jobs with no `timeout-minutes`,
a `matrix` with more than one language version or OS on a workflow pull requests
trigger, a macOS or Windows runner on the pull-request path; and as NOTEs, the
same `run:` command in two jobs, and no path filter (a filtered workflow that
carries a required check blocks the PRs it skips).
Run it after writing or changing a workflow, and when CI feels slow, before
suspecting the tests.
