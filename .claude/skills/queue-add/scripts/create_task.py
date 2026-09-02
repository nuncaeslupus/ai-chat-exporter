#!/usr/bin/env python3
"""create_task.py — create a task file, and print the issue handle to open for it.

A task is a file in the repository: versioned, reviewed in the pull request
that adds it, and readable with no network. This script writes that file and
then prints the issue body its handle needs, because creating the issue itself
requires GitHub access that differs by surface — the caller makes that call
with whatever channel it has.

    create_task.py --title "Extract the surface probe" --priority 5 --deps t-aaaa1111

Ids are random rather than derived from the title. The previous scheme hashed
the title to four hex characters and checked uniqueness against the local file
only, so two agents adding a task with the same title minted the *same* id and
neither could see the other's. Random ids need no coordination, which is what
lets several agents add tasks at once.

Exit: 0 on success, 2 on a validation failure (an unknown dep, or an id clash).
"""

from __future__ import annotations

import argparse
import html
import json
import re
import secrets
import sys
from pathlib import Path

# The id has to be VISIBLE body text. As an HTML comment it was stripped by
# the GitHub tools a cloud session uses, which left every issue anonymous and
# the whole board reading as stateless.
TASK_MARKER = "`arsenal-task: {task_id}`"

TEMPLATE = """\
---
id: {task_id}
title: {title}
priority: {priority}
{extra}---

{body}
## Acceptance gate

<!-- Replace this with a fenced bash block. A gate that is only prose runs
     nothing, and a gate that runs nothing passes everything — `task_select.py`
     reports gate: false for a task with no block, so an unenforced gate is
     visible rather than quietly inert. -->

```bash
# arsenal:gate-placeholder — replace with the real check; it may land in this task's own PR
# e.g. bash tests/surface_probe_test.sh
false
```
"""



# The documented meaning of `priority`: task size, larger runs sooner. Kept here
# rather than in prose so `--size` and the board's convention check agree on one
# set of values.
SIZE_PRIORITY = {"S": 10, "M": 5, "L": 1}

def new_task_id() -> str:
    return f"t-{secrets.token_hex(4)}"


def existing_ids(tasks_dir: Path) -> set[str]:
    """Every task id this tree knows — live tasks and finished ones alike.

    The history dir is included because that is where `task_select.py` looks
    too, and the two must agree on what the task set is. A dep on merged work
    is the *most* satisfied dep there is; reading only the live dir refused to
    write down exactly that, and the workaround — dropping the dep and saying
    it in prose — leaves the graph unable to answer "what depended on this".
    """
    ids: set[str] = set()
    if not tasks_dir.is_dir():
        return ids
    # Quotes optional, and only in the pairs `_parse_scalar` strips: the
    # selector reads `id: "t-abc12345"` as `t-abc12345`, so a generator that
    # quotes defined an id this never saw, and a dep on that task read as a dep
    # on nothing. A lone quote is not stripped there either — it reads as part
    # of the id — so accepting one here would trade the old disagreement for a
    # subtler one, where the dep validates and then resolves to nothing.
    pattern = re.compile(
        r"""^id:\s*(?:["'](?P<quoted>[A-Za-z0-9._-]+)["']|(?P<bare>[A-Za-z0-9._-]+))\s*$""",
        re.MULTILINE,
    )
    paths = sorted(tasks_dir.glob("*.md")) + sorted((tasks_dir / "_history").glob("*.md"))
    for path in paths:
        # `_`- and `.`-prefixed files are notes living alongside the tasks — the
        # migration's `_migrated-history.md` lists ids it does not define. The
        # selector skips them, so accepting a dep on one would declare a dep the
        # selector can never satisfy: the exact failure this check exists to stop.
        if path.name.startswith(("_", ".")):
            continue
        match = pattern.search(path.read_text(encoding="utf-8"))
        if match:
            ids.add(match.group("quoted") or match.group("bare"))
    return ids


def normalise_title(text: str) -> str:
    """Fold a title the way `task_select.normalise_title` folds it.

    Duplicated rather than imported because the two live in different skills
    with no import path between them. The folding has to agree, since this is
    what decides whether a title can serve as a task's handle later.
    """
    return re.sub(r"\s+", " ", html.unescape(str(text))).strip().casefold()


def existing_titles(tasks_dir: Path) -> set[str]:
    """Every normalised task title this tree knows, live and finished alike."""
    titles: set[str] = set()
    if not tasks_dir.is_dir():
        return titles
    pattern = re.compile(r"""^title:\s*(.+?)\s*$""", re.MULTILINE)
    paths = sorted(tasks_dir.glob("*.md")) + sorted((tasks_dir / "_history").glob("*.md"))
    for path in paths:
        if path.name.startswith(("_", ".")):
            continue
        match = pattern.search(path.read_text(encoding="utf-8"))
        if not match:
            continue
        raw = match.group(1)
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            raw = raw.strip("\"'")
        titles.add(normalise_title(raw))
    return titles


