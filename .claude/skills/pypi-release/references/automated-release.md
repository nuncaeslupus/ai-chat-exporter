# Automated release — publish on a version bump

The manual runbook in SKILL.md, done by a workflow: merging a version bump to the
default branch builds, checks, waits for an owner's approval, publishes with
trusted publishing, and creates the tag and release. Nobody holds an upload token
and nobody tags by hand.

## Contents

- [When to prefer it](#when-to-prefer-it)
- [Owner setup, once](#owner-setup-once)
- [The workflow](#the-workflow)
- [Why each piece is there](#why-each-piece-is-there)
- [Gating on green CI](#gating-on-green-ci)

## When to prefer it

Prefer it once a package releases more than occasionally, has more than one
maintainer, or is published from a machine the owner does not control (a cloud
session cannot hold an upload token safely). Keep the manual runbook for a
one-off publish, or while the package's name is still being decided — the
TestPyPI rehearsal (Step 3) stays a manual step either way.

## Owner setup, once

These steps need the owner's sign-in. Give them the values; do not attempt them.

1. **PyPI trusted publisher.** On PyPI: account → Publishing → add a *pending*
   publisher (or, for an existing project, project → Settings → Publishing).
   Values: the project name, the GitHub owner, the repository name, the workflow
   *filename* (`release.yml`) and the environment name (`pypi`). A pending
   publisher does **not** reserve the name — anyone can still claim it until the
   first upload succeeds, so do the first release soon after.
2. **GitHub environment.** Repository → Settings → Environments → New
   environment `pypi`. Add the owner (or a release team) under **Required
   reviewers** — that is the approval gate: the publish job waits for a click.
   Optionally restrict **Deployment branches and tags** to the default branch
   and `v*` tags.
3. **Workflow permissions.** Settings → Actions → General: the workflow asks for
   `contents: write` itself (to create the release); nothing else is needed.

Renaming the workflow file or the environment later breaks publishing with an
authentication error that does not name either — update the PyPI publisher too.

## The workflow

`.github/workflows/release.yml`. Actions are pinned by commit SHA (a tag can be
moved; a SHA cannot) with the version as a comment. The SHAs below were current
when this was written — refresh them with
`git ls-remote https://github.com/<owner>/<action> 'refs/tags/<version>^{}' 'refs/tags/<version>'`
(the `^{}` line, when present, is the commit) or a dependency bot.

```yaml
name: release
on:
  push:
    branches: [main]          # your default branch
    paths: [pyproject.toml]   # a version bump touches it
    tags: ["v*"]              # manual path: push a tag to release that commit
  workflow_dispatch:
permissions: {contents: read}
concurrency: {group: release, cancel-in-progress: false}
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.v.outputs.version }}
      release: ${{ steps.v.outputs.release }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1
      - uses: astral-sh/setup-uv@1c37ad07a6a961277cf70c0d37d6f313000f5884  # v10.3.0
      - id: v
        run: |
          ver=$(python3 -c "import tomllib; print(tomllib.load(open('pyproject.toml','rb'))['project']['version'])")
          echo "version=$ver" >> "$GITHUB_OUTPUT"
          if [ "$GITHUB_REF_TYPE" = tag ]; then
            # The manual path: the tag must name the version the code carries.
            [ "$GITHUB_REF_NAME" = "v$ver" ] || { echo "::error::tag $GITHUB_REF_NAME != v$ver in pyproject.toml"; exit 1; }
            gh release view "v$ver" -R "$GITHUB_REPOSITORY" >/dev/null 2>&1 || echo "release=true" >> "$GITHUB_OUTPUT"
          elif ! git ls-remote --tags --exit-code origin "refs/tags/v$ver" >/dev/null; then
            echo "release=true" >> "$GITHUB_OUTPUT"
          fi
        env: {GH_TOKEN: "${{ github.token }}"}
      - if: steps.v.outputs.release
        run: |
          uv build
          uvx twine check --strict dist/*
      - if: steps.v.outputs.release
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9  # v7.0.2
        with: {name: dist, path: dist/, if-no-files-found: error}
  publish:
    needs: build
    if: needs.build.outputs.release
    runs-on: ubuntu-latest
    environment: pypi                 # the name given to PyPI; holds the required reviewer
    permissions: {id-token: write}    # trusted publishing: no stored token
    steps:
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333  # v8.0.2
        with: {name: dist, path: dist/}
      - uses: pypa/gh-action-pypi-publish@dc37677b2e1c63e2034f94d8a5b11f265b73ba33  # v1.14.2
  github-release:
    needs: [build, publish]
    runs-on: ubuntu-latest
    permissions: {contents: write}
    steps:
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333  # v8.0.2
        with: {name: dist, path: dist/}
      - env: {GH_TOKEN: "${{ github.token }}", VER: "${{ needs.build.outputs.version }}"}
        run: gh release create "v$VER" -R "$GITHUB_REPOSITORY" --target "$GITHUB_SHA" --generate-notes dist/*
```

Add the project's own checks (tests, lint) before `uv build` if CI does not
already gate the merge — see [Gating on green CI](#gating-on-green-ci).

## Why each piece is there

- **Push to the default branch touching `pyproject.toml`.** A release is a
  version bump merged through the usual review. The job asks the remote whether
  `v<version>` exists, so a `pyproject.toml` edit that is not a bump is a no-op.
- **`v*` tags as the manual path**, for re-releasing a commit or recovering from
  an outage. Its tag-vs-version check refuses a tag that names a different
  version than the code — the same drift `validate_release.py` catches by hand.
- **The tag is created last**, by `gh release create`, after the upload. A failed
  publish leaves no tag, so the next push or a manual re-run retries cleanly.
- **A tag created with `GITHUB_TOKEN` does not trigger workflows**, so the tag
  the release creates does not start the `v*` path and publish twice. (A tag
  pushed by a person or a personal token does — that is the manual path.)
- **`twine check --strict`** fails on warnings too, such as a README that will
  not render on PyPI — found before the version is spent, not after.
- **Trusted publishing** (`id-token: write`) exchanges a short-lived OIDC token
  for upload rights scoped to this workflow and environment. Nothing to leak,
  rotate or store in secrets.
- **The `pypi` environment with a required reviewer** is the approval gate: the
  build runs on merge, the upload waits for a person. A version on PyPI is used
  once — it can be yanked, never replaced — so the last step is a human one.
- **`concurrency` without cancel**: two quick merges queue rather than cancel a
  publish half-way through; the second sees the tag and does nothing.
- **Actions pinned by SHA**: the publish job holds upload rights, so a moved tag
  in a third-party action is a supply-chain path straight to the index.

## Gating on green CI

A push-triggered release runs beside CI, not after it: a bump merged on a red
`main` would still build. Two ways to tie the release to a green run of the same
commit:

- **Run the checks in the build job** (`make test` or equivalent before
  `uv build`). Simple; duplicates CI's work.
- **Trigger on CI's completion** instead of on push:
  ```yaml
  on:
    workflow_run: {workflows: [ci], types: [completed], branches: [main]}
  ```
  with `if: github.event.workflow_run.conclusion == 'success'` on the build job
  and `ref: ${{ github.event.workflow_run.head_sha }}` on its checkout (and as
  `--target` for the release). The `paths` filter does not apply to
  `workflow_run`, so the tag check above is what keeps non-bump merges a no-op.
