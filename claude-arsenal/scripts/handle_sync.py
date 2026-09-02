#!/usr/bin/env python3
"""handle_sync.py — find task files that have no issue handle yet.

This is the one sync step the design keeps, and it is worth being precise about
why it is not the old `queue_sync.sh` in a new coat. That script reconciled
*state* in both directions between two copies of a ledger, which is where its
conflicts and its path-traversal bug came from. This one is one-directional and
idempotent: a task file exists, so an issue should point at it. Nothing flows
back, and running it twice changes nothing.

If it never runs, work is delayed — a task nobody opened an issue for is simply
not claimable yet — but nothing is corrupted.

    handle_sync.py --tasks-dir arsenal/tasks --issues /tmp/issues.json

Prints one JSON object per missing handle, ready to create with whatever GitHub
channel the surface offers:

    {"task":"t-3f8a91c2","title":"…","labels":["arsenal:task"],"body":"…"}

A task whose title is a near-match for an issue that resolved to nothing is
reported on stderr instead of proposed: since the board resolves handles by
title as well as by id, "no id resolved" can mean the fold missed rather than
that no issue exists, and a duplicate handle corrupts state where a delay does
not. When SEVERAL tasks fold to that same title the guard cannot say which one
the issue covers, so they are proposed with an `"ambiguous"` key naming the
collision — a person can weigh it, and the unattended caller creates nothing.

Exit: 0 when everything has a handle or the missing ones were printed,
2 on unreadable input.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from task_select import (
    TERMINAL,
    load_tasks,
    loose_title_key,
    task_id_from_issue,
    title_index,
)


def missing_handles(
    tasks: list[dict[str, Any]],
    issues: list[dict[str, Any]],
    *,
    label: str,
    warnings: list[str] | None = None,
) -> list[dict[str, Any]]:
    # Same resolver, same index as the board: an issue that resolves only by
    # title is still a handle, and proposing a second one for the task it
    # already handles is how a narrowed fetch would quietly duplicate the board.
    titles = title_index(tasks)
    handled: set[str] = set()
    unresolved: list[dict[str, Any]] = []
    for issue in issues:
        if task_id := task_id_from_issue(issue, titles=titles):
            handled.add(task_id)
        else:
            unresolved.append(issue)

    # The rest of that thought. Resolution by title is a heuristic, so "no id
    # resolved" no longer means "no issue exists" — it can also mean the fold
    # missed, and this script is the one wired to an action. Proposing a handle
    # for a task that already has one puts two issues on the board claiming a
    # single task's state, which is worse than the delay of not proposing.
    #
    # So an issue that resolved to nothing gets one more, much looser look. If
    # it is a near-match for a task, that task is left alone and reported: a
    # human adds the `arsenal-task:` line and the ambiguity is gone for good.
    near: dict[str, Any] = {}
    for issue in unresolved:
        if key := loose_title_key(issue.get("title") or ""):
            near.setdefault(key, issue.get("number", "?"))

    # Which tasks that guard is allowed to speak for. One unresolved issue
    # cannot be the handle for two tasks, so when two of them fold to the same
    # loose key, "this issue may already be its handle" is true of at most one
    # and the guard cannot say which. Suppressing both hides a handle that is
    # genuinely missing (#190), so they are still proposed — but marked, because
    # a caller that creates them unattended puts a second issue on the board for
    # whichever one the near-match already covered (#239).
    candidates = [
        t
        for t in tasks
        if t["id"] not in handled and str(t.get("status") or "") not in TERMINAL
    ]
    key_users: dict[str, int] = {}
    for task in candidates:
        if key := loose_title_key(task["title"]):
            key_users[key] = key_users.get(key, 0) + 1

    out: list[dict[str, Any]] = []
    for task in tasks:
        if task["id"] in handled:
            continue
        # `load_tasks` includes finished tasks on purpose — their ids must
        # resolve so dependents unblock and their gates stay on disk. But an
        # issue handle carries *state*, and a merged task's state is already
        # final, so it needs no handle. Without this, a repo that has been
        # running a while proposes an issue for every task it ever completed,
        # and a session following the protocol literally opens them: dozens of
        # spurious tasks that read as open and unclaimed, and that a selector
        # will hand straight back out.
        if str(task.get("status") or "") in TERMINAL:
            continue
        ambiguous = ""
        if (key := loose_title_key(task["title"])) in near:
            shared = key_users.get(key, 0)
            if shared < 2:
                if warnings is not None:
                    warnings.append(
                        f"{task['id']}: no handle resolved, but issue #{near[key]} has a "
                        "near-identical title — not proposing a second handle. Add "
                        f"`arsenal-task: {task['id']}` to that issue if it is the handle, or "
                        "make the two titles agree."
                    )
                continue
            ambiguous = (
                f"{shared} task files fold to the same loose title as issue "
                f"#{near[key]}, which is therefore the handle for at most one of "
                f"them. Resolve that before creating this: add `arsenal-task: "
                f"{task['id']}` to #{near[key]} if it is this task's handle, or make "
                "the titles distinct."
            )
            if warnings is not None:
                warnings.append(f"{task['id']}: {ambiguous}")
        row = {
            "task": task["id"],
            "title": task["title"],
            "labels": [label],
            "body": (
                f"`arsenal-task: {task['id']}`\n\n"
                f"Task defined in `{task['path']}`"
            ),
        }
        if ambiguous:
            # Reported, never created on its own: the two callers of this list
            # disagree about what to do next, and only one of them is a person.
            row["ambiguous"] = ambiguous
        out.append(row)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--tasks-dir", type=Path, default=Path("arsenal/tasks"))
    parser.add_argument("--issues", type=Path, required=True, help="JSON array of issues")
    parser.add_argument("--label", default="arsenal:task")
    args = parser.parse_args(argv)

    try:
        payload = json.loads(args.issues.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"handle_sync: cannot read --issues — {exc}", file=sys.stderr)
        return 2
    if isinstance(payload, dict):
        payload = payload.get("issues", [])

    tasks, warnings = load_tasks(args.tasks_dir)
    for warning in warnings:
        print(f"handle_sync: {warning}", file=sys.stderr)

    proposal_warnings: list[str] = []
    rows = missing_handles(
        tasks,
        [i for i in payload if isinstance(i, dict)],
        label=args.label,
        warnings=proposal_warnings,
    )
    for warning in proposal_warnings:
        print(f"handle_sync: {warning}", file=sys.stderr)
    for row in rows:
        print(json.dumps(row, separators=(",", ":")))
    # `rows` is also empty when every missing task was held back, so the
    # all-clear used to be printable directly under a warning naming a task
    # that has no handle — and the reassuring line is the one that gets quoted.
    if not rows and proposal_warnings:
        print(
            f"handle_sync: nothing proposed — {len(proposal_warnings)} task(s) held back "
            "as near-matches for an unresolved issue, listed above",
            file=sys.stderr,
        )
    elif not rows:
        print("handle_sync: every task has an issue handle", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