def build(
    tasks_dir: Path,
    *,
    title: str,
    priority: int,
    deps: list[str],
    requires: list[str],
    tags: list[str],
    workspace: str | None,
    max_attempts: int | None,
    body: str,
) -> tuple[str, str]:
    """Return (task_id, file contents). Raises ValueError on a bad dep or title."""
    known = existing_ids(tasks_dir)

    # A title is not decoration: `handle_sync.py` and `arsenal-queue.yml` both
    # title the issue handle from it, and `task_id_from_issue` resolves an issue
    # back to its task by that title whenever the session-start fetch skipped
    # `body` -- which it does deliberately, because fetching every body costs
    # ~9k context tokens on a 40-issue board against ~1.2k without. Two tasks
    # sharing a title make that resolution ambiguous, and the resolver's answer
    # for an ambiguous title is None: neither task's issue can be attributed, so
    # the board reports missing handles and `handle_sync.py` proposes duplicate
    # issues for tasks that already have one. Refusing the collision here costs
    # one rename; allowing it costs the body fetch for the whole board.
    #
    # Best-effort, deliberately: this reads the tree before the caller writes,
    # so two processes racing could both pass. A lock would not close that,
    # because the collision that actually reaches a board is not two processes
    # sharing a directory -- it is two agents on separate branches or worktrees,
    # whose files meet only at the merge, where no lock of ours exists. The
    # authoritative detector therefore stays where it can see the merged result:
    # `task_select.task_id_from_issue` resolves an ambiguous title to None and
    # says so. This check exists to turn the ordinary sequential case into an
    # error at the moment of the typo, not to be that detector.
    if normalise_title(title) in existing_titles(tasks_dir):
        raise ValueError(
            f"a task in {tasks_dir} already has the title {title!r}. Titles have to be "
            "distinct: they are how an issue resolves back to its task when the board is "
            "fetched without bodies. Give this one a title that says what is different "
            "about it."
        )

    # A dep that does not exist would silently block the task forever: the
    # selector treats unknown deps as unsatisfied, on purpose. Catching it here
    # turns a task that never runs into an error at the moment of the typo.
    unknown = [d for d in deps if d not in known]
    if unknown:
        raise ValueError(
            f"unknown dep(s): {', '.join(unknown)} — no task file declares them in {tasks_dir}"
        )

    task_id = new_task_id()
    while task_id in known:  # pragma: no cover — 2^32 space, but cheap to be sure
        task_id = new_task_id()

    extra = ""
    if deps:
        extra += f"deps: [{', '.join(deps)}]\n"
    if requires:
        extra += f"requires: [{', '.join(requires)}]\n"
    if tags:
        extra += f"tags: [{', '.join(tags)}]\n"
    if workspace:
        extra += f"workspace: {workspace}\n"
    if max_attempts is not None and max_attempts != 3:
        extra += f"max-attempts: {max_attempts}\n"

    text = TEMPLATE.format(
        task_id=task_id,
        title=json.dumps(title),
        priority=priority,
        extra=extra,
        body=(body.strip() + "\n\n") if body.strip() else "",
    )
    return task_id, text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--title", required=True)
    parser.add_argument(
        "--size",
        choices=sorted(SIZE_PRIORITY),
        help="task size — the documented meaning of priority (S=10, M=5, L=1)",
    )
    parser.add_argument(
        "--priority",
        type=int,
        default=None,
        help="raw priority override; prefer --size, which writes the documented value",
    )
    parser.add_argument("--deps", action="append", default=[], help="repeatable task id")
    parser.add_argument("--requires", action="append", default=[], help="e.g. surface:cli")
    parser.add_argument("--tag", action="append", default=[], dest="tags")
    parser.add_argument("--workspace")
    parser.add_argument("--max-attempts", type=int, dest="max_attempts")
    parser.add_argument("--body", default="", help="task detail placed above the gate")
    parser.add_argument("--tasks-dir", type=Path, default=Path("arsenal/tasks"))
    args = parser.parse_args(argv)

    # `priority` means task size, and only that. Build order is already
    # expressible — `deps` is a DAG, which is what the selector runs on and what
    # survives re-planning — so encoding rank here duplicates that information in
    # a form nothing validates against the graph. Both conventions did end up in
    # the same column, and because a rank scale's floor sits above the size
    # scale's ceiling, every rank-encoded task outranked every size-encoded one
    # unconditionally: an ordering nobody chose, decided by when a row was
    # written (#146). --size writes the documented value; --priority stays for a
    # deliberate override.
    if args.size and args.priority is not None:
        parser.error("--size and --priority are mutually exclusive; --size writes the value")
    priority = SIZE_PRIORITY[args.size] if args.size else (args.priority or 0)

    try:
        task_id, text = build(
            args.tasks_dir,
            title=args.title,
            priority=priority,
            deps=args.deps,
            requires=args.requires,
            tags=args.tags,
            workspace=args.workspace,
            max_attempts=args.max_attempts,
            body=args.body,
        )
    except ValueError as exc:
        print(f"create_task: {exc}", file=sys.stderr)
        return 2

    args.tasks_dir.mkdir(parents=True, exist_ok=True)
    path = args.tasks_dir / f"{task_id}.md"
    path.write_text(text, encoding="utf-8")

    print(task_id)
    print(f"file: {path}", file=sys.stderr)
    print("", file=sys.stderr)
    print("Open its issue handle with your GitHub tools:", file=sys.stderr)
    print(f"  title: {args.title}", file=sys.stderr)
    print("  labels: arsenal:task", file=sys.stderr)
    print(f"  body:  {TASK_MARKER.format(task_id=task_id)}", file=sys.stderr)
    print(f"         Task defined in `{path}`", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
