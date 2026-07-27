#!/usr/bin/env python3
"""query_status.py - Report task counts from claude-arsenal/queue/tasks.jsonl.
Exits 0. Exits 1 if queue file is absent.
"""
import argparse
import json
import sys
from pathlib import Path

QUEUE_FILE = "claude-arsenal/queue/tasks.jsonl"


def _load_queue(path: Path) -> list[dict]:
    rows: list[dict] = []
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


def main() -> None:
    p = argparse.ArgumentParser(description="Report queue task counts.")
    p.add_argument(
        "--detail", action="store_true",
        help="List each task's ID, title, status, assignee, and unmet deps.",
    )
    p.add_argument("--queue", default=QUEUE_FILE, help="Path to queue.jsonl")
    args = p.parse_args()

    queue_path = Path(args.queue)
    if not queue_path.exists():
        sys.exit(f"queue_status: queue file not found: {queue_path}")

    rows = _load_queue(queue_path)
    if not rows:
        print("total=0  open=0  in_progress=0  done=0  merged=0  blocked=0  escalated=0")
        return

    counts: dict[str, int] = {}
    for row in rows:
        status = row.get("status", "unknown")
        counts[status] = counts.get(status, 0) + 1

    total = len(rows)
    print(
        f"total={total}"
        f"  open={counts.get('open', 0)}"
        f"  in_progress={counts.get('in_progress', 0)}"
        f"  done={counts.get('done', 0)}"
        f"  merged={counts.get('merged', 0)}"
        f"  blocked={counts.get('blocked', 0)}"
        f"  escalated={counts.get('escalated', 0)}"
    )

    if args.detail:
        # `merged` is terminal too (a done task whose PR landed) and satisfies
        # blocking deps exactly like `done`.
        done_ids = {r["id"] for r in rows if r.get("status") in ("done", "merged")}
        print()
        for row in rows:
            unmet = [
                d["id"] for d in row.get("deps", [])
                if d.get("type") == "blocks" and d["id"] not in done_ids
            ]
            status = row.get("status", "?")
            title = row.get("title", "")[:50]
            unmet_str = f"  unmet_deps={unmet}" if unmet else ""
            if status == "escalated":
                att = row.get("attempts", 0)
                cap = row.get("max_attempts", 3)
                extra = f"attempts={att}/{cap} — needs human reset"
            else:
                assignee = row.get("assignee") or "-"
                extra = f"assignee={assignee:<20}"
            print(f"  {row['id']}  [{status:12s}]  {extra}  {title}{unmet_str}")


if __name__ == "__main__":
    main()
