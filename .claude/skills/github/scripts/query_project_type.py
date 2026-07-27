#!/usr/bin/env python3
"""Detect whether a repo uses GitHub Projects Classic, v2, or none.

Prints one of: classic | v2 | none.

With --write-claude-md, appends or updates a marker comment in the repo's
CLAUDE.md so future sessions skip re-detection:

  <!-- github-skill: projects=v2 -->

Exit codes:
  0 — detection succeeded
  2 — error (gh missing, not authenticated, repo not found, etc.)
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

MARKER_RE = re.compile(r"<!--\s*github-skill:\s*projects=(classic|v2|none)\s*-->")

V2_QUERY = (
    "query($o:String!,$r:String!){"
    " repository(owner:$o,name:$r){ projectsV2(first:1){ totalCount } }"
    "}"
)


def _gh(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    if shutil.which("gh") is None:
        sys.stderr.write("gh CLI not found in PATH\n")
        sys.exit(2)
    return subprocess.run(["gh", *args], text=True, capture_output=True, check=check)


def _default_repo() -> str:
    res = _gh("repo", "view", "--json", "nameWithOwner")
    return str(json.loads(res.stdout)["nameWithOwner"])


def detect(repo: str) -> str:
    owner, name = repo.split("/", 1)

    classic = _gh("api", f"repos/{owner}/{name}/projects", check=False)
    if classic.returncode == 0 and classic.stdout.strip().startswith("["):
        return "classic"

    v2 = _gh(
        "api",
        "graphql",
        "-f",
        f"query={V2_QUERY}",
        "-F",
        f"o={owner}",
        "-F",
        f"r={name}",
        check=False,
    )
    if v2.returncode == 0:
        try:
            total = json.loads(v2.stdout)["data"]["repository"]["projectsV2"]["totalCount"]
            if total and total > 0:
                return "v2"
        except (json.JSONDecodeError, KeyError, TypeError):
            pass
    return "none"


def write_marker(claude_md: Path, kind: str) -> bool:
    if not claude_md.exists():
        sys.stderr.write(f"{claude_md} not found; skipping marker write\n")
        return False
    body = claude_md.read_text()
    if MARKER_RE.search(body):
        new = MARKER_RE.sub(f"<!-- github-skill: projects={kind} -->", body)
        if new != body:
            claude_md.write_text(new)
            return True
        return False
    sep = "" if body.endswith("\n") else "\n"
    claude_md.write_text(body + sep + f"\n<!-- github-skill: projects={kind} -->\n")
    return True


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--repo", help="owner/name (defaults to current repo)")
    p.add_argument(
        "--write-claude-md",
        action="store_true",
        help="append/update the projects=X marker in CLAUDE.md",
    )
    p.add_argument(
        "--claude-md", default="CLAUDE.md", help="path to CLAUDE.md (default: ./CLAUDE.md)"
    )
    args = p.parse_args()

    repo = args.repo or _default_repo()
    kind = detect(repo)
    print(kind)

    if args.write_claude_md:
        wrote = write_marker(Path(args.claude_md), kind)
        verb = "updated" if wrote else "no change to"
        sys.stderr.write(f"{verb} marker in {args.claude_md}: projects={kind}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
