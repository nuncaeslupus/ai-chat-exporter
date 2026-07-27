#!/usr/bin/env python3
"""Scan recent Claude Code session transcripts for pain signals.

Reads JSONL transcripts from `~/.claude/projects/<encoded-project>/*.jsonl`
(or `--project <path>`) for the last `--days` days OR `--limit` files
(whichever is smaller), extracts four signal buckets, and prints a JSON
report:

  - repeated_tool_errors   : same tool + first error line ≥3 times
  - throwaway_scripts      : tmp/*.{sh,py,js} written and not promoted
  - repeated_failing_bash  : same Bash command failing ≥2 times
  - user_corrections       : user messages matching correction regex

Exit codes:
  0 — report emitted
  2 — error (project dir missing, no transcripts, etc.)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path

CORRECTION_RE = re.compile(
    r"\b(?:no[, ]+don'?t|stop (?:doing|that)|don'?t (?:do|use)|wrong"
    r"|i already (?:told|said)|again.+(?:no|don'?t)"
    r"|not (?:what|that).+(?:asked|wanted|meant))\b",
    re.IGNORECASE,
)
THROWAWAY_RE = re.compile(r"^tmp/[^/]+\.(?:sh|py|js|ts)$")
ERROR_HEAD_RE = re.compile(r"^[A-Za-z][^\n]{3,200}")


def _default_project_dir() -> Path:
    cwd = Path.cwd().resolve()
    encoded = "-" + str(cwd).lstrip("/").replace("/", "-")
    return Path.home() / ".claude" / "projects" / encoded


def _parse_records(path: Path) -> list[dict]:
    """Parse a JSONL transcript into records, skipping blank / invalid lines."""
    records: list[dict] = []
    with path.open(encoding="utf-8") as fh:
        for raw in fh:
            if not raw.strip():
                continue
            try:
                rec = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(rec, dict):
                records.append(rec)
    return records


def _message(rec: dict) -> dict:
    """The record's `message` object as a dict ({} when absent/null/non-dict)."""
    msg = rec.get("message")
    return msg if isinstance(msg, dict) else {}


def _user_text(rec: dict) -> str:
    """Concatenated text of a user message record (empty string if none)."""
    content = _message(rec).get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            b.get("text") or "" for b in content if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


def _iter_transcripts(project_dir: Path, days: int, limit: int) -> list[Path]:
    if not project_dir.is_dir():
        return []
    cutoff = datetime.now(UTC) - timedelta(days=days)
    files = []
    for p in project_dir.glob("*.jsonl"):
        mtime = datetime.fromtimestamp(p.stat().st_mtime, tz=UTC)
        if mtime >= cutoff:
            files.append((mtime, p))
    files.sort(key=lambda t: t[0], reverse=True)
    return [p for _, p in files[:limit]]


