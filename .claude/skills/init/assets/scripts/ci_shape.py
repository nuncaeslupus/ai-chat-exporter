#!/usr/bin/env python3
"""ci_shape.py — does this repo's CI run more often, and for longer, than it needs to?

A slow or expensive CI is usually not a test-count problem. It is the shape of
the workflow: every push starts a full run, a superseded run keeps going, a
docs-only change runs the whole suite, a hung job bills until the platform's
six-hour default, and the costliest runners sit on the pull-request path. Each
is one or two lines of YAML, and none of them shows up in a test report. This
reads `.github/workflows/*.yml` and prints the ones that are missing.

For every workflow triggered by `push` or `pull_request`:

  PROBLEM  no `concurrency` with `cancel-in-progress` — a new push does not
           cancel the run it superseded
  PROBLEM  a job with no `timeout-minutes` — a hang bills for six hours
  PROBLEM  a macOS or Windows runner on the pull_request path — billed at a
           multiple of Linux, on every push
  PROBLEM  a `matrix` listing more than one language version, or more than one
           OS, in a job pull requests reach — the default is one version (the
           oldest supported) and Linux only on pull requests, with the full
           matrix on the default branch, nightly or tags
  NOTE     the same `run:` command in two jobs of one workflow — often a build
           or test done twice. A NOTE because the two may prove different
           things; install and setup commands are left out by a word list.
  NOTE     no `paths` / `paths-ignore` on the trigger — a docs-only change runs
           everything. A NOTE, not a PROBLEM, because a path filter on a
           workflow that carries a *required* check blocks every PR it skips;
           filtering inside a job is the fix there, and this cannot see it.

Read-only. Exit 0 unless `--fail-on-problems` (NOTEs never fail). The last line
is always `outcome: <word>` — ok, problems or skipped.

What it cannot see. There is no YAML parser here on purpose (stdlib only), so
it reads lines and indentation:

  * a runner or matrix computed at run time (`fromJSON(...)`, a reusable
    workflow's own jobs) — it reports what the file spells out. A matrix that
    is computed down to one entry on pull requests is the advised shape and
    reads as nothing to report
  * matrix entries written as flow mappings (`- {os: x, python: y}`), and what
    `exclude:` removes; a matrix key it does not recognise as a language
    version or an OS (the names are in VERSION_KEY_RE / OS_KEYS)
  * the same work done twice under different spellings: a typecheck and then
    a build that typechecks, a step repeated inside one job, a deploy workflow
    that re-runs what the CI workflow ran, a release build that belongs on tags
  * whether the test runner runs in parallel
  * path filtering done inside a job (a `changes` job, `dorny/paths-filter`)
  * whether a job's `if:` keeps it off pull requests, beyond the plain
    `github.event_name` comparisons
  * flow-style mappings nested deeper than the `on:` line, anchors and aliases
  * anything about how long the jobs take — `usage_report.py --actions` has that

Usage:
    ci_shape.py [--repo-root PATH] [--fail-on-problems]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

TRIGGERS = ("push", "pull_request", "pull_request_target")
PR_TRIGGERS = ("pull_request", "pull_request_target")
KEY_RE = re.compile(r"""^(\s*)(?:-\s+)?["']?([A-Za-z0-9_.-]+)["']?\s*:(?:\s+(.*))?$""")
COSTLY_RE = re.compile(r"\b(macos|windows)\b", re.IGNORECASE)
VERSION_KEY_RE = re.compile(
    r"^(?:(?:python|py|node|nodejs|go|golang|ruby|java|jdk|php|rust|toolchain|dotnet|deno|bun"
    r"|elixir|otp|erlang|swift|kotlin|scala|ghc|julia|perl|lua)(?:[-_]?versions?)?|versions?)$",
    re.IGNORECASE,
)
OS_KEYS = ("os", "runs-on", "runner", "platform")
# Commands every job legitimately repeats: fetching the toolchain and the
# dependencies, configuring the checkout. A starting list, not a complete one.
SETUP_RE = re.compile(
    r"\b(install|sync|ci|restore|config|login|cache|mkdir|echo|corepack|rustup|add|fetch)\b"
)
OFF_PR_RE = re.compile(
    r"github\.event_name\s*(?:!=\s*'pull_request'|==\s*'(?:push|schedule|workflow_dispatch)')"
)


def _lines(text: str) -> list[tuple[int, str, str]]:
    """(indent, key, value) for every `key: value` line; comments and blanks dropped."""
    out: list[tuple[int, str, str]] = []
    for raw in text.splitlines():
        line = re.sub(r"\s+#.*$", "", raw.rstrip())
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = KEY_RE.match(line)
        if m:
            out.append((len(m.group(1)), m.group(2), (m.group(3) or "").strip()))
        else:
            out.append((len(line) - len(line.lstrip()), "", line.strip()))
    return out


def _block(lines: list[tuple[int, str, str]], start: int) -> list[tuple[int, str, str]]:
    """The lines nested under lines[start]."""
    indent = lines[start][0]
    end = start + 1
    while end < len(lines) and lines[end][0] > indent:
        end += 1
    return lines[start + 1 : end]


def _children(block: list[tuple[int, str, str]]) -> list[int]:
    """Indexes of the block's direct keys."""
    if not block:
        return []
    indent = min(b[0] for b in block)
    return [i for i, b in enumerate(block) if b[0] == indent and b[1]]


def _cancels(block: list[tuple[int, str, str]]) -> bool:
    return any(k == "cancel-in-progress" and v.lower() != "false" for _, k, v in block)


def _matrix_axes(strategy: list[tuple[int, str, str]]) -> list[str]:
    """`key xN` for each language-version or OS key that the matrix spells out more than once."""
    values: dict[str, set[str]] = {}
    for i, (_, key, value) in enumerate(strategy):
        name = key.lower()
        if not (VERSION_KEY_RE.match(name) or name in OS_KEYS) or "${{" in value:
            continue
        if value.startswith("["):
            items = value.strip("[]").split(",")
        elif value:
            items = [value]  # a scalar: one entry of an `include:` list
        else:
            items = [v[1:] for _, k, v in _block(strategy, i) if not k and v.startswith("-")]
        seen = values.setdefault(name, set())
        seen.update(s for item in items if (s := item.strip().strip("\"'")))
    return [f"{k} x{len(v)}" for k, v in values.items() if len(v) > 1]


def _commands(block: list[tuple[int, str, str]]) -> set[str]:
    """The job's `run:` commands, whitespace-normalised, setup commands left out."""
    out: set[str] = set()
    for i, (_, key, value) in enumerate(block):
        if key != "run":
            continue
        if value[:1] in ("|", ">"):
            value = " ".join(f"{k}: {v}" if k else v for _, k, v in _block(block, i))
        value = " ".join(value.split())
        if value and not SETUP_RE.search(value):
            out.add(value)
    return out


def check(text: str) -> tuple[list[str], list[str]] | None:
    """(problems, notes) for one workflow, or None when push/PR do not trigger it."""
    lines = _lines(text)
    top = {key: i for i, (indent, key, _) in enumerate(lines) if indent == 0 and key}
    if "on" not in top:
        return None
    on_value = lines[top["on"]][2]
    on_block = _block(lines, top["on"])
    events: dict[str, list[tuple[int, str, str]]] = {}
    filtered_inline = False
    if on_value:  # `on: push`, `on: [push, pull_request]`, or a flow mapping
        for name in re.findall(r"[a-z_]+", on_value):
            if name in TRIGGERS:
                events[name] = []
        filtered_inline = "paths" in on_value
    for i in _children(on_block):
        if on_block[i][1] in TRIGGERS:
            events[on_block[i][1]] = _block(on_block, i)
    if not events:
        return None

    problems: list[str] = []
    notes: list[str] = []
    on_pr = any(e in events for e in PR_TRIGGERS)

    jobs = _block(lines, top["jobs"]) if "jobs" in top else []
    job_blocks = {jobs[i][1]: _block(jobs, i) for i in _children(jobs)}

    workflow_cancels = "concurrency" in top and _cancels(_block(lines, top["concurrency"]))
    if not workflow_cancels and not (job_blocks and all(_cancels(b) for b in job_blocks.values())):
        problems.append(
            "no `concurrency` with `cancel-in-progress` — a superseded run keeps running"
        )

    unfiltered = [
        e
        for e, block in events.items()
        if not any(k in ("paths", "paths-ignore") for _, k, _ in block)
    ]
    if unfiltered and not filtered_inline:
        notes.append(
            f"no `paths`/`paths-ignore` on {', '.join(sorted(unfiltered))}"
            " — a docs-only change runs every job"
        )

    no_timeout: list[str] = []
    costly: list[str] = []
    matrices: list[str] = []
    ran: dict[str, list[str]] = {}
    for name, block in job_blocks.items():
        keys = {block[i][1]: i for i in _children(block)}
        if "uses" in keys:  # a reusable-workflow call: its jobs live elsewhere
            continue
        if "timeout-minutes" not in keys:
            no_timeout.append(name)
        for command in _commands(block):
            ran.setdefault(command, []).append(name)
        if not on_pr or "runs-on" not in keys:
            continue
        if "if" in keys and OFF_PR_RE.search(block[keys["if"]][2]):
            continue
        if "strategy" in keys and (axes := _matrix_axes(_block(block, keys["strategy"]))):
            matrices.append(f"{name} ({', '.join(axes)})")
        runner = [block[keys["runs-on"]], *_block(block, keys["runs-on"])]
        if "matrix." in block[keys["runs-on"]][2] and "strategy" in keys:
            runner += _block(block, keys["strategy"])
        hit = next((m.group(1).lower() for _, _, v in runner if (m := COSTLY_RE.search(v))), None)
        if hit:
            costly.append(f"{name} ({hit})")
    if no_timeout:
        problems.append(f"no `timeout-minutes` on: {', '.join(no_timeout)}")
    if costly:
        problems.append(
            f"non-Linux runner on the pull_request path: {', '.join(costly)}"
            " — move it to main-only or gate it on the files changed"
        )
    if matrices:
        problems.append(
            f"matrix on the pull_request path: {', '.join(matrices)}"
            " — one version (the oldest supported) and Linux only on pull requests;"
            " the full matrix on the default branch, nightly or tags"
        )
    for command, names in ran.items():
        if len(names) > 1:
            shown = command if len(command) <= 60 else command[:57] + "..."
            notes.append(
                f"`{shown}` runs in {len(names)} jobs: {', '.join(names)}"
                " — run it once, or say what the second run proves"
            )
    return problems, notes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--fail-on-problems", action="store_true")
    args = parser.parse_args(argv)

    wf_dir = args.repo_root / ".github" / "workflows"
    files = (
        sorted(p for p in wf_dir.glob("*") if p.suffix in (".yml", ".yaml"))
        if wf_dir.is_dir()
        else []
    )
    if not files:
        print(f"ci_shape: no workflows under {wf_dir} — nothing to check")
        print("outcome: skipped")
        return 0

    n_problems = checked = 0
    for path in files:
        try:
            result = check(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError) as exc:
            print(f"NOTE    {path.name}: unreadable ({exc})")
            continue
        if result is None:
            continue
        checked += 1
        problems, notes = result
        n_problems += len(problems)
        for msg in problems:
            print(f"PROBLEM {path.name}: {msg}")
        for msg in notes:
            print(f"NOTE    {path.name}: {msg}")
    if not n_problems:
        print(f"ci_shape: {checked} push/pull_request workflow(s) checked, no problems")
    print(f"outcome: {'problems' if n_problems else 'ok'}")
    return 1 if n_problems and args.fail_on_problems else 0


if __name__ == "__main__":
    # Windows consoles default to a legacy codepage; a non-ASCII line must
    # degrade to "?", never take the process down.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
