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

    {"task":"t-3f8a91c2","title":"…","labels":["arsenal:task","arsenal-id:t-3f8a91c2"],"body":"…"}

A task whose title is a near-match for an issue that resolved to nothing is
reported on stderr instead of proposed: the board still resolves handles by
title where no `arsenal-id:` label has been stamped yet, so "no id resolved" can
mean the fold missed rather than that no issue exists, and a duplicate handle
corrupts state where a delay does not. When SEVERAL tasks fold to that same
title the guard cannot say which one the issue covers, so they are proposed with
an `"ambiguous"` key naming the collision — a person can weigh it, and the
unattended caller creates nothing.

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

from arsenal_config import setting
from task_select import (
    ID_LABEL_PREFIX,
    TERMINAL,
    default_tasks_dir,
    load_tasks,
    loose_title_key,
    read_issue_payload,
    task_id_from_body,
    task_id_from_issue,
    task_id_from_labels,
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
    by_title = 0
    for issue in issues:
        if task_id := task_id_from_issue(issue, titles=titles):
            handled.add(task_id)
            if not (task_id_from_labels(issue) or task_id_from_body(issue)):
                by_title += 1
        else:
            unresolved.append(issue)

    # Said once, not per issue, and said here because this is the script whose
    # output a caller turns into a new issue. A pairing that rests on the title
    # is one rename away from reporting the task as having no handle at all —
    # and that report reads as an instruction to open a second one.
    if by_title and warnings is not None:
        warnings.append(
            f"{by_title} issue(s) resolved to their task by title alone — renaming "
            "either side unpairs them, and an unpaired task is reported here as "
            f"having no handle. The `{ID_LABEL_PREFIX}<id>` label is exact and travels "
            "in the fields a body-less fetch already asks for; `queue_hooks.py "
            "sync-handles` stamps it from the body marker."
        )

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
        t for t in tasks if t["id"] not in handled and str(t.get("status") or "") not in TERMINAL
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
                        "near-identical title — not proposing a second handle. Label "
                        f"that issue `{ID_LABEL_PREFIX}{task['id']}` if it is the handle, or "
                        "make the two titles agree."
                    )
                continue
            ambiguous = (
                f"{shared} task files fold to the same loose title as issue "
                f"#{near[key]}, which is therefore the handle for at most one of "
                f"them. Resolve that before creating this: label #{near[key]} "
                f"`{ID_LABEL_PREFIX}{task['id']}` if it is this task's handle, or make "
                "the titles distinct."
            )
            if warnings is not None:
                warnings.append(f"{task['id']}: {ambiguous}")
        row = {
            "task": task["id"],
            "title": task["title"],
            # The board label is what makes the issue claimable work; the id
            # label is what keeps it attached to this task after either side is
            # renamed. Both are set at creation so a handle opened here never
            # depends on its title.
            "labels": [label, f"{ID_LABEL_PREFIX}{task['id']}"],
            "body": (f"`arsenal-task: {task['id']}`\n\nTask defined in `{task['path']}`"),
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
    parser.add_argument("--tasks-dir", type=Path, default=default_tasks_dir())
    parser.add_argument("--issues", type=Path, required=True, help="JSON array of issues")
    parser.add_argument("--label", default=setting("task-label"))
    args = parser.parse_args(argv)

    payload = read_issue_payload(args.issues, "handle_sync")
    if payload is None:
        return 2

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
    # The by-title notice shares the list; only near-match warnings are hold-backs.
    held = [w for w in proposal_warnings if "not proposing a second handle" in w]
    if not rows and held:
        print(
            f"handle_sync: nothing proposed — {len(held)} task(s) held back "
            "as near-matches for an unresolved issue, listed above",
            file=sys.stderr,
        )
    elif not rows:
        print("handle_sync: every task has an issue handle", file=sys.stderr)
    return 0


if __name__ == "__main__":
    # Windows consoles default to a legacy codepage (cp1252 and friends);
    # a non-ASCII line must degrade to "?", never take the process down.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
