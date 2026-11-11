#!/usr/bin/env python3
"""repo_health.py — the usual repository housekeeping, checked instead of remembered.

A repository collects settings nobody revisits: a description, topics, a
homepage link, a default branch called `main`, branch protection, secret
scanning, a release for the newest tag, a package index page that links back.
Each is a minute of work and none of them is anybody's job, so they drift.
This prints the ones that are missing, each with the command that fixes it.

Read-only: it never changes a setting. `/init` runs it once, on the run
that applies `branch_protection.py`; run it by hand at any time.

What it looks at:

  * default branch is `main`, and is protected (public repos; a private repo on
    a plan without protection is not a gap anyone can close)
  * public repos: description, topics, license, secret scanning and push
    protection
  * homepage: unset while the repo has a Pages site or a published package
  * newest version tag has a release
  * a `pyproject.toml` package: whether it is on PyPI, whether that PyPI
    project links back here (a same-named project that does not is somebody
    else's), whether its published version is tagged, and whether `[project]`
    carries what an index page needs — description, readme, license,
    requires-python and a `[project.urls]` entry pointing at this repository

`GAP` is something to fix; `NOTE` is a decision this script cannot make for you
(a package that is simply not meant to be published).

Fails soft, always exit 0 unless `--fail-on-gaps`: no `gh`, no login or no
GitHub remote prints one line. The last line is always `outcome: <word>` — ok,
gaps or skipped.

Usage:
    repo_health.py [--repo OWNER/REPO] [--repo-root PATH] [--fail-on-gaps]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tomllib
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from branch_protection import GhError, _gh_api, _repo_slug

# Overridable so the test can point it at a file:// fixture and stay offline.
PYPI_JSON = os.environ.get("ARSENAL_PYPI_JSON", "https://pypi.org/pypi")


def _say(line: str) -> None:
    print(f"repo_health: {line}")


def _version_key(tag: str) -> tuple[int, ...]:
    return tuple(int(n) for n in re.findall(r"\d+", tag))


def _newest_version_tag(slug: str) -> str | None:
    # ponytail: first 100 tags only; paginate if a repo with more ever misreports.
    tags = [t["name"] for t in _gh_api(f"repos/{slug}/tags?per_page=100")]
    versioned = [t for t in tags if re.fullmatch(r"v?\d+(\.\d+)+", t)]
    return max(versioned, key=_version_key) if versioned else None


def _project(repo_root: Path) -> dict[str, Any]:
    """The `[project]` table of pyproject.toml, {} when there is none."""
    try:
        data = tomllib.loads((repo_root / "pyproject.toml").read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return {}
    project = data.get("project")
    return project if isinstance(project, dict) else {}


def _metadata_missing(project: dict[str, Any], slug: str) -> list[str]:
    """What a package index page needs from `[project]` and does not find."""
    missing = [key for key in ("description", "readme", "requires-python") if not project.get(key)]
    if not (project.get("license") or project.get("license-files")):
        missing.append("license")
    urls = " ".join(str(u) for u in (project.get("urls") or {}).values())
    if slug.lower() not in urls.lower():
        missing.append(f'[project.urls] Repository = "https://github.com/{slug}"')
    return missing


def _pypi(name: str) -> dict[str, Any] | None:
    """The package's PyPI metadata, {} when it is not published, None when unknown."""
    try:
        with urllib.request.urlopen(f"{PYPI_JSON}/{name}/json", timeout=10) as resp:
            info = json.load(resp).get("info", {})
            return info if isinstance(info, dict) else None
    except urllib.error.HTTPError as exc:
        return {} if exc.code == 404 else None
    except (OSError, ValueError):
        return {} if PYPI_JSON.startswith("file:") else None


