#!/usr/bin/env python3
"""issue_for_task.py — which issue is the handle for a task.

The queue's completion mechanism is `Closes #<issue>` in a task PR: GitHub
closes the issue when the PR merges, so nothing has to remember to update the
board afterwards. That only works if the number is *known* at the moment the PR
is opened, and for a long time nothing computed it — the protocol told the model
to "make sure the body carries Closes #<issue>" while no script ever resolved
which issue that was. An instruction with no data behind it is a step that gets
skipped, and a skipped step here is a merged PR that leaves its task claimed
forever.

So this is the one place that answers it, from the issue list the caller already
fetched:

    issue_for_task.py --task t-3f8a91c2 --issues /tmp/arsenal-issues.json
    # → 42

Matching is `task_select.task_id_from_issue`, not a second regex — a resolver
that disagreed with the board about which issue belongs to which task would put
`Closes #<wrong>` on a PR, which closes someone else's work.

Exit: 0 and the number on stdout; 1 when no issue matches (the caller decides
whether that is fatal); 2 on unreadable input.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from task_select import (
    default_tasks_dir,
    load_tasks,
    read_issue_payload,
    task_id_from_issue,
    title_index,
)


def issue_number_for(
    task_id: str,
    issues: list[dict[str, Any]],
    *,
    titles: dict[str, str | None] | None = None,
) -> int | None:
    """The number of the issue handling `task_id`, preferring an open one.

    A task can end up with more than one handle — a duplicate created while a
    fetch was stale, or a re-opened board. Closing the open one is always the
    right answer: the closed one is already in its terminal state, and pointing
    `Closes` at it would close nothing that was not closed already.
    """
    return issue_numbers_by_task(issues, titles=titles).get(task_id)


def issue_numbers_by_task(
    issues: list[dict[str, Any]],
    *,
    titles: dict[str, str | None] | None = None,
) -> dict[str, int]:
    """Every task's handle, from ONE pass over the issue list.

    `issue_number_for` scans the whole list per task, and `query_status.py`
    called it twice for every task on the board: O(tasks x issues) on the path
    the session-start protocol runs, which is ~40,000 title-and-marker matches
    at the 200-task scale the queue is designed for. Resolving the board is one
    pass over the issues, so it is done once here and the answers looked up.

    Same preference as `issue_number_for`, which is now a lookup into this: an
    open handle always wins over a closed one, and the first open one wins, so
    the answer does not depend on the order GitHub returned the list.
    """
    best: dict[str, int] = {}
    decided: set[str] = set()
    for issue in issues:
        task_id = task_id_from_issue(issue, titles=titles)
        if task_id is None or task_id in decided:
            continue
        number = issue.get("number")
        if not isinstance(number, int):
            continue
        if str(issue.get("state", "open")).lower() == "open":
            best[task_id] = number
            decided.add(task_id)
        elif task_id not in best:
            best[task_id] = number
    return best


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", required=True, help="task id, e.g. t-3f8a91c2")
    parser.add_argument(
        "--issues",
        type=Path,
        required=True,
        help="JSON array of issues, or - to read stdin",
    )
    parser.add_argument(
        "--tasks-dir",
        type=Path,
        default=default_tasks_dir(),
        help="task files, used to resolve an issue that carries no body",
    )
    args = parser.parse_args(argv)

    issues = read_issue_payload(args.issues, "issue_for_task")
    if issues is None:
        return 2

    # The saved snapshot this reads is the one the session-start protocol
    # fetches, and that fetch no longer asks for bodies. Without the title
    # index a title-only handle resolves to nothing here, and open_task_pr.sh
    # refuses to open the PR for a task that has a perfectly good issue.
    tasks, _ = load_tasks(args.tasks_dir)
    number = issue_number_for(args.task, issues, titles=title_index(tasks))
    if number is None:
        print(
            f"issue_for_task: no issue carries `arsenal-task: {args.task}`, and none is "
            "titled like that task's file — run handle_sync.py and create the handle "
            "before opening the PR",
            file=sys.stderr,
        )
        return 1
    print(number)
    return 0


if __name__ == "__main__":
    # Windows consoles default to a legacy codepage (cp1252 and friends);
    # a non-ASCII line must degrade to "?", never take the process down.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
