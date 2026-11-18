# Repository housekeeping — licenses and published packages

Read this when `repo_health.py` reports a missing license or names a package
index, and before publishing a package for the first time. Everything else that
script reports carries its own fix command and needs nothing from here.

- [Choosing a license](#choosing-a-license)
- [Publishing a package](#publishing-a-package)

---

## Choosing a license

The owner chooses; the session's job is to ask the questions that decide it and
say what each answer costs. A repository with no license is not "free to use":
by default nobody may copy, modify or redistribute it, which is occasionally
what the owner wants and usually an accident.

Ask these, in order, and stop at the first that settles it:

1. **Should other people be able to reuse this at all?** No → add no license and
   say so in the README, so the gap is a recorded decision.
2. **Must anyone who distributes a changed version publish their changes too?**
   Yes → a copyleft license: GPL-3.0 for programs, AGPL-3.0 when it runs as a
   network service (GPL does not reach a hosted copy), LGPL-3.0 or MPL-2.0 for a
   library that closed-source programs may still link against.
3. **Does the project hold, or expect contributions that carry, patents?**
   Yes, or unsure and the project is substantial → Apache-2.0, which grants a
   patent license and ends it for anyone who sues. Otherwise → MIT, the shortest
   permissive license and the one most readers already know.

Then check two things before writing the file:

- **Dependencies.** A copyleft dependency constrains the license of what links
  it; a permissive project that vendors GPL code is not permissive any more.
- **Consistency.** The same owner's other repositories are a reasonable default,
  and a different choice here should be deliberate.

Write the full license text to `LICENSE` at the repository root with the year and
the copyright holder's name, and set the matching `license` field in the package
metadata. Content that is not code (documentation, data, artwork) is usually
better served by a Creative Commons license; say so when the repo is mostly that.

This is orientation, not legal advice — say that once when the project is
commercial or the answer to question 3 is unclear.

## Publishing a package

Before the first publish, which claims the name permanently:

- **The name is free.** Look it up on the index. A same-named project that does
  not link to this repository belongs to somebody else: pick another name and set
  it in `[project] name` (the import name need not change).
- **`[project]` is complete**: `description`, `readme`, `license`,
  `requires-python`, and `[project.urls]` with at least
  `Repository = "https://github.com/<owner>/<repo>"`. Without the URL the index
  page cannot link back, and `repo_health.py` cannot tell the package is yours.
- **A license file exists** — see above. An index will accept a package with
  none; its users cannot legally install it into anything.
- **The archive holds only the package.** Build once and list the source
  archive (`uv build && tar tzf dist/*.tar.gz`). A build backend's default is
  often "everything tracked", so vendored tooling, data and agent configuration
  ship to every installer until the backend is told what to include.

### The first publish, in order

Trusted publishing is set up before the project exists on the index, and two of
its steps belong to the owner:

1. **The owner registers a pending publisher** on the index (PyPI: account →
   Publishing → add a pending publisher). It asks for the project name, the
   repository owner and name, the workflow *filename* and an environment name.
   This needs their sign-in; give them the five values rather than attempting it.
2. **Add the release workflow under exactly that filename**, with the publish
   job in exactly that environment. Renaming either later breaks publishing with
   an authentication error that does not mention the name.
3. **Say that merging publishes.** A version number on an index is used once:
   it can be yanked, never replaced. The owner merges the workflow knowing the
   current version goes out with it.
4. **Verify** with `repo_health.py`: the index page links back, the version is
   tagged, the tag has a release, the homepage is set.

A workflow that releases whenever the default branch carries a version with no
tag, so a release is a version bump merged through the usual review:

```yaml
on:
  push: {branches: [main]}
permissions: {contents: read}
concurrency: {group: release, cancel-in-progress: false}
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.v.outputs.version }}
      release: ${{ steps.v.outputs.release }}
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - uses: astral-sh/setup-uv@d4b2f3b6ecc6e67c4457f6d3e41ec42d3d0fcb86 # v5.4.2
      - id: v
        run: |
          ver=$(python3 -c "import tomllib,pathlib; print(tomllib.loads(pathlib.Path('pyproject.toml').read_text())['project']['version'])")
          echo "version=$ver" >> "$GITHUB_OUTPUT"
          git ls-remote --tags --exit-code origin "refs/tags/v$ver" || echo "release=true" >> "$GITHUB_OUTPUT"
      - if: steps.v.outputs.release
        run: make lint test && uv build
      - if: steps.v.outputs.release
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with: {name: dist, path: dist/, if-no-files-found: error}
  publish:
    needs: build
    if: needs.build.outputs.release
    runs-on: ubuntu-latest
    environment: pypi            # the name registered in step 1
    permissions: {id-token: write, contents: write}
    steps:
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0
        with: {name: dist, path: dist/}
      - uses: pypa/gh-action-pypi-publish@7245906fb61fa33a13554f9d5fb856fe61758086 # v1.14.3
      - env: {GH_TOKEN: "${{ github.token }}", VER: "${{ needs.build.outputs.version }}"}
        run: gh release create "v$VER" -R "$GITHUB_REPOSITORY" --target "$GITHUB_SHA" --generate-notes dist/*
```

The tag is created last, by the release, so a failed publish leaves no tag and
the next push retries. Replace `make lint test` with the project's own checks.

On every release:

- **One version, three places.** The version in `pyproject.toml`, the git tag
  `v<version>` and the release on the repository page name the same commit.
  `repo_health.py` reports a published version with no tag and a tag with no
  release.
- **Publish from CI, not from a laptop.** Use the index's trusted publishing
  (OIDC) so no long-lived upload token is stored anywhere; build from the tagged
  commit so the artifact matches the source a reader can see.
- **Set the repository homepage** to the index page, or to the documentation
  site when there is one.