def check(repo_root: Path, slug: str) -> list[str]:
    """Every finding as a printable line; raises GhError when the repo is unreadable."""
    info = _gh_api(f"repos/{slug}")
    branch = info.get("default_branch") or "main"
    public = not info.get("private")
    out: list[str] = []

    def gap(what: str, fix: str) -> None:
        out.append(f"GAP {what} — fix: {fix}")

    if branch != "main":
        gap(
            f"default branch is `{branch}`, not `main`",
            f"gh api -X POST repos/{slug}/branches/{branch}/rename -f new_name=main",
        )
    try:
        _gh_api(f"repos/{slug}/branches/{branch}/protection")
    except GhError as exc:
        # 403 is a plan that does not offer protection here: not a closable gap.
        if exc.status == 404 and "branch not found" not in str(exc).lower():
            gap(
                f"`{branch}` is unprotected: anyone with write access can push to it",
                "branch_protection.py",
            )

    if public:
        if not info.get("description"):
            gap("no description", f'gh repo edit {slug} --description "…"')
        if not info.get("topics"):
            gap("no topics (how the repo is found in search)", f"gh repo edit {slug} --add-topic …")
        if not info.get("license"):
            gap(
                "no license file GitHub recognises: nobody may legally reuse this code",
                "choose one with the owner (references/repo-housekeeping.md), add LICENSE",
            )
        security = info.get("security_and_analysis") or {}
        off = [
            key
            for key in ("secret_scanning", "secret_scanning_push_protection")
            if security.get(key, {}).get("status") == "disabled"
        ]
        if off:
            fields = " ".join(f"-f 'security_and_analysis[{k}][status]=enabled'" for k in off)
            gap(f"{' and '.join(off)} disabled", f"gh api -X PATCH repos/{slug} {fields}")

    homepage = info.get("homepage")
    if info.get("has_pages") and not homepage:
        try:
            url = _gh_api(f"repos/{slug}/pages").get("html_url") or "<pages url>"
        except GhError:
            url = "<pages url>"
        gap(
            "a Pages site exists but the homepage is unset", f"gh repo edit {slug} --homepage {url}"
        )

    try:
        tag = _newest_version_tag(slug)
    except GhError:
        tag = None
    if tag:
        try:
            _gh_api(f"repos/{slug}/releases/tags/{tag}")
        except GhError as exc:
            if exc.status == 404:
                gap(
                    f"tag {tag} has no release, so the repo page shows an older one or none",
                    f"gh release create {tag} -R {slug} --verify-tag --generate-notes",
                )

    project = _project(repo_root) if public else {}
    name = project.get("name") if isinstance(project.get("name"), str) else None
    pypi = _pypi(name) if name else None
    missing = ", ".join(_metadata_missing(project, slug))
    if name and pypi == {}:
        out.append(
            f"NOTE package `{name}` (pyproject.toml) is not on PyPI — publish it if it is "
            "meant to be installed; nothing to do otherwise"
            + (f". Before a first publish, pyproject.toml needs: {missing}" if missing else "")
        )
    elif name and pypi:
        if missing:
            gap(
                f"`{name}` is a published name and pyproject.toml lacks: {missing}",
                "add them under [project], then publish a new version",
            )
        links = " ".join(
            [str(pypi.get("home_page") or ""), *(pypi.get("project_urls") or {}).values()]
        )
        if slug.lower() not in links.lower():
            out.append(
                f"NOTE the PyPI project `{name}` does not link to {slug} — publish a version "
                "built with [project.urls] set, or the name is somebody else's and needs changing"
            )
        else:
            version = str(pypi.get("version") or "")
            if not homepage and not info.get("has_pages"):
                gap(
                    "published on PyPI but the homepage is unset",
                    f"gh repo edit {slug} --homepage https://pypi.org/project/{name}/",
                )
            if version and (not tag or _version_key(tag) < _version_key(version)):
                gap(
                    f"PyPI has {name} {version} but no tag for it",
                    f"git tag v{version} <commit> && git push origin v{version}",
                )
    return out


def run(repo_root: Path, repo: str | None) -> str:
    slug = _repo_slug(repo_root, repo)
    if not slug:
        _say("no GitHub remote — nothing to check.")
        return "skipped"
    if shutil.which("gh") is None:
        _say("`gh` is not installed — repository settings not checked.")
        return "skipped"
    try:
        findings = check(repo_root, slug)
    except GhError as exc:
        _say(f"cannot read {slug} ({exc}) — repository settings not checked.")
        return "skipped"
    for line in findings:
        _say(line)
    gaps = sum(line.startswith("GAP") for line in findings)
    if not gaps:
        _say(f"{slug}: nothing missing.")
    return "gaps" if gaps else "ok"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", help="OWNER/REPO; default: the origin remote.")
    parser.add_argument("--repo-root", type=Path, default=Path(), help="The host checkout.")
    parser.add_argument("--fail-on-gaps", action="store_true", help="Exit 1 when a GAP is found.")
    args = parser.parse_args(argv)
    outcome = run(args.repo_root, args.repo)
    print(f"outcome: {outcome}")
    return 1 if args.fail_on_gaps and outcome == "gaps" else 0


if __name__ == "__main__":
    # Windows consoles default to a legacy codepage (cp1252 and friends);
    # a non-ASCII line must degrade to "?", never take the process down.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
