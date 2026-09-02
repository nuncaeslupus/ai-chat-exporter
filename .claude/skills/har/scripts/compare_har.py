#!/usr/bin/env python3
"""compare_har.py — what actually changed between two captures.

Answers "what happened when I clicked page 2" now, and "did the site change
under my scraper" later.

    compare_har.py --input before.har --against after.har
    compare_har.py --input before.har --against after.har --type xhr --json

**Matching is one-to-one and deterministic**, because a capture routinely
repeats the same method and URL. The identity key is
`(method, scheme, host, port, path, query pairs in captured order, hash of the
request body)`, and three things about it are deliberate:

* **The authority is part of request identity**, so two captures hitting the
  same path on different hosts, or on http and https, are never silently
  paired.
* **Query pairs keep their captured order** rather than being sorted. Sorting
  would make `?tag=a&tag=b` and `?tag=b&tag=a` the same request, and order
  carries meaning for signed requests and for some APIs.
* **`pageref` is not in the key.** HAR page ids are local to one capture, so
  including it would make the same request in two captures — exactly what a
  diff is looking for — appear as a removal plus an addition.

Entries sharing a key pair in capture order, first with first. Anything left
over on either side is reported as an addition or a removal, never paired with
something that merely resembles it, which is how a diff tool starts inventing
changes that did not happen.

Exit: 0 when the captures match, 1 when they differ, 2 on a usage error.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _filters import FilterError, add_selection_args, selection_from_args
from _harlib import HarStructureError, apply_budget, elide, output_collision
from analyze_har import ensure_index

Key = tuple[str, str, str, str, str, tuple[tuple[str, str], ...], str]


def identity(row: dict[str, Any]) -> Key:
    """The pairing key. `pageref` is deliberately absent — see the module docstring."""
    body = str(row.get("reqBodyHash") or "")
    if not body and row.get("hasReqBody"):
        # A body the index could not identify. Hashing the *mime type* here
        # instead — which is what this fallback used to do — made every
        # `application/json` POST to one URL hash alike, so a capture of one
        # search and a capture of another compared equal. That is the fail-open
        # direction, and on a board whose list endpoint is a POST to a URL that
        # never varies it is also the common one. Unknown is not equivalent, so
        # the row is given an identity nothing else can share and is reported as
        # unpaired rather than as unchanged.
        body = f"unidentified-body:{row.get('i')}"
    return (
        str(row.get("method") or ""),
        str(row.get("scheme") or ""),
        str(row.get("host") or ""),
        str(row.get("port") or ""),
        str(row.get("path") or ""),
        tuple((str(n), str(v)) for n, v in (row.get("query") or [])),
        body,
    )


Pairs = list[tuple[dict[str, Any], dict[str, Any], bool]]
Rows = list[dict[str, Any]]


def pair(left: Rows, right: Rows) -> tuple[Pairs, Rows, Rows]:
    """Pair entries one-to-one by identity, in capture order within each key.

    Returns (pairs, only_left, only_right). Each pair carries a flag saying
    whether it was matched positionally — a reader can then tell a real match
    from "these were both the third repeat of the same request".
    """
    buckets: dict[Key, list[dict[str, Any]]] = defaultdict(list)
    for row in right:
        buckets[identity(row)].append(row)

    pairs: Pairs = []
    only_left: Rows = []
    consumed: dict[Key, int] = defaultdict(int)
    for row in left:
        key = identity(row)
        taken = consumed[key]
        if taken < len(buckets[key]):
            counterpart = buckets[key][taken]
            consumed[key] += 1
            pairs.append((row, counterpart, taken > 0))
        else:
            only_left.append(row)

    only_right = [
        row
        for key, rows in buckets.items()
        for row in rows[consumed[key] :]
    ]
    return pairs, only_left, only_right


def differences(pairs: Pairs, size_tolerance: float) -> list[str]:
    """Only what changed. A pair with the same status and size says nothing."""
    lines: list[str] = []
    for before, after, positional in pairs:
        notes: list[str] = []
        if before.get("status") != after.get("status"):
            notes.append(f"status {before.get('status')} → {after.get('status')}")
        left_bytes = before.get("respBytes") or 0
        right_bytes = after.get("respBytes") or 0
        if left_bytes or right_bytes:
            delta = abs(right_bytes - left_bytes) / max(1, left_bytes)
            if delta > size_tolerance:
                notes.append(f"size {left_bytes} → {right_bytes}")
        before_mime = (before.get("mime") or "").split(";")[0]
        after_mime = (after.get("mime") or "").split(";")[0]
        if before_mime != after_mime:
            notes.append(f"mime {before_mime} → {after_mime}")
        if notes:
            suffix = "  (positional match)" if positional else ""
            lines.append(f"~ {elide(before.get('url') or '', 60)}{suffix}")
            lines += [f"    {note}" for note in notes]
    return lines


def parameter_changes(only_left: Rows, only_right: Rows) -> list[str]:
    """Requests to the same path whose parameters differ.

    Reported separately from additions and removals rather than paired: a
    changed parameter set is a *different request*, and pretending otherwise is
    how a diff invents a change that did not happen. Naming the pattern is
    useful; merging the entries is not.
    """
    by_path: dict[tuple[str, str, str], list[set[str]]] = defaultdict(lambda: [set(), set()])
    for side, rows in ((0, only_left), (1, only_right)):
        for row in rows:
            key = (str(row.get("method")), str(row.get("host")), str(row.get("path")))
            by_path[key][side].update(name for name, _ in row.get("query") or [])

    lines: list[str] = []
    for (method, host, path), (left_names, right_names) in sorted(by_path.items()):
        if not left_names and not right_names:
            continue
        added = sorted(right_names - left_names)
        removed = sorted(left_names - right_names)
        if added or removed:
            lines.append(f"? {method} {host}{path}")
            if added:
                lines.append(f"    parameters added: {', '.join(added)}")
            if removed:
                lines.append(f"    parameters removed: {', '.join(removed)}")
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="the first capture")
    parser.add_argument("--against", type=Path, required=True, help="the second capture")
    add_selection_args(parser)
    parser.add_argument("--json", action="store_true", dest="as_json", help="machine-readable")
    parser.add_argument("--limit", type=int, default=20, help="0 removes the row and byte caps")
    parser.add_argument("--output", type=Path, metavar="PATH", help="write the FULL result")
    parser.add_argument(
        "--size-tolerance", type=float, default=0.05,
        help="relative body-size change to ignore (default 0.05 — a response that "
        "differs by a timestamp is not a change worth reading)",
    )
    args = parser.parse_args(argv)

    for path in (args.input, args.against):
        if not path.is_file():
            print(f"compare_har: no such file: {path}", file=sys.stderr)
            return 2
    collision = output_collision(args, inputs=("input", "against"))
    if collision:
        print(f"compare_har: {collision}", file=sys.stderr)
        return 2

    try:
        selection = selection_from_args(args)
    except FilterError as exc:
        print(f"compare_har: {exc}", file=sys.stderr)
        return 2
    if selection.needs_body():
        print(
            "compare_har: body filters are not supported here — compare selects on "
            "metadata so it stays flat in the captures' body bytes",
            file=sys.stderr,
        )
        return 2

    try:
        _, left_rows = ensure_index(args.input)
        _, right_rows = ensure_index(args.against)
        left = [r for r in left_rows if selection.matches_index(r) != selection.invert]
        right = [r for r in right_rows if selection.matches_index(r) != selection.invert]
    except (HarStructureError, OSError, ValueError) as exc:
        print(f"compare_har: {exc}", file=sys.stderr)
        return 1

    pairs, only_left, only_right = pair(left, right)
    changed = differences(pairs, args.size_tolerance)
    params = parameter_changes(only_left, only_right)

    lines = [
        f"{len(left)} vs {len(right)} entries — {len(pairs)} paired, "
        f"{len(only_left)} only in {args.input.name}, {len(only_right)} only in {args.against.name}"
    ]
    # Said out loud rather than left to be inferred from an unpaired row: an
    # index written before request bodies were hashed cannot identify them, and
    # the reader should re-run `analyze_har.py --index` rather than read the
    # additions and removals below as a change on the site.
    unidentified = sum(
        1
        for row in (*only_left, *only_right)
        if row.get("hasReqBody") and not row.get("reqBodyHash")
    )
    if unidentified:
        lines.append(
            f"! {unidentified} request(s) carry a body this index cannot identify — "
            "listed as unpaired, not as unchanged; rebuild with analyze_har.py --index"
        )
    lines += changed
    lines += params
    lines += [f"- {elide(row.get('url') or '', 68)}" for row in only_left]
    lines += [f"+ {elide(row.get('url') or '', 68)}" for row in only_right]
    if len(lines) == 1:
        lines.append("no differences")

    if args.as_json:
        print(
            json.dumps(
                {
                    "paired": len(pairs),
                    "changed": len(changed),
                    "only_input": [r.get("url") for r in only_left],
                    "only_against": [r.get("url") for r in only_right],
                    "lines": lines,
                },
                ensure_ascii=False,
            )
        )
    elif args.output:
        args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"wrote {len(lines)} line(s) to {args.output}", file=sys.stderr)
    else:
        kept, note = apply_budget(lines, 0 if args.limit == 0 else 4096)
        print("\n".join(kept))
        if note:
            print(note)
    return 1 if (changed or params or only_left or only_right) else 0


if __name__ == "__main__":
    raise SystemExit(main())
