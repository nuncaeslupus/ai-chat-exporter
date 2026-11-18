#!/usr/bin/env python3
"""reader_check.py — keep every spec and plan paired with a current annotatable reader.

A spec or plan is reviewed through the HTML `create_reader.py` generates, so a
document edited after its reader was built is being reviewed in a version the
reviewer never saw. That is true whichever skill wrote the Markdown — `specify`,
`design`, or a brainstorming/planning skill from another plugin — which is why
the check keys on the path, not on who wrote it.

    reader_check.py hook                 PostToolUse payload on stdin. When the
                                         edited file is a spec or plan, prints the
                                         hook JSON that tells the session its
                                         reader is stale. Exit 0 always.
    reader_check.py branch [--base REF] [--all]
                                         The gate. Exit 1 when a spec or plan that
                                         changed since REF (default: the remote
                                         default branch) has no reader generated
                                         from its current content.
    reader_check.py downloads [--all]    Reviewer exports sitting in a Downloads
                                         folder that this repo does not track.
                                         Exit 0 always.

A spec or plan is any of: `status/specification.md`, `status/plan.md`,
`<home>/project/*/{spec,plan}.md`, `docs/**/specs/*.md`, `docs/**/plans/*.md`
(`<home>` is `ARSENAL_HOME`, default `arsenal`).

Its reader is `<dir>/<repo>-<doc>-v<N>-<stamp>-reader.html`, <doc> being `spec` /
`plan` for the canonical documents and the stem otherwise — or, from before
readers were dated, `<dir>/<stem>-reader.html` / `<dir>/{spec,plan}-reader.html`
(plus `docs/spec-reader/` for a workspace spec). A reader current for the
document carries the document's digest in its `arsenal-source-sha256` meta; one
generated before that meta existed is judged by time instead — newer than the
document passes.

Exit: 0 clean, 1 stale or missing reader (`branch`), 2 usage error.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path, PurePosixPath

META_RE = re.compile(r'<meta name="arsenal-source-sha256" content="([0-9a-f ]*)">')
# `<project>-<spec|plan>-notes-<date>-r<N>.md` (older readers), or the reader's own
# naming, `<repo>-<doc>-v<N>-<YYYY-MM-DD[-HHMM]>-notes.md`.
EXPORT_RE = re.compile(r"^(?P<prefix>.+)-(?:spec|plan)-notes-.+\.md$")
DATED_EXPORT_RE = re.compile(r"^(?P<stem>.+)-v\d+-\d{4}-\d{2}-\d{2}(?:-\d{4})?-notes\.md$")
# Localized names a desktop gives the Downloads folder, beside whatever
# `xdg-user-dir DOWNLOAD` and XDG_DOWNLOAD_DIR report.
DOWNLOAD_NAMES = ("Downloads", "Download", "Descargas", "Téléchargements", "Scaricati")


def _home_parts() -> tuple[str, ...]:
    home = os.environ.get("ARSENAL_HOME", "").strip() or "arsenal"
    return PurePosixPath(home.replace("\\", "/")).parts


def is_doc(rel: str) -> bool:
    """True when the repo-relative path names a spec or plan."""
    p = PurePosixPath(rel.replace("\\", "/"))
    name = p.name
    if (
        not name.endswith(".md")
        or name.endswith(("-annotated.md", "-notes.md"))
        or "-notes-" in name
    ):
        return False
    if str(p) in ("status/specification.md", "status/plan.md"):
        return True
    home = _home_parts()
    parts = p.parts
    if (
        len(parts) == len(home) + 3
        and parts[: len(home)] == home
        and parts[len(home)] == "project"
        and name in ("spec.md", "plan.md")
    ):
        return True
    return len(parts) >= 3 and parts[0] == "docs" and parts[-2] in ("specs", "plans")


def reader_candidates(rel: str) -> list[str]:
    """Repo-relative names (glob patterns for the dated form) a reader of `rel` may have."""
    p = PurePosixPath(rel.replace("\\", "/"))
    kind = "plan" if p.stem == "plan" else "spec"
    doc = kind if p.stem in ("spec", "specification", "plan") else p.stem
    dirs = [p.parent]
    if p.name == "spec.md" and "project" in p.parts:
        dirs.append(PurePosixPath("docs/spec-reader"))
    out = []
    for d in dirs:
        out.append(str(d / f"*-{glob.escape(doc)}-v*-*-reader.html"))
        out += [str(d / f"{p.stem}-reader.html"), str(d / f"{kind}-reader.html")]
    return list(dict.fromkeys(out))


def regenerate_command(rel: str) -> str:
    parent = PurePosixPath(rel.replace("\\", "/")).parent
    return (
        "uv run --with markdown python3 claude-arsenal/scripts/create_reader.py "
        f"--input {rel} --output-dir {parent}"
    )


def _git(root: Path, *args: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(root), *args], capture_output=True, text=True, check=False
        )
    except OSError:
        return None
    return out.stdout if out.returncode == 0 else None


# ---------------------------------------------------------------- hook


def hook(stdin: str) -> int:
    try:
        payload = json.loads(stdin)
    except json.JSONDecodeError:
        return 0
    if not isinstance(payload, dict):
        return 0
    tool_input = payload.get("tool_input") or {}
    raw = tool_input.get("file_path") if isinstance(tool_input, dict) else None
    if not isinstance(raw, str) or not raw:
        return 0
    root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or Path.cwd())
    target = Path(raw)
    if not target.is_absolute():
        target = root / target
    try:
        rel = target.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        top = _git(target.parent, "rev-parse", "--show-toplevel")
        if not top:
            return 0
        try:
            rel = target.resolve().relative_to(Path(top.strip()).resolve()).as_posix()
        except ValueError:
            return 0
    if not is_doc(rel):
        return 0
    msg = (
        f"{rel} changed, so its annotatable reader is stale. Before handing it over or "
        f"building on it, regenerate it — `{regenerate_command(rel)}` — and give the user "
        "the HTML (claude-arsenal/references/annotatable-reader.md)."
    )
    if rel.startswith("docs/"):
        msg += (
            " In an arsenal repo spec work goes through `specify` (status/specification.md) "
            "and plan work through `design` (status/plan.md)."
        )
    print(
        json.dumps(
            {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": msg}}
        )
    )
    return 0


# ---------------------------------------------------------------- branch gate


def _default_base(root: Path) -> str | None:
    head = _git(root, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD")
    candidates = [head.strip()] if head else []
    candidates += ["origin/main", "origin/master", "main", "master"]
    for ref in candidates:
        if _git(root, "rev-parse", "--verify", "--quiet", ref + "^{commit}"):
            return ref
    return None


def _changed_docs(root: Path, base: str | None, all_docs: bool) -> list[str]:
    names: set[str] = set()
    if all_docs or base is None:
        names.update((_git(root, "ls-files") or "").splitlines())
    else:
        names.update((_git(root, "diff", "--name-only", f"{base}...HEAD") or "").splitlines())
        names.update((_git(root, "diff", "--name-only", "HEAD") or "").splitlines())
    names.update((_git(root, "ls-files", "--others", "--exclude-standard") or "").splitlines())
    return sorted(n for n in names if n and is_doc(n) and (root / n).is_file())


def _changed_at(root: Path, rel: str) -> float:
    """When the file last changed: mtime if it has uncommitted edits, else its last commit."""
    path = root / rel
    dirty = _git(root, "status", "--porcelain", "--", rel)
    if not dirty:
        stamp = (_git(root, "log", "-1", "--format=%ct", "--", rel) or "").strip()
        if stamp.isdigit():
            return float(stamp)
    return path.stat().st_mtime


def reader_status(root: Path, rel: str) -> tuple[bool, str]:
    text = (root / rel).read_text(encoding="utf-8")
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    existing = sorted(
        {
            f.relative_to(root).as_posix()
            for pattern in reader_candidates(rel)
            for f in root.glob(pattern)
            if f.is_file()
        }
    )
    if not existing:
        return False, "no reader"
    for cand in existing:
        m = META_RE.search((root / cand).read_text(encoding="utf-8", errors="replace"))
        if m is None:
            if _changed_at(root, cand) >= _changed_at(root, rel):
                return True, cand
        elif digest in m.group(1).split():
            return True, cand
    return False, f"{', '.join(existing)} built from an older version"


def branch(root: Path, base: str | None, all_docs: bool) -> int:
    top = _git(root, "rev-parse", "--show-toplevel")
    if top is None:
        print("reader_check: not a git repository", file=sys.stderr)
        return 2
    root = Path(top.strip())
    if base is None and not all_docs:
        base = _default_base(root)
    docs = _changed_docs(root, base, all_docs)
    stale = []
    for rel in docs:
        ok, why = reader_status(root, rel)
        if not ok:
            stale.append((rel, why))
    if not stale:
        print(f"reader_check: {len(docs)} spec/plan document(s) checked, every reader current")
        return 0
    for rel, why in stale:
        print(f"  ✗ {rel}: {why} — regenerate: {regenerate_command(rel)}")
    print(
        f"reader_check: {len(stale)} spec/plan document(s) changed without a current reader; "
        "regenerate, hand the HTML over, and commit it with the document"
    )
    return 1


# ---------------------------------------------------------------- downloads


def download_dirs() -> list[Path]:
    home = Path.home()
    dirs: list[Path] = []
    env = os.environ.get("XDG_DOWNLOAD_DIR", "").strip()
    if env:
        dirs.append(Path(os.path.expandvars(env)))
    if shutil.which("xdg-user-dir"):
        try:
            out = subprocess.run(
                ["xdg-user-dir", "DOWNLOAD"], capture_output=True, text=True, check=False
            ).stdout.strip()
        except OSError:
            out = ""
        if out:
            dirs.append(Path(out))
    dirs += [home / n for n in DOWNLOAD_NAMES]
    seen: list[Path] = []
    for d in dirs:
        # xdg-user-dir answers $HOME for an unset directory; that is not a Downloads folder.
        if d.is_dir() and d.resolve() != home.resolve() and d.resolve() not in seen:
            seen.append(d.resolve())
    return seen


def _project_prefixes(root: Path) -> set[str]:
    top = (_git(root, "rev-parse", "--show-toplevel") or "").strip()
    names = {Path(top).name if top else root.resolve().name}
    remote = (_git(root, "remote", "get-url", "origin") or "").strip()
    m = re.search(r"([^/:]+?)(?:\.[gG][iI][tT])?/?$", remote)
    if m:
        names.add(m.group(1))
    return {re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-") for n in names} - {""}


def stray_exports(root: Path, all_projects: bool = False) -> list[Path]:
    tracked = {
        PurePosixPath(n).name
        for n in (_git(root, "ls-files") or "").splitlines()
        if "-notes-" in n or n.endswith("-notes.md")
    }
    prefixes = _project_prefixes(root)
    found = []
    for d in download_dirs():
        for f in sorted(set(d.glob("*-notes-*.md")) | set(d.glob("*-notes.md"))):
            if f.name in tracked:
                continue
            m = EXPORT_RE.match(f.name)
            dated = DATED_EXPORT_RE.match(f.name)
            if m:
                ours = m.group("prefix") in prefixes
            elif dated:
                # `<repo>-<doc>`: the repo is a prefix of it, the doc whatever follows.
                ours = any(dated.group("stem").startswith(p + "-") for p in prefixes)
            else:
                continue
            if all_projects or ours:
                found.append(f)
    return found


def downloads_warnings(root: Path, all_projects: bool = False) -> list[str]:
    return [
        f"{f} is a reviewer export this repo does not track — move it beside the spec or "
        "plan it annotates and commit it with the revision it drives"
        for f in stray_exports(root, all_projects)
    ]


# ---------------------------------------------------------------- entry


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("hook", help="PostToolUse payload on stdin")
    b = sub.add_parser("branch", help="fail on a spec/plan changed without a current reader")
    b.add_argument("--base", help="ref to diff against (default: the remote default branch)")
    b.add_argument("--all", action="store_true", help="check every spec/plan, changed or not")
    d = sub.add_parser("downloads", help="reviewer exports left in a Downloads folder")
    d.add_argument("--all", action="store_true", help="any project's exports, not only this one's")
    args = parser.parse_args(argv)
    root = Path.cwd()
    if args.cmd == "hook":
        return hook(sys.stdin.read())
    if args.cmd == "branch":
        return branch(root, args.base, args.all)
    for line in downloads_warnings(root, args.all):
        print(f"  ⚠ {line}")
    return 0


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
