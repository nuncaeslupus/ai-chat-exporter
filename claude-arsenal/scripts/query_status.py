#!/usr/bin/env python3
"""query_status.py — the board: what is open, claimed, done, and what is blocking.

Reads the task graph from the repository and the state from the GitHub issues the
caller already fetched, so it needs no network of its own and cannot disagree with
what the selector sees — both derive from the same two inputs.

    python3 claude-arsenal/scripts/query_status.py --issues /tmp/issues.json [--detail]

Exit: 0 always; 1 with --fail-on-problems if any task has no gate, no handle, or a
dependency that does not exist.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# task_select.py is the single implementation of "read the graph, derive state",
# and it sits beside this file — in the bundle at runtime, in the init skill's
# assets here. Importing it is what keeps the board and the selector from ever
# disagreeing: both answer from the same code, not from two copies kept in step
# by hand.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from issue_for_task import issue_number_for
from task_select import (
    TERMINAL,
    effective_state,
    load_tasks,
    state_from_issues,
    task_id_from_issue,
    title_index,
)

# The documented size scale, mirroring queue-add's `--size`. A board mixing this
# with any other numbering is reported, not silently sorted.
SIZE_PRIORITIES = frozenset({10, 5, 1, 0})


def blocking(task: dict[str, Any], state: dict[str, str]) -> list[str]:
    return [d for d in task["deps"] if state.get(d) not in TERMINAL]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tasks-dir", type=Path, default=Path("arsenal/tasks"))
    parser.add_argument("--issues", type=Path, help="JSON array of arsenal:task issues")
    parser.add_argument("--detail", action="store_true")
    parser.add_argument(
        "--json",
        action="store_true",
        dest="as_json",
        help="emit one JSON object per task with its DERIVED state, for a host check to consume",
    )
    parser.add_argument("--fail-on-problems", action="store_true")
    parser.add_argument(
        "--pending-merge",
        action="store_true",
        help="a branch, not the default: an archived task whose issue is still open is the "
        "documented in-flight state, not drift",
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
    handles_known = bool(args.issues and args.issues.is_file())
    if handles_known:
        payload = json.loads(args.issues.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            payload = payload.get("issues", [])
        issues = [i for i in payload if isinstance(i, dict)]

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

    counts = {"open": 0, "claimed": 0, "done": 0, "cancelled": 0, "blocked": 0}
    problems: list[str] = []
    notes: list[str] = []
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

    # Completion drift: the task file and its issue disagree about whether the
    # work is finished. Each direction has one cause worth naming, because each
    # is a merge that did half of what it was supposed to.
    for task in tasks:
        actual = issue_state.get(task["id"])
        if actual is None:
            continue
        number = issue_number_for(task["id"], issues, titles=titles)
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
            problems.append(
                f"{task['id']}: {where} is closed as completed but the task file is still live "
                f"in {args.tasks_dir} — move it to _history/ with `status: merged`"
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
                        "path": task["path"],
                        "state": current,
                        "terminal": current in TERMINAL,
                        "gate": task["gate"],
                        "issue": issue_number_for(task["id"], issues, titles=titles),
                        "blocked_by": blocking(task, state),
                    },
                    separators=(",", ":"),
                )
            )
        for problem in problems:
            print(f"query_status: {problem}", file=sys.stderr)
        return 1 if (problems and args.fail_on_problems) else 0

    for note in notes:
        print(f"query_status: {note}", file=sys.stderr)
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
            print(f"  {task['id']}  p{task['priority']:<3} {current:<9} {task['title']}{suffix}")

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

    for warning in warnings:
        print(f"query_status: {warning}", file=sys.stderr)
    for problem in problems:
        print(f"query_status: {problem}", file=sys.stderr)

    if problems and args.fail_on_problems:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
