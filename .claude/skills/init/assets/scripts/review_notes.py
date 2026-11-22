#!/usr/bin/env python3
"""review_notes.py — the review-notes v1 block every review page exports.

One format for the spec reader, the review digest and proofsheet pages: a JSON
object embedded in the exported Markdown notes file as

    <!-- review-notes {...} -->

so an export stays readable as Markdown and still parses exactly. The object:

    {"v": 1, "page": "slug", "built": "ISO-8601", "source": "sha256",
     "items": {"<item id or section key>": {
         "verdict": "fine" | "fix" | "not-a-bug" | null,
         "note": "text", "compare": ["v1", "v2"],
         "blocks": [{"quote": "...", "note": "..."}]}}}

Unknown keys are kept, so a newer page's export survives an older importer.

    review_notes.py parse EXPORT      # prints the object as JSON; exit 1 if absent or invalid
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

VERSION = 1
VERDICTS = ("fine", "fix", "not-a-bug")
BLOCK_RX = re.compile(r"<!--\s*review-notes\s*(\{.*?\})\s*-->", re.DOTALL)


class NotesError(ValueError):
    """The export has no valid review-notes block."""


def _is_block(b: Any) -> bool:
    return isinstance(b, dict) and all(isinstance(b.get(k, ""), str) for k in ("quote", "note"))


def validate(obj: Any) -> dict[str, Any]:
    """Return obj when it is a valid v1 object; raise NotesError naming the first fault."""
    if not isinstance(obj, dict):
        raise NotesError("review-notes must be a JSON object")
    if type(obj.get("v")) is not int or obj["v"] != VERSION:
        raise NotesError(f"review-notes version {obj.get('v')!r} is not {VERSION}")
    items = obj.get("items")
    if not isinstance(items, dict):
        raise NotesError("review-notes `items` must be an object keyed by item id")
    for key, item in items.items():
        if not isinstance(item, dict):
            raise NotesError(f"item {key!r} must be an object")
        verdict = item.get("verdict")
        if verdict is not None and verdict not in VERDICTS:
            allowed = ", ".join(VERDICTS)
            raise NotesError(f"item {key!r}: verdict {verdict!r} is not one of {allowed} or null")
        if not isinstance(item.get("note", ""), str):
            raise NotesError(f"item {key!r}: note must be text")
        blocks = item.get("blocks", [])
        if not isinstance(blocks, list) or not all(_is_block(b) for b in blocks):
            raise NotesError(f"item {key!r}: blocks must be a list of {{quote, note}} objects")
    return obj


def render_block(obj: dict[str, Any]) -> str:
    """The comment line to embed in an export.

    `-->` inside text is escaped so it cannot close the comment early.
    """
    text = json.dumps(validate(obj), ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return "<!-- review-notes " + text.replace("-->", "--\\u003e") + " -->"


def parse_block(text: str) -> dict[str, Any]:
    """The v1 object from an export's text; raises NotesError when it is missing or invalid."""
    match = BLOCK_RX.search(text)
    if not match:
        raise NotesError("no `<!-- review-notes {...} -->` block in the export")
    try:
        obj = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise NotesError(f"the review-notes block is not valid JSON — {exc}") from exc
    return validate(obj)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("parse", help="print an export's review-notes object as JSON")
    p.add_argument("export", type=Path)
    args = parser.parse_args(argv)
    try:
        obj = parse_block(args.export.read_text(encoding="utf-8"))
    except (OSError, NotesError) as exc:
        print(f"review_notes: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(obj, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
