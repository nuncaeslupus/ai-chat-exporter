#!/usr/bin/env python3
"""select_tests.py — print the tests a change could affect, or all of them when unsure.

    select_tests.py --tests GLOB [--tests GLOB ...] [--ignore GLOB ...]
                    [--always GLOB ...] [--include GLOB ...] [--base REF] [FILE ...]

A default test selector for `preflight-gate`, so a review round runs the tests
its change touches instead of the whole suite:

    preflight-gate = 'pytest $(python3 claude-arsenal/bin/select_tests.py --tests "**/test_*.py")'

An empty selection hands pytest no paths, so it runs everything: safe, not fast.

The changed files are FILE arguments, else $ARSENAL_CHANGED_FILES (what
fast_gate.sh exports), else the diff against the merge-base with --base
(default origin's HEAD branch, else origin/main) plus uncommitted and untracked
files. Each changed file is mapped:

  --always match   every test — a build file, shared fixture, lockfile.
  a test itself    that test.
  --ignore match   nothing — docs, or files no test exercises by design.
  anything else    the tests named after it (`foo.py` -> `test_foo.py`,
                   `foo_test.go`, `foo.spec.ts`, `foo_bar_test.sh`) plus the
                   tests that mention it by name (its basename, or
                   `parent/basename` when the basename is not unique).
                   No such test -> every test.

--include names tests that run in every non-empty selection: the ones that
scan the whole tree (a lint-style test over every script, a link checker)
depend on files they never name, so no mapping can find them.

So it errs one way only: a file it cannot place costs the full suite, not a
skipped test. What it cannot see is indirection — `foo.py` changed, and a test
of `bar.py` that imports `foo` is not selected. That is why this is for
preflight-gate only: host-gate (the full suite) still runs before the PR opens,
and CI after it. No changed files at all also means every test.

Output: one test path per line on stdout, repo-relative; one summary line on
stderr. Exit 0, or 2 on a usage error or outside a git repository.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

_TEST_AFFIXES = (
    ("test_", ""),
    ("", "_test"),
    ("", ".test"),
    ("", ".spec"),
    ("", "_spec"),
    ("", "Test"),
)


def _git(*args: str) -> str:
    out = subprocess.run(["git", *args], capture_output=True, text=True, check=False)
    return out.stdout if out.returncode == 0 else ""


def _glob_re(glob: str) -> re.Pattern[str]:
    """Shell-style: `*` and `?` stay inside one directory, `**/` spans any number."""
    out, i = "", 0
    while i < len(glob):
        if glob.startswith("**/", i):
            out, i = out + "(?:.*/)?", i + 3
        elif glob.startswith("**", i):
            out, i = out + ".*", i + 2
        elif glob[i] == "*":
            out, i = out + "[^/]*", i + 1
        elif glob[i] == "?":
            out, i = out + "[^/]", i + 1
        else:
            out, i = out + re.escape(glob[i]), i + 1
    return re.compile(out)


def _match(path: str, globs: list[str]) -> bool:
    return any(_glob_re(g).fullmatch(path) for g in globs)


def _subject(test: str) -> str:
    """`tests/test_foo_bar.py` -> `foo_bar`: the name a test is named after."""
    stem = Path(test).name.split(".")[0] or Path(test).name
    for pre, suf in _TEST_AFFIXES:
        if pre and stem.startswith(pre):
            return stem[len(pre) :]
        if suf and stem.endswith(suf) and len(stem) > len(suf):
            return stem[: -len(suf)]
    return stem


def _changed(base: str | None) -> list[str]:
    env = os.environ.get("ARSENAL_CHANGED_FILES")
    if env is not None:
        return [line for line in env.splitlines() if line.strip()]
    if not base:
        base = (
            _git("symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD").strip()
            or "origin/main"
        )
    merge_base = _git("merge-base", "HEAD", base).strip()
    if not merge_base:
        print(f"select_tests: no merge-base with {base} — selecting every test", file=sys.stderr)
        return []
    out = (
        _git("diff", "--name-only", "--diff-filter=d", merge_base, "HEAD")
        + _git("diff", "--name-only", "--diff-filter=d", "HEAD")
        + _git("ls-files", "--others", "--exclude-standard")
    )
    return sorted({line for line in out.splitlines() if line.strip()})


def select(
    changed: list[str],
    tests: list[str],
    tracked: list[str],
    ignore: list[str],
    always: list[str],
    include: list[str] | None = None,
) -> tuple[list[str], str]:
    """Return (tests to run, why). Pure, so the test can drive it without git."""
    if not changed:
        return tests, "no changed files"
    test_set = set(tests)
    names: dict[str, int] = {}
    for path in tracked:
        names[Path(path).name] = names.get(Path(path).name, 0) + 1
    bodies: dict[str, str] = {}

    def body(test: str) -> str:
        if test not in bodies:
            try:
                bodies[test] = Path(test).read_text(encoding="utf-8", errors="replace")
            except OSError:
                bodies[test] = ""
        return bodies[test]

    picked = {t for t in tests if _match(t, include or [])}
    for path in changed:
        if _match(path, always):
            return tests, f"{path} matches --always"
        if path in test_set:
            picked.add(path)
            continue
        if _match(path, ignore):
            continue
        p = Path(path)
        stem = p.name.split(".")[0] or p.name
        key = p.name if names.get(p.name, 0) <= 1 or len(p.parts) < 2 else f"{p.parts[-2]}/{p.name}"
        hits = {
            t
            for t in tests
            if (s := _subject(t)) == stem or s.startswith(stem + "_") or key in body(t)
        }
        if not hits:
            return tests, f"no test maps to {path}"
        picked |= hits
    return sorted(picked), f"{len(changed)} changed file(s)"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Print the tests a change could affect.")
    ap.add_argument(
        "files",
        nargs="*",
        help="changed files (default: $ARSENAL_CHANGED_FILES, else the git diff)",
    )
    ap.add_argument(
        "--tests",
        action="append",
        required=True,
        metavar="GLOB",
        help="what a test file looks like",
    )
    ap.add_argument(
        "--ignore", action="append", default=[], metavar="GLOB", help="changes that need no test"
    )
    ap.add_argument(
        "--always", action="append", default=[], metavar="GLOB", help="changes that need every test"
    )
    ap.add_argument(
        "--include", action="append", default=[], metavar="GLOB", help="tests that always run"
    )
    ap.add_argument(
        "--base", help="ref to diff against (default: origin's HEAD branch, else origin/main)"
    )
    args = ap.parse_args(argv)

    top = _git("rev-parse", "--show-toplevel").strip()
    if not top:
        print("select_tests: not inside a git repository", file=sys.stderr)
        return 2
    os.chdir(top)
    tracked = sorted(
        set(
            _git("ls-files").splitlines()
            + _git("ls-files", "--others", "--exclude-standard").splitlines()
        )
    )
    tests = [p for p in tracked if _match(p, args.tests) and Path(p).is_file()]
    changed = args.files or _changed(args.base)
    picked, why = select(changed, tests, tracked, args.ignore, args.always, args.include)
    print(f"select_tests: {len(picked)} of {len(tests)} test(s) — {why}", file=sys.stderr)
    for test in picked:
        print(test)
    return 0


if __name__ == "__main__":
    # A path or a reason line can carry a non-ASCII byte; on a legacy console
    # codepage that must degrade to "?", never take the process down.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
