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
import json
import os
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from task_select import load_tasks, task_id_from_issue, title_index


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
    best: int | None = None
    for issue in issues:
        if task_id_from_issue(issue, titles=titles) != task_id:
            continue
        number = issue.get("number")
        if not isinstance(number, int):
            continue
        if str(issue.get("state", "open")).lower() == "open":
            return number
        if best is None:
            best = number
    return best


def load_issues(source: Path) -> list[dict[str, Any]]:
    text = sys.stdin.read() if str(source) == "-" else source.read_text(encoding="utf-8")
    payload = json.loads(text)
    if isinstance(payload, dict):
        payload = payload.get("issues", [])
    return [i for i in payload if isinstance(i, dict)]


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
        default=Path(os.environ.get("ARSENAL_HOME", "arsenal")) / "tasks",
        help="task files, used to resolve an issue that carries no body",
    )
    args = parser.parse_args(argv)

    try:
        issues = load_issues(args.issues)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"issue_for_task: cannot read --issues — {exc}", file=sys.stderr)
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
    raise SystemExit(main())