def _scan(files: list[Path]) -> dict:
    tool_error_counts: Counter = Counter()
    tool_error_sessions: dict[tuple, set] = defaultdict(set)
    bash_fail_counts: Counter = Counter()
    bash_fail_sessions: dict[str, set] = defaultdict(set)
    throwaways: list[dict] = []
    promoted: set[str] = set()
    corrections: list[dict] = []

    for path in files:
        session_id = path.stem
        prev_assistant_excerpt: str | None = None
        # tool_use_id → (tool_name, normalized_command_if_bash)
        tool_use_map: dict[str, tuple[str, str]] = {}

        records = _parse_records(path)

        # Count user text messages first and skip short/abandoned sessions
        # before any global mutation below — the previous end-of-loop guard
        # ran after the counters had already been polluted.
        session_user_msgs = sum(
            1 for rec in records if rec.get("type") == "user" and _user_text(rec)
        )
        if session_user_msgs < 5:
            continue

        for rec in records:
            rtype = rec.get("type")
            if rtype == "user":
                content = _message(rec).get("content")
                # Tool results live inside user messages — parse them here.
                if isinstance(content, list):
                    for b in content:
                        if not isinstance(b, dict):
                            continue
                        if b.get("type") != "tool_result" or not b.get("is_error"):
                            continue
                        tc = b.get("content")
                        text = tc if isinstance(tc, str) else ""
                        if isinstance(tc, list):
                            text = " ".join(
                                x.get("text") or ""
                                for x in tc
                                if isinstance(x, dict) and x.get("type") == "text"
                            )
                        head_match = ERROR_HEAD_RE.search(text or "")
                        if not head_match:
                            continue
                        first_line = head_match.group(0).strip()
                        tool_info = tool_use_map.get(b.get("tool_use_id", ""))
                        tool_name = tool_info[0] if tool_info else "Unknown"
                        key = (tool_name, first_line[:120])
                        tool_error_counts[key] += 1
                        tool_error_sessions[key].add(session_id)
                        if tool_name == "Bash" and tool_info and tool_info[1]:
                            cmd = " ".join(tool_info[1].split())[:200]
                            bash_fail_counts[cmd] += 1
                            bash_fail_sessions[cmd].add(session_id)
                # User text content (correction-phrase detection).
                text = _user_text(rec)
                if text:
                    m = CORRECTION_RE.search(text)
                    if m:
                        corrections.append(
                            {
                                "session": session_id,
                                "phrase": m.group(0),
                                "excerpt": text[:200],
                                "prev_assistant": prev_assistant_excerpt[:200]
                                if prev_assistant_excerpt
                                else None,
                            }
                        )
            elif rtype == "assistant":
                content = _message(rec).get("content", [])
                if isinstance(content, list):
                    texts = [
                        b.get("text") or ""
                        for b in content
                        if isinstance(b, dict) and b.get("type") == "text"
                    ]
                    if texts:
                        prev_assistant_excerpt = " ".join(texts)[:200]
                    for b in content:
                        if not isinstance(b, dict) or b.get("type") != "tool_use":
                            continue
                        name = b.get("name", "")
                        inp = b.get("input", {})
                        # Record the use so tool_result handling can resolve the name + command.
                        tool_id = b.get("id", "")
                        if tool_id:
                            cmd_for_map = ""
                            if name == "Bash":
                                cmd_for_map = (inp.get("command") or "").strip()
                            tool_use_map[tool_id] = (name, cmd_for_map)
                        if name == "Write":
                            fp = inp.get("file_path", "")
                            rel = fp.split("/", 100)[-3:] if fp else []
                            tail = "/".join(rel[-2:]) if rel else fp
                            if THROWAWAY_RE.match(tail):
                                throwaways.append(
                                    {
                                        "session": session_id,
                                        "path": tail,
                                        "size_lines": len((inp.get("content") or "").splitlines()),
                                    }
                                )
                        elif name == "Bash":
                            cmd = (inp.get("command") or "").strip()
                            if cmd.startswith("mv ") or cmd.startswith("cp "):
                                for word in cmd.split():
                                    if THROWAWAY_RE.match(word):
                                        promoted.add(word)

    repeated_tool_errors = [
        {
            "tool_name": k[0],
            "first_line": k[1],
            "count": v,
            "sessions": sorted(tool_error_sessions[k]),
        }
        for k, v in tool_error_counts.most_common(10)
        if v >= 3
    ]
    repeated_failing_bash = [
        {"command": k[:200], "count": v, "sessions": sorted(bash_fail_sessions[k])}
        for k, v in bash_fail_counts.most_common(10)
        if v >= 2
    ]
    orphan_throwaways = [t for t in throwaways if t["path"] not in promoted]

    return {
        "scanned_sessions": len(files),
        "repeated_tool_errors": repeated_tool_errors,
        "throwaway_scripts": orphan_throwaways[:10],
        "repeated_failing_bash": repeated_failing_bash,
        "user_corrections": corrections[:10],
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument(
        "--days", type=int, default=7, help="scan transcripts modified within the last N days"
    )
    p.add_argument("--limit", type=int, default=10, help="scan at most N most-recent transcripts")
    p.add_argument("--project", help="path to ~/.claude/projects/<dir> (defaults to CWD-derived)")
    args = p.parse_args()

    project_dir = Path(args.project) if args.project else _default_project_dir()
    files = _iter_transcripts(project_dir, args.days, args.limit)
    if not files:
        sys.stderr.write(f"no transcripts found under {project_dir}\n")
        return 2
    report = _scan(files)
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
