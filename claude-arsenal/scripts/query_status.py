#!/usr/bin/env python3
"""query_status.py — the board: what is open, claimed, done, and what is blocking.

Reads the task graph from the repository and the state from the GitHub issues the
caller already fetched, so it cannot disagree with what the selector sees — both
derive from the same two inputs.

It makes one read-only network call of its own: `git ls-remote` for the remote
default branch's tip, to say whether the working tree those task files came from
is current. Nothing is fetched and no ref is written. `--no-remote-check` skips
it; a failure is silent, because a surface with no network still has a board.

    python3 claude-arsenal/scripts/query_status.py --issues /tmp/issues.json [--detail]

Exit: 0 always; 1 with --fail-on-problems if any task has no gate, no handle, or a
dependency that does not exist; 2 if --issues names a file that cannot be read or
parsed.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

# task_select.py is the single implementation of "read the graph, derive state",
# and it sits beside this file — in the bundle at runtime, in the init skill's
# assets here. Importing it is what keeps the board and the selector from ever
# disagreeing: both answer from the same code, not from two copies kept in step
# by hand.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from issue_for_task import issue_numbers_by_task

# The labels themselves, from the modules that own them — both resolve through
# arsenal/config.toml, so a repo that renamed either gets its own names here.
from issue_import import DEFAULT_IMPORT_LABEL as IMPORT_LABEL
from queue_hooks import TASK_LABEL
from task_select import (
    TERMINAL,
    default_tasks_dir,
    effective_state,
    load_tasks,
    read_issue_payload,
    state_from_issues,
    task_id_from_issue,
    title_index,
)

# The documented size scale, mirroring queue-add's `--size`. A board mixing this
# with any other numbering is reported, not silently sorted.
SIZE_PRIORITIES = frozenset({10, 5, 1, 0})


def blocking(task: dict[str, Any], state: dict[str, str]) -> list[str]:
    return [d for d in task["deps"] if state.get(d) not in TERMINAL]


def _git(args: list[str], cwd: Path, timeout: float = 10.0) -> str | None:
    """Run a git command, returning its stdout, or None if it did not succeed.

    Every caller below treats None as "cannot tell" and stays quiet. That is
    deliberate: the surfaces most likely to fail here (no git, no network, a
    detached worktree, a proxy that eats `git://`) are the same surfaces that
    still have a perfectly usable board sitting on disk.
    """
    try:
        done = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout.strip() if done.returncode == 0 else None


def staleness_warning(tasks_dir: Path, remote: str = "origin") -> str | None:
    """Say when the tree these task files were read from is behind the remote.

    The board has a remote source of truth (the issues, fetched fresh every
    session) and a local one (the task files, as of whenever someone last
    pulled), and only the first is guaranteed current. A stale tree and a
    legitimately-open task are indistinguishable from the board: both say "not
    done", and only the tree knows how much is actually left. One session
    redid nineteen already-merged items against a `main` seventeen commits
    behind, and what eventually surfaced it was an unrelated `gh run list` —
    no protocol step could, because no step performed a single operation
    against the remote.

    The check is a `git ls-remote` rather than a fetch: it costs one
    round-trip, mutates nothing, and needs no write access to the object
    store. If the remote tip is not an object we hold, we are behind it (or
    diverged) and cannot say by how much; if we do hold it, we can count.
    """
    root = _git(["rev-parse", "--show-toplevel"], tasks_dir if tasks_dir.is_dir() else Path.cwd())
    if not root:
        return None
    top = Path(root)

    # The remote's published HEAD symref names the default branch. Read it from
    # the same ls-remote that gives us the tip, so a repo whose local
    # `refs/remotes/<remote>/HEAD` was never set still resolves.
    out = _git(["ls-remote", "--symref", remote, "HEAD"], top, timeout=20.0)
    if not out:
        return None
    branch, tip = "", ""
    for line in out.splitlines():
        if line.startswith("ref:"):
            parts = line.split()
            if len(parts) >= 2 and parts[1].startswith("refs/heads/"):
                branch = parts[1][len("refs/heads/") :]
        elif line.endswith("\tHEAD") or line.endswith(" HEAD"):
            tip = line.split()[0]
    if not tip:
        return None
    label = f"{remote}/{branch}" if branch else f"{remote}/HEAD"

    head = _git(["rev-parse", "HEAD"], top)
    if head == tip:
        return None

    if _git(["cat-file", "-e", f"{tip}^{{commit}}"], top) is None:
        return (
            f"board computed from a tree that does not contain {label} ({tip[:8]}) — "
            "fetch first, or every count below is as of an unknown point in the past"
        )

    behind = _git(["rev-list", "--count", f"HEAD..{tip}"], top)
    if not behind or behind == "0":
        return None
    return (
        f"board computed from a tree {behind} commit(s) behind {label} — fetch first; "
        "a task file that is merely stale is indistinguishable from an open task"
    )


def _report(
    notes: list[str],
    warnings: list[str],
    problems: list[str],
    *,
    fail_on_problems: bool,
) -> int:
    """Print every finding on stderr and return the exit code.

    Both output paths end here. The --json branch used to print `problems` and
    return, while `warnings` and `notes` — a duplicate task id, malformed front
    matter, a title collision, the mixed-priority-convention warning — were
    rendered only after it. JSON is the documented cheap-fetch path, so the
    automated caller, the one that cannot notice for itself, was the blind one:
    `--json --fail-on-problems` never learned the board had two tasks sharing
    an id.
    """
    for line in (*notes, *warnings, *problems):
        print(f"query_status: {line}", file=sys.stderr)
    return 1 if (problems and fail_on_problems) else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tasks-dir", type=Path, default=default_tasks_dir())
    parser.add_argument("--issues", type=Path, help="JSON array of arsenal:task issues")
    parser.add_argument(
        "--open-issues",
        type=Path,
        metavar="FILE",
        help="JSON array of OPEN issues carrying neither the task nor the import label — "
        "work that exists but is on no board. Omit it and the check is skipped, and says so.",
    )
    parser.add_argument("--detail", action="store_true")
    parser.add_argument(
        "--json",
        action="store_true",
        dest="as_json",
        help="emit one JSON object per task with its DERIVED state, for a host check to consume",
    )
    parser.add_argument("--fail-on-problems", action="store_true")
    parser.add_argument(
        "--no-remote-check",
        action="store_true",
        help="skip the read-only `git ls-remote` that reports a stale working tree",
    )
    parser.add_argument(
        "--remote",
        default="origin",
        help="remote to measure the tree's freshness against (default: origin)",
    )
    parser.add_argument(
        "--pending-merge",
        action="store_true",
        help="a branch, not the default: an archived task whose issue is still open is the "
        "documented in-flight state, not drift",
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="stamp `status: merged` on archived task files whose issue closed as completed",
    )
    args = parser.parse_args(argv)

    # "I did not ask GitHub" and "GitHub has no handle for this" are different
    # answers, and reporting the first as the second makes the handle check
    # unfailable-and-unpassable: every task reads `no issue handle` because the
    # caller supplied no issue data to look in. That is what `make queue-doctor`
    # does — it has no channel — so the first task file added to a board turned
    # its dogfood into a build that could not go green. The check is skipped,
    # visibly, when there is nothing to check it against.
    issues: list[dict[str, Any]] = []
    # `args.issues` being SET is what says the caller has a channel — not the file
    # happening to exist. Gating on is_file() meant a typo'd or half-written path
    # degraded into "no issue data supplied", and every task then read `no issue
    # handle` as if that were a finding about the board.
    handles_known = bool(args.issues)
    if handles_known:
        # Session-start step 3 runs this straight after the board fetch, so a
        # truncated or unreadable fetch file is a realistic input.
        maybe = read_issue_payload(args.issues, "query_status")
        if maybe is None:
            return 2
        issues = maybe

    tasks, warnings = load_tasks(args.tasks_dir)
    # Both readings, deliberately. `effective_state` lets a task file's terminal
    # status win over its issue, which is right for selection — a merged task
    # must never be handed out again, whatever became of the issue. But that
    # same override hides the case worth reporting: the two sources disagreeing
    # means the completion mechanism did not fire, and the drift is invisible
    # from inside the queue until someone works a task that was already done.
    titles = title_index(tasks)
    issue_state = state_from_issues(issues, titles=titles, warnings=warnings)
    state = effective_state(tasks, issue_state)
    handled = {t for i in issues if (t := task_id_from_issue(i, titles=titles))}
    if tasks and not handles_known:
        print(
            "query_status: no --issues file — issue handles and issue state not checked",
            file=sys.stderr,
        )

    # Printed here rather than appended to `warnings`, because the --json path
    # returns before those are rendered and a stale board is exactly as wrong
    # when a host check is the one reading it.
    if not args.no_remote_check:
        stale = staleness_warning(args.tasks_dir, remote=args.remote)
        if stale:
            print(f"query_status: {stale}", file=sys.stderr)

    # Reviewer exports of this project's specs/plans left in a Downloads folder:
    # review history that is one cleanup away from gone. Read-only, local, and
    # silent when there is none — which is what makes it cheap enough for here.
    try:
        from reader_check import downloads_warnings

        for line in downloads_warnings(Path.cwd()):
            print(f"query_status: {line}", file=sys.stderr)
    except Exception:
        pass

    # Resolved once, for the whole board. Both sites below used to rescan
    # every issue per task.
    handle_numbers = issue_numbers_by_task(issues, titles=titles)

    counts = {"open": 0, "claimed": 0, "done": 0, "cancelled": 0, "blocked": 0}
    problems: list[str] = []
    notes: list[str] = []
    # Work that exists on GitHub and on no board. Every other issue read in this
    # file is filtered to the task label, so an issue carrying neither that nor
    # the import label was invisible to every check the queue has: the board
    # could report `open 0` while real findings sat open, and it did. A note
    # rather than a problem — an issue is allowed to live outside the queue —
    # but never silence, because silence is what let three of them sit.
    if args.open_issues:
        stray = read_issue_payload(args.open_issues, "query_status")
        if stray is None:
            return 2
        if stray:
            listed = ", ".join(f"#{i['number']}" for i in stray if isinstance(i.get("number"), int))
            notes.append(
                f"{len(stray)} open issue(s) are on neither the board nor the import "
                f"path: {listed} — label one `{IMPORT_LABEL}` to import it as a task, "
                f"or `{TASK_LABEL}` if it already has a task file."
            )
    else:
        notes.append(
            "no --open-issues file — issues outside the board were not checked, so "
            "`open 0` here does not mean nothing is outstanding"
        )
    known_ids = {t["id"] for t in tasks}
    for task in tasks:
        current = state.get(task["id"], "open")
        if current == "open" and blocking(task, state):
            counts["blocked"] += 1
        else:
            counts[current] = counts.get(current, 0) + 1
        # Finished work is held to a different standard: it needs no issue to
        # claim it and no gate to run again. Reporting it as a problem would
        # bury the live tasks that genuinely have one.
        if task.get("status") in TERMINAL:
            continue
        if not task["gate"]:
            problems.append(f"{task['id']}: no fenced gate block — nothing would be checked")
        if handles_known and task["id"] not in handled:
            problems.append(f"{task['id']}: no issue handle — not claimable until one exists")
        for dep in task["deps"]:
            if dep not in known_ids:
                problems.append(f"{task['id']}: depends on unknown task {dep}")

    # Mixed priority conventions. `priority` means size (S=10, M=5, L=1); a
    # board seeded from an ordered plan table often encodes build-order rank
    # instead (T1=100, T2=95, …). Both are documented somewhere, neither is
    # wrong alone, and the sort cannot tell them apart — so when both are
    # present, the rank scale's floor sits above the size scale's ceiling and
    # every rank-encoded task outranks every size-encoded one unconditionally.
    # Dispatch order then reflects when a row was written, which is an ordering
    # nobody chose, and nothing errors (#146). The finding is about the MIX: a
    # board that uses one scale throughout stays clean.
    live = [t for t in tasks if t.get("status") not in TERMINAL]
    sized = {t["id"] for t in live if t["priority"] in SIZE_PRIORITIES}
    ranked = {t["id"] for t in live if t["priority"] not in SIZE_PRIORITIES}
    if sized and ranked:
        off = sorted({t["priority"] for t in live if t["id"] in ranked}, reverse=True)
        warnings.append(
            f"mixed-priority-convention: {len(sized)} task(s) use the size scale "
            f"{sorted(SIZE_PRIORITIES, reverse=True)} and {len(ranked)} use other values "
            f"{off} — every value above 10 outranks every sized task regardless of intent. "
            "Put ordering in `deps` and size in `priority`, or move the whole board to one scale."
        )

    # Completion drift: the task file and its issue disagree about whether the
    # work is finished. Each direction has one cause worth naming, because each
    # is a merge that did half of what it was supposed to.
    for task in tasks:
        actual = issue_state.get(task["id"])
        if actual is None:
            continue
        number = handle_numbers.get(task["id"])
        where = f"#{number}" if number else "its issue"
        if task.get("status") in TERMINAL and actual in {"open", "claimed"}:
            # `open_task_pr.sh` archives the task file in the SAME diff that
            # closes its issue, so between opening a PR and merging it, every
            # task that PR finishes reads archived-with-an-open-issue. On a
            # branch that is the protocol working; only on the default branch
            # does it mean a merge did half its job. Without the distinction
            # the documented workflow cannot produce a green PR — the same
            # shape as reporting a missing handle nobody looked for.
            if args.pending_merge:
                notes.append(
                    f"{task['id']}: archived as {task['status']}, {where} still {actual} — "
                    "expected until this branch merges"
                )
            else:
                problems.append(
                    f"{task['id']}: archived as {task['status']} but {where} is still {actual} — "
                    "the PR merged without closing it; close it as completed"
                )
        elif task.get("status") not in TERMINAL and actual == "done":
            # An archive written before `status:` was required is already where
            # it belongs; telling it to move to _history/ names a no-op (#554).
            path = Path(task["path"])
            if "_history" in path.parts and args.fix:
                text = path.read_text(encoding="utf-8")
                path.write_text(text.replace("---\n", "---\nstatus: merged\n", 1), encoding="utf-8")
                notes.append(f"{task['id']}: stamped `status: merged` on {path}")
            elif "_history" in path.parts:
                problems.append(
                    f"{task['id']}: {where} is closed as completed but its archived file has "
                    "no `status:` — add `status: merged` (or rerun with --fix)"
                )
            else:
                problems.append(
                    f"{task['id']}: {where} is closed as completed but the task file is still "
                    f"live in {args.tasks_dir} — move it to _history/ with `status: merged`"
                )

    # The derived answer, for anything outside this repo that needs it.
    #
    # A host's gate verifier wants to know which tasks are finished, and the
    # only thing it can see without this is the task file's `status:` — so it
    # reads that field directly and is then wrong about every task whose issue
    # closed without the file being stamped. Its gate count quietly shrinks and
    # still exits 0, which is the same "second act nobody performed" the queue
    # removed everywhere else. Terminality here is the union: a task is finished
    # if its issue says so OR its file does, because either one is a fact and
    # neither is always available (#171).
    if args.as_json:
        for task in sorted(tasks, key=lambda t: t["id"]):
            current = state.get(task["id"], "open")
            print(
                json.dumps(
                    {
                        "id": task["id"],
                        "title": task["title"],
                        "label": task["label"],
                        "display": task["display"],
                        "path": task["path"],
                        "state": current,
                        "terminal": current in TERMINAL,
                        "gate": task["gate"],
                        "issue": handle_numbers.get(task["id"]),
                        "blocked_by": blocking(task, state),
                    },
                    separators=(",", ":"),
                )
            )
        return _report(notes, warnings, problems, fail_on_problems=args.fail_on_problems)

    print(
        f"tasks: {len(tasks)} — "
        + ", ".join(f"{k} {v}" for k, v in counts.items() if v or k in {"open", "claimed", "done"})
    )

    if args.detail:
        for task in sorted(tasks, key=lambda t: (-int(t["priority"]), t["id"])):
            current = state.get(task["id"], "open")
            blockers = blocking(task, state)
            marks = []
            if blockers:
                marks.append("blocked-by " + ",".join(blockers))
            if not task["gate"]:
                marks.append("no-gate")
            if not handles_known:
                marks.append("handle?")
            elif task["id"] not in handled:
                marks.append("no-handle")
            suffix = f"  [{'; '.join(marks)}]" if marks else ""
            print(f"  {task['id']}  p{task['priority']:<3} {current:<9} {task['display']}{suffix}")

    # explore-idea's backlog, as one line — and nothing at all when the repo has
    # none, since this runs at every session start. Ideas are not tasks; the line
    # only says unspecified work is waiting there.
    try:
        from ideas_log import summary_line

        ideas = summary_line(Path.cwd() / "status" / "ideas.md")
        if ideas:
            print(ideas)
    except Exception:
        pass

    if _report(notes, warnings, problems, fail_on_problems=args.fail_on_problems):
        return 1
    return 0


if __name__ == "__main__":
    # Windows consoles default to a legacy codepage (cp1252 and friends);
    # a non-ASCII line must degrade to "?", never take the process down.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
