#!/usr/bin/env python3
"""update_task_row.py — Update a single task row in tasks.jsonl.

Usage: update_task_row.py <task_id> <new_status> <queue_path> <pr_url> <reset_attempts>

  task_id        Task ID to update (e.g. lo-a3f8).
  new_status     Requested status: done|merged|open|blocked|in_progress|escalated.
  queue_path     Path to tasks.jsonl.
  pr_url         PR URL to record (empty string to skip).
  reset_attempts "1" to clear the attempts counter and bypass the cap check; "" otherwise.

Prints the final resolved status to stdout (may differ from new_status when
auto-escalation fires on an exhausted attempt cap).

Exit: 0 on success, 1 on error.
"""
import contextlib
import json
import os
import sys
import tempfile
from pathlib import Path


def atomic_write_text(path: Path, text: str) -> None:
    """Write text to path durably: temp file in the same dir, then rename (QIC-13).

    A crash mid-``write_text`` truncates and corrupts the ledger. Writing a temp
    file in the destination directory and renaming it over the target is atomic on
    POSIX (same-filesystem rename), so a reader/another writer always sees either
    the old whole file or the new whole file, never a half-written one.
    """
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    tmp_path = Path(tmp)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        tmp_path.replace(path)
    except BaseException:
        with contextlib.suppress(OSError):
            tmp_path.unlink()
        raise


def update_task_row(
    task_id: str,
    new_status: str,
    queue_path: Path,
    pr_url: str,
    reset_attempts: str,
) -> str:
    """Update the task row and return the final status written."""
    rows: list[dict] = []
    for line in queue_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                data = json.loads(line)
                if not isinstance(data, dict):
                    raise ValueError(f"expected JSON object, got {type(data).__name__}")
                rows.append(data)
            except (json.JSONDecodeError, ValueError) as e:
                print(
                    f"update_task_row: invalid line in queue file: {line!r} ({e})",
                    file=sys.stderr,
                )
                sys.exit(1)

    updated = False
    final_status = new_status
    for row in rows:
        if row.get("id") == task_id:
            current_status = row.get("status")
            if new_status == "open":
                if reset_attempts == "1":
                    row["attempts"] = 0
                    final_status = "open"
                elif current_status == "in_progress":
                    current = int(row.get("attempts") or 0) + 1
                    cap = int(row.get("max_attempts") or 3)
                    row["attempts"] = current
                    final_status = "escalated" if current >= cap else "open"
                elif current_status == "escalated":
                    final_status = "escalated"
                else:
                    final_status = "open"
            row["status"] = final_status
            if final_status not in ("in_progress",):
                row["assignee"] = None
                # Clear the lease timestamp when the task leaves in_progress so a
                # stale claimed_at never lingers on an open/done row and trips the
                # lease check (see queue_doctor.py --lease-ttl / claim.sh).
                row.pop("claimed_at", None)
            if final_status in ("done", "merged"):
                row["attempts"] = 0
            if pr_url:
                row["pr"] = pr_url
            updated = True

    if not updated:
        print(f"update_task_row: task {task_id} not found", file=sys.stderr)
        sys.exit(1)

    atomic_write_text(
        queue_path,
        "\n".join(json.dumps(r, separators=(",", ":")) for r in rows) + "\n",
    )
    return final_status


def main() -> None:
    if len(sys.argv) != 6:
        print(
            "usage: update_task_row.py"
            " <task_id> <new_status> <queue_path> <pr_url> <reset_attempts>",
            file=sys.stderr,
        )
        sys.exit(1)

    task_id, new_status, queue_path_str, pr_url, reset_attempts = sys.argv[1:6]
    queue_path = Path(queue_path_str)

    final_status = update_task_row(task_id, new_status, queue_path, pr_url, reset_attempts)
    print(final_status)


if __name__ == "__main__":
    main()
