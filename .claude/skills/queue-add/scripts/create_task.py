#!/usr/bin/env python3
"""create_task.py - Append a new task to claude-arsenal/queue/tasks.jsonl.
Validates schema and dependency edges before writing.
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

QUEUE_FILE = "claude-arsenal/queue/tasks.jsonl"


def _load_queue(path: Path) -> list[dict]:
    rows: list[dict] = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                data = json.loads(line)
                if isinstance(data, dict):
                    rows.append(data)
            except json.JSONDecodeError:
                pass
    return rows


def _generate_id(title: str) -> str:
    seed = f"{title}-{time.time()}"
    return "lo-" + hashlib.sha256(seed.encode()).hexdigest()[:4]


def add_task(
    title: str,
    priority: int,
    requires: list[str],
    deps: list[str],
    queue_path: Path,
    workspace: str | None = None,
    tags: list[str] | None = None,
    max_attempts: int = 3,
) -> str:
    rows = _load_queue(queue_path)
    existing_ids = {r["id"] for r in rows}

    for dep in deps:
        if dep not in existing_ids:
            sys.exit(
                f"add_task: dep '{dep}' not found in queue. "
                f"Existing IDs: {sorted(existing_ids) or '(empty queue)'}"
            )

    task_id = _generate_id(title)
    _attempt_counter = 0
    while task_id in existing_ids:
        task_id = _generate_id(title + str(_attempt_counter))
        _attempt_counter += 1
        if _attempt_counter > 100:
            sys.exit("add_task: could not generate a unique ID after 100 attempts")

    row: dict = {
        "id": task_id,
        "title": title,
        "status": "open",
        "priority": priority,
        "requires": requires,
        "deps": [{"id": d, "type": "blocks"} for d in deps],
        "assignee": None,
        "payload": f"{task_id}.md",
        "max_attempts": max_attempts,
        "attempts": 0,
    }

    if workspace is not None:
        row["workspace"] = workspace

    # Normalise tags: drop blanks, de-duplicate, preserve first-seen order.
    if tags:
        seen: set[str] = set()
        clean_tags = []
        for tag in tags:
            tag = tag.strip()
            if tag and tag not in seen:
                seen.add(tag)
                clean_tags.append(tag)
        if clean_tags:
            row["tags"] = clean_tags

    queue_path.parent.mkdir(parents=True, exist_ok=True)
    with queue_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, separators=(",", ":")) + "\n")

    return task_id


def main() -> None:
    p = argparse.ArgumentParser(description="Add a task to the claude-arsenal queue.")
    p.add_argument("--title", required=True, help="Task title")
    p.add_argument("--priority", type=int, default=0, help="Task priority (higher = more urgent)")
    p.add_argument(
        "--requires", action="append", default=[], metavar="CAP",
        help="Surface capability requirement (e.g. surface:cli). Repeatable.",
    )
    p.add_argument(
        "--deps", action="append", default=[], metavar="ID",
        help="Task ID this task blocks on (repeatable).",
    )
    p.add_argument("--workspace", default=None, metavar="NAME",
                   help="Workspace this task belongs to (used by LOOP_WORKSPACE filtering).")
    p.add_argument(
        "--tag", action="append", default=[], metavar="TAG",
        help="Free-form label for /continue tag scoping (used by LOOP_TAGS). Repeatable.",
    )
    p.add_argument(
        "--max-attempts", type=int, default=3, metavar="N",
        help="Maximum gate-failure attempts before auto-escalation (default: 3).",
    )
    p.add_argument("--queue", default=QUEUE_FILE, help="Path to queue.jsonl")
    args = p.parse_args()

    task_id = add_task(
        args.title, args.priority, args.requires, args.deps,
        Path(args.queue), args.workspace, args.tag,
        args.max_attempts,
    )
    print(task_id)


if __name__ == "__main__":
    main()
