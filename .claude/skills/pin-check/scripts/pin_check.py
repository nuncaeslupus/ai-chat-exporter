#!/usr/bin/env python3
"""pin_check.py — does this test case actually pin the thing it claims to pin?

One deliberate revert, aimed at one claim: change the exact line a fixture says
it holds, run only the case that is supposed to catch it, put it back. If the
case goes red, the claim is pinned. If it stays green, the fixture asserts
something that is merely true.

This is not `mutmut`. `mutmut` generates thousands of mutants and scores the
survivors; this answers one question about one sentence, in seconds rather than
CPU-hours. Same word, different tool, and three orders of magnitude between
their budgets — a project that conflates them either adopts a cost nobody sized
or dismisses the cheap practice because the expensive one looks absurd.

The reason this is a script and not a paragraph is that three of its four
failure modes are invisible to a human doing it by hand, and each one produces a
confident, wrong verdict:

1. THE .pyc MTIME TRAP. CPython validates cached bytecode against the source's
   mtime at *one-second* resolution plus its size. A mutation that swaps two
   equal-length strings and is reverted inside the same second changes neither,
   so the run after the restore executes the MUTATED bytecode. The symmetric
   case is worse: a restored tree reporting green over code that was never
   actually reloaded — a mutation test certifying work it did not do. Closed
   here by deleting every `__pycache__` under the roots before each run and
   running the test with bytecode writing off, so no stale cache can be read
   and none is left behind.

2. THE RESIDENT MODULE. Clearing `__pycache__` does not close this one. A module
   already imported is not re-read whatever is on disk, so a driver whose import
   order left the pre-mutation module loaded scores the unmutated code and calls
   it a survivor. That MANUFACTURES a finding: a session then blocks a PR over
   correct code. Closed by never importing anything here — every run is a fresh
   subprocess.

3. THE UNASSERTED TARGET. A replacement that matches nothing mutates nothing,
   and a green test then reads exactly like "not pinned" when it is in fact
   "not mutated". Closed by counting occurrences first, refusing at zero, and
   verifying the file changed on disk before any test is run.

4. THE ABANDONED MUTATION. A session killed mid-cycle — quota, a crash, a closed
   window — leaves a mutated working tree that the next session reads as the
   code. Closed by restoring in a `finally`, verifying the restored bytes are
   byte-identical to what was read, and holding the original in a sentinel file
   for the whole window so a killed run is recoverable rather than invisible. A
   later run that finds a sentinel refuses to start and says how to restore.

A fifth is not about mutation at all, and is checked first: if the scoped test
is ALREADY failing at the head, its going red under a mutation proves nothing.
That is `INCONCLUSIVE`, not `PINNED`.

Usage:
    pin_check.py --source PATH --replace OLD --with NEW --test TARGET
                 [--expect-count N] [--root DIR] [--verify-restore] [--json]
                 [-- <extra pytest args>]

Exit: 0 PINNED · 1 NOT PINNED · 2 usage or environment error ·
      3 NOT MUTATED (the target is not in the file) ·
      4 INCONCLUSIVE (the test was not green before the mutation, or the
        restore could not be verified).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

SENTINEL_SUFFIX = ".pin_check_active"

PINNED, NOT_PINNED, ERROR, NOT_MUTATED, INCONCLUSIVE = 0, 1, 2, 3, 4


class PinCheckError(Exception):
    """A problem with the request or the tree — never a verdict about the test."""


def _sentinel_for(source: Path) -> Path:
    return source.with_name(source.name + SENTINEL_SUFFIX)


def purge_bytecode(roots: list[Path]) -> int:
    """Delete every `__pycache__` under `roots`. Returns how many went.

    Half of failure mode 1. The other half is `PYTHONDONTWRITEBYTECODE` in the
    run environment: purging before a run stops a stale cache being read, and
    not writing one stops this run leaving a cache that the NEXT run — possibly
    within the same second, against a restored file of identical size — would
    read instead of the source.
    """
    gone = 0
    for root in roots:
        if not root.is_dir():
            continue
        for cache in sorted(root.rglob("__pycache__")):
            shutil.rmtree(cache, ignore_errors=True)
            gone += 1
    return gone


def run_test(test: str, roots: list[Path], extra: list[str], cwd: Path) -> tuple[bool, str]:
    """Run the scoped test in a FRESH subprocess. Returns (passed, last output).

    Fresh, always, and this is failure mode 2: a module that is already imported
    is not re-read no matter what is on disk, so anything that evaluates the
    tree in this process scores the code as it was when the process started.
    """
    purge_bytecode(roots)
    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    cmd = [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", test, *extra]
    try:
        proc = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=1800)
    except FileNotFoundError as exc:  # pragma: no cover - no interpreter is fatal
        raise PinCheckError(f"cannot run pytest: {exc}") from exc
    except subprocess.TimeoutExpired as exc:
        raise PinCheckError(f"the scoped test did not finish in 30 minutes: {exc}") from exc
    tail = (proc.stdout or "")[-2000:] + (proc.stderr or "")[-500:]
    return proc.returncode == 0, tail.strip()


def plan_mutation(source: Path, old: str, new: str, expect_count: int | None) -> tuple[str, int]:
    """Validate the mutation before anything is written. Returns (original, count).

    Failure mode 3 lives here. A `sed` that matches nothing mutates nothing, and
    the green test that follows reads exactly like "not pinned". So the count is
    asserted before anything is written, and `--expect-count` exists for the
    case where the target is real but there are more of it than the claim is
    about — three call sites mutated at once is a different experiment from the
    one being run.
    """
    original = source.read_text(encoding="utf-8")
    count = original.count(old)
    if count == 0:
        raise NotMutated(f"{source}: the target string is not in the file")
    if expect_count is not None and count != expect_count:
        raise NotMutated(
            f"{source}: expected {expect_count} occurrence(s) of the target, found {count} — "
            "mutating all of them is a different experiment"
        )
    mutated = original.replace(old, new)
    if mutated == original:
        raise NotMutated(f"{source}: replacing the target changed nothing (old == new?)")
    return original, count


class NotMutated(PinCheckError):
    """The target was not there, so nothing was tested. Not a verdict."""


def _write(source: Path, text: str) -> None:
    source.write_text(text, encoding="utf-8")
    # Belt and braces for failure mode 1: even with caches purged and bytecode
    # writing off, anything else that caches on (mtime, size) — an editor, a
    # watcher, a build tool — sees a file that genuinely changed.
    now = time.time()
    os.utime(source, (now, now + 1))


def check(
    source: Path,
    old: str,
    new: str,
    test: str,
    roots: list[Path],
    extra: list[str],
    cwd: Path,
    expect_count: int | None,
    verify_restore: bool,
) -> dict[str, Any]:
    sentinel = _sentinel_for(source)
    if sentinel.exists():
        raise PinCheckError(
            f"{sentinel} exists: a previous run was killed mid-cycle and {source} may still "
            f"be mutated. Restore it with\n    cp {sentinel} {source} && rm {sentinel}\n"
            "or check it against git, then re-run."
        )

    original, count = plan_mutation(source, old, new, expect_count)

    # The baseline comes first and is not optional. A scoped test that is already
    # red at the head goes red under any mutation, and reading that as PINNED is
    # a false confirmation — the one direction this tool must never get wrong.
    baseline_ok, baseline_out = run_test(test, roots, extra, cwd)
    if not baseline_ok:
        return {
            "verdict": "INCONCLUSIVE",
            "exit": INCONCLUSIVE,
            "occurrences": count,
            "detail": "the scoped test is already failing before any mutation",
            "output": baseline_out,
        }

    # Failure mode 4: the original is on disk, outside this process, for the
    # whole window in which the tree is mutated.
    sentinel.write_text(original, encoding="utf-8")
    restored = False
    try:
        _write(source, original.replace(old, new))
        if source.read_text(encoding="utf-8") == original:
            raise PinCheckError(f"{source}: the mutation did not reach the file")
        mutated_ok, mutated_out = run_test(test, roots, extra, cwd)
    finally:
        _write(source, original)
        restored = source.read_text(encoding="utf-8") == original
        if restored:
            sentinel.unlink(missing_ok=True)

    if not restored:
        return {
            "verdict": "INCONCLUSIVE",
            "exit": INCONCLUSIVE,
            "occurrences": count,
            "detail": f"{source} could not be restored — the original is held at {sentinel}",
            "output": "",
        }

    if verify_restore:
        # Off by default because it is a third run of the suite for a question
        # the byte comparison above already answered for the FILE. It is worth
        # paying when something outside this script also caches the tree.
        again_ok, again_out = run_test(test, roots, extra, cwd)
        if not again_ok:
            return {
                "verdict": "INCONCLUSIVE",
                "exit": INCONCLUSIVE,
                "occurrences": count,
                "detail": "the test did not go green again after the restore",
                "output": again_out,
            }

    if mutated_ok:
        return {
            "verdict": "NOT PINNED",
            "exit": NOT_PINNED,
            "occurrences": count,
            "detail": f"target present ({count}×), mutated, scoped test still green",
            "output": mutated_out,
        }
    return {
        "verdict": "PINNED",
        "exit": PINNED,
        "occurrences": count,
        "detail": f"target present ({count}×), mutated, scoped test went red",
        "output": mutated_out,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Revert one claim and see whether the test that claims to pin it notices."
    )
    parser.add_argument("--source", required=True, type=Path, help="file to mutate")
    parser.add_argument("--replace", required=True, help="exact text to replace")
    parser.add_argument("--with", dest="replacement", required=True, help="text to replace it with")
    parser.add_argument(
        "--test", required=True, help="the scoped pytest target — a file, or file::case"
    )
    parser.add_argument(
        "--expect-count", type=int, help="refuse unless the target occurs exactly this many times"
    )
    parser.add_argument(
        "--root",
        type=Path,
        action="append",
        default=[],
        help="tree to purge __pycache__ from (repeatable; default: cwd)",
    )
    parser.add_argument("--cwd", type=Path, default=Path(), help="directory to run pytest in")
    parser.add_argument(
        "--verify-restore",
        action="store_true",
        help="re-run the test after restoring (a third run)",
    )
    parser.add_argument("--json", action="store_true")
    parser.add_argument("pytest_args", nargs="*", help="extra args forwarded to pytest")
    args = parser.parse_args(argv)

    source: Path = args.source
    roots = args.root or [args.cwd]

    try:
        if not source.is_file():
            raise PinCheckError(f"{source}: not a file")
        result = check(
            source,
            args.replace,
            args.replacement,
            args.test,
            roots,
            list(args.pytest_args),
            args.cwd,
            args.expect_count,
            args.verify_restore,
        )
    except NotMutated as exc:
        result = {
            "verdict": "NOT MUTATED",
            "exit": NOT_MUTATED,
            "occurrences": 0,
            "detail": str(exc),
            "output": "",
        }
    except PinCheckError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return ERROR
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return ERROR

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"{result['verdict']} — {result['detail']}")
        output = str(result.get("output") or "")
        if output and result["verdict"] in {"INCONCLUSIVE", "NOT PINNED"}:
            print(output)
    return int(result["exit"])


if __name__ == "__main__":
    # Windows consoles default to a legacy codepage (cp1252 and friends);
    # a non-ASCII line must degrade to "?", never take the process down.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
