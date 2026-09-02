#!/usr/bin/env python3
"""query_har.py — select entries, show one in full, get bodies out.

The command that answers the question this toolkit exists for: paste a string
that was visible on the page, get back the request that returned it.

    query_har.py --input capture.har --response-match "Senior Rust Engineer"
    query_har.py --input capture.har --show 4
    query_har.py --input capture.har --type xhr --status 2xx --json
    query_har.py --input capture.har --mime json --extract-body --output-dir bodies/

Selection flags are the shared grammar (`_filters.py`) and are spelled
identically in every sibling script. Output is capped at 20 rows and 4096 bytes,
whichever binds first, and the trailing line says which one did the dropping.
`--limit 0` removes both caps; `--output PATH` writes the complete result to a
file in full fidelity.

Exit: 0 when the selection is non-empty, 1 when nothing matched or the capture
cannot be read, 2 on a usage error.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _filters import FilterError, add_selection_args, selection_from_args
from _harlib import (
    HarStructureError,
    apply_budget,
    decode_body,
    elide,
    is_textual,
    output_collision,
    read_entry,
    scan_entries,
)
from analyze_har import ensure_index, verify_for_seek

# Windows device names, which are reserved as filenames on that platform
# whatever extension follows them.
_RESERVED_STEMS = {
    "con", "prn", "aux", "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}
_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")

_EXTENSIONS = {
    "application/json": ".json",
    "text/html": ".html",
    "text/plain": ".txt",
    "text/css": ".css",
    "application/xml": ".xml",
    "text/xml": ".xml",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "application/javascript": ".js",
    "text/javascript": ".js",
}


def safe_filename(index: int, url: str, mime: str) -> str:
    """A filename derived from a URL that a URL can never choose.

    A HAR's URLs are attacker-controlled in exactly the way a response body is,
    and this function's output becomes a path. So the whole thing is flattened
    to one component: separators and `..` collapse into the stem, control
    characters and anything outside `[A-Za-z0-9._-]` are replaced, a leading dot
    cannot survive, reserved device names are suffixed, and the stem is length
    capped. The caller still verifies the resolved destination sits inside the
    output directory — this is the first of two guards, not the only one.
    """
    parts = urlsplit(url)
    raw = f"{parts.hostname or 'unknown'}{parts.path}"
    stem = _UNSAFE.sub("_", raw)
    # Collapse dot runs. A component that is exactly `..` is the dangerous form,
    # and one that merely contains `..` is inert but reads like an escape that
    # got through — which is the wrong thing for a reviewer to have to squint at.
    stem = re.sub(r"\.{2,}", "_", stem).strip("._") or "entry"
    if stem.split(".")[0].lower() in _RESERVED_STEMS:
        stem = f"{stem}_"
    stem = stem[:80]
    suffix = _EXTENSIONS.get((mime or "").split(";")[0].strip().lower(), ".bin")
    return f"{index:04d}-{stem}{suffix}"


def json_path(value: Any, expression: str) -> list[Any]:
    """A deliberately small subset: `a.b[0].c`, and `[*]` for every element.

    Enough for reading a paginated API's payload, and refuses what it does not
    support by name rather than silently returning nothing.
    """
    current: list[Any] = [value]
    for token in re.findall(r"[^.\[\]]+|\[\*\]|\[\d+\]", expression):
        step: list[Any] = []
        for item in current:
            if token == "[*]":
                if isinstance(item, list):
                    step.extend(item)
            elif token.startswith("[") and token.endswith("]"):
                idx = int(token[1:-1])
                if isinstance(item, list) and -len(item) <= idx < len(item):
                    step.append(item[idx])
            elif isinstance(item, dict) and token in item:
                step.append(item[token])
        current = step
        if not current:
            break
    return current


def schema_of(value: Any, depth: int = 0, max_depth: int = 4) -> Any:
    """A JSON body's shape — keys, types, array lengths — instead of its content.

    Often 100x smaller than the body and usually the actual question: what does
    this endpoint return, and which field holds the thing being scraped.
    """
    if depth >= max_depth:
        return "…"
    if isinstance(value, dict):
        return {key: schema_of(item, depth + 1, max_depth) for key, item in value.items()}
    if isinstance(value, list):
        if not value:
            return []
        return [f"{len(value)} items of", schema_of(value[0], depth + 1, max_depth)]
    return type(value).__name__


def _text_from_html(html: str, selector: str) -> list[str]:
    """A tag / .class / #id selector over a body, via the stdlib parser.

    Full CSS would mean a dependency the vendored bundle cannot take. What is
    not supported is refused by name — a selector that silently matches nothing
    is indistinguishable from a page that changed.
    """
    from html.parser import HTMLParser

    selector = selector.strip()
    if re.fullmatch(r"[A-Za-z][\w-]*", selector):
        want_tag, want_attr, want_value = selector.lower(), None, None
    elif selector.startswith(".") and re.fullmatch(r"\.[\w-]+", selector):
        want_tag, want_attr, want_value = None, "class", selector[1:]
    elif selector.startswith("#") and re.fullmatch(r"#[\w-]+", selector):
        want_tag, want_attr, want_value = None, "id", selector[1:]
    else:
        raise FilterError(
            f"--css {selector!r}: only `tag`, `.class` and `#id` are supported. "
            "Use --xpath for anything structural, or --extract-body and a real parser"
        )

    class Collector(HTMLParser):
        def __init__(self) -> None:
            super().__init__()
            self.depth = 0
            self.out: list[str] = []
            self.buffer: list[str] = []

        def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
            if self.depth:
                self.depth += 1
                return
            values = dict(attrs)
            by_tag = want_tag is not None and tag == want_tag
            by_attr = want_attr is not None and want_value in (
                values.get(want_attr) or ""
            ).split()
            if by_tag or by_attr:
                self.depth = 1

        def handle_endtag(self, tag: str) -> None:
            if self.depth:
                self.depth -= 1
                if not self.depth:
                    self.out.append("".join(self.buffer).strip())
                    self.buffer = []

        def handle_data(self, data: str) -> None:
            if self.depth:
                self.buffer.append(data)

    parser = Collector()
    parser.feed(html)
    return [item for item in parser.out if item]


def _decoded_response(entry: dict[str, Any]) -> Any:
    response = entry.get("response") or {}
    encoding = next(
        (
            h.get("value")
            for h in response.get("headers") or []
            if str(h.get("name", "")).lower() == "content-encoding"
        ),
        None,
    )
    return decode_body(response.get("content") or {}, content_encoding=encoding)


def format_row(row: dict[str, Any], width: int = 78) -> str:
    size = row.get("respBytes") or 0
    ms = row.get("ms") or 0
    mime = (row.get("mime") or "").split(";")[0]
    return (
        f"{row['i']:>4}  {(row.get('method') or ''):<6} {row.get('status') or '---'!s:<4} "
        f"{elide(mime, 24):<24} {size:>8} {ms:>7.0f}ms  {elide(row.get('url') or '', width)}"
    )


def show_entry(entry: dict[str, Any], row: dict[str, Any], max_body: int) -> list[str]:
    """One entry in full. Real values: this is an operator reading their own capture."""
    request = entry.get("request") or {}
    response = entry.get("response") or {}
    lines = [f"[{row['i']}] {request.get('method', '')} {request.get('url', '')}"]
    if row.get("query"):
        lines.append("query:")
        lines += [f"  {name} = {value}" for name, value in row["query"]]
    lines.append("request headers:")
    lines += [
        f"  {h.get('name')}: {h.get('value')}" for h in (request.get("headers") or [])
    ]
    post = request.get("postData") or {}
    if post.get("text"):
        decoded = decode_body(post)
        lines.append(f"request body ({post.get('mimeType', '?')}):")
        lines.append("  " + (decoded.text or f"<{decoded.reason}>")[:max_body])
    lines.append(f"response: {response.get('status')} {response.get('statusText', '')}")
    lines += [f"  {h.get('name')}: {h.get('value')}" for h in (response.get("headers") or [])]
    decoded = _decoded_response(entry)
    if not decoded.present:
        # Distinct from "no match" on purpose: a session told the wrong one goes
        # hunting for an endpoint it already found.
        lines.append("response body: NO BODY CAPTURED — re-export with content to search it")
    elif not decoded.ok:
        lines.append(f"response body: could not decode — {decoded.reason}")
    else:
        text = decoded.text or ""
        lines.append(f"response body ({len(text)} chars, {decoded.charset}):")
        lines.append(text[:max_body] + ("…" if len(text) > max_body else ""))
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="the .har file")
    add_selection_args(parser)

    show = parser.add_argument_group("output")
    show.add_argument("--list-only", action="store_true", help="one line per entry (default)")
    show.add_argument("--show", type=int, metavar="IDX", help="one entry in full")
    show.add_argument("--json", action="store_true", dest="as_json", help="machine-readable")
    show.add_argument("--fields", metavar="A,B", help="restrict --json to these row fields")
    show.add_argument("--limit", type=int, default=20, help="row cap; 0 removes both caps")
    show.add_argument("--output", type=Path, metavar="PATH", help="write the FULL result to a file")
    show.add_argument("--max-body", type=int, default=2000, help="chars of body in --show")

    extract = parser.add_argument_group("extract")
    extract.add_argument(
        "--extract-body", action="store_true", help="write matching bodies to files"
    )
    extract.add_argument("--output-dir", type=Path, metavar="DIR", help="destination for bodies")
    extract.add_argument("--json-path", metavar="EXPR", help="pull a value out of a JSON body")
    extract.add_argument("--css", metavar="SELECTOR", help="tag, .class or #id from an HTML body")
    extract.add_argument("--xpath", metavar="EXPR", help="ElementTree path from an XML body")
    extract.add_argument("--schema", action="store_true", help="print a JSON body's shape")
    extract.add_argument(
        "--secrets", action="store_true",
        help="answer value patterns against redacted headers by reading the capture",
    )
    args = parser.parse_args(argv)

    if not args.input.is_file():
        print(f"query_har: no such file: {args.input}", file=sys.stderr)
        return 2
    if args.extract_body and not args.output_dir:
        print("query_har: --extract-body needs --output-dir", file=sys.stderr)
        return 2
    collision = output_collision(args, inputs=("input",))
    if collision:
        print(f"query_har: {collision}", file=sys.stderr)
        return 2

    try:
        selection = selection_from_args(args)
    except FilterError as exc:
        print(f"query_har: {exc}", file=sys.stderr)
        return 2

    if selection.needs_body() and selection._header_needs_body() and not args.secrets:
        print(
            "query_har: a value pattern on a redacted header needs --secrets — "
            "the index stores those values redacted, so the answer must come from the capture",
            file=sys.stderr,
        )
        return 2

    try:
        header, rows = ensure_index(args.input)
    except (HarStructureError, OSError, ValueError) as exc:
        print(f"query_har: cannot read {args.input}: {exc}", file=sys.stderr)
        return 1

    data: bytes | None = None
    spans = None

    def load_capture() -> tuple[bytes, list[Any]]:
        """Read the capture once, and verify it is what the index was built from.

        Size and mtime are not a content identity, so no byte offset is trusted
        on their word. This costs one pass over a file this command was already
        going to read.
        """
        nonlocal data, spans
        if data is None:
            data = args.input.read_bytes()
            verify_for_seek(args.input, header, data)
            spans = scan_entries(data)
        assert spans is not None
        return data, spans

    matched: list[dict[str, Any]] = []
    entries: dict[int, dict[str, Any]] = {}
    try:
        for row in rows:
            if args.show is not None and row["i"] != args.show:
                continue
            hit = selection.matches_index(row)
            if hit and selection.needs_body():
                blob, found = load_capture()
                entry = read_entry(blob, found[row["i"]])
                hit = selection.matches_body(entry)
                if hit:
                    entries[row["i"]] = entry
            if hit == selection.invert:
                continue
            matched.append(row)
    except (HarStructureError, OSError, ValueError) as exc:
        print(f"query_har: {exc}", file=sys.stderr)
        return 1

    if not matched:
        print("no entries matched", file=sys.stderr)
        return 1

    uncapped = args.limit == 0 or args.output is not None
    limited = matched if uncapped else matched[: args.limit]

    lines: list[str] = []
    payload: dict[str, Any] | None = None

    if args.show is not None:
        row = matched[0]
        blob, found = load_capture()
        entry = entries.get(row["i"]) or read_entry(blob, found[row["i"]])
        if args.schema or args.json_path or args.css or args.xpath:
            lines = _extracted_lines(entry, args)
        else:
            lines = show_entry(entry, row, args.max_body)
    elif args.extract_body:
        lines = _extract_bodies(limited, args, load_capture, entries)
    elif args.schema or args.json_path or args.css or args.xpath:
        blob, found = load_capture()
        for row in limited:
            entry = entries.get(row["i"]) or read_entry(blob, found[row["i"]])
            lines.append(f"[{row['i']}] {elide(row.get('url') or '', 70)}")
            lines += [f"  {line}" for line in _extracted_lines(entry, args)]
    elif args.as_json:
        fields = [f.strip() for f in args.fields.split(",")] if args.fields else None
        payload = _json_payload(limited, matched, fields, uncapped)
    else:
        lines = [format_row(row) for row in limited]

    return _emit(lines, payload, matched, limited, args, uncapped)


def _extracted_lines(entry: dict[str, Any], args: argparse.Namespace) -> list[str]:
    """`--schema`, `--json-path`, `--css`, `--xpath` against one entry's body."""
    decoded = _decoded_response(entry)
    if not decoded.present:
        return ["NO BODY CAPTURED — re-export with content"]
    if not decoded.ok:
        return [f"could not decode — {decoded.reason}"]
    text = decoded.text or ""
    try:
        if args.schema or args.json_path:
            parsed = json.loads(text)
            if args.json_path:
                found = json_path(parsed, args.json_path)
                return [json.dumps(item, ensure_ascii=False) for item in found] or ["<no match>"]
            return json.dumps(schema_of(parsed), indent=1, ensure_ascii=False).splitlines()
        if args.css:
            return _text_from_html(text, args.css) or ["<no match>"]
        if args.xpath:
            import xml.etree.ElementTree as ET

            root = ET.fromstring(text)
            return [
                (node.text or "").strip() for node in root.findall(args.xpath) if node.text
            ] or ["<no match>"]
    # Deliberately broad. This runs once per entry in a loop over the whole
    # capture, and every extractor here raises something outside a tuple an
    # author would think to write: `ET.fromstring` raises `ParseError`, which
    # subclasses `SyntaxError`, not `ValueError`. A handler that is too broad
    # costs one misleading `cannot extract:` line on one row; one that is too
    # narrow costs the entire query, and reads as a broken tool rather than as
    # one unreadable body.
    except Exception as exc:
        return [f"cannot extract: {exc}"]
    return []


def _extract_bodies(
    rows: list[dict[str, Any]],
    args: argparse.Namespace,
    load_capture: Any,
    entries: dict[int, dict[str, Any]],
) -> list[str]:
    """Decode and write each matching body, never outside `--output-dir`."""
    out_dir = args.output_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    blob, found = load_capture()
    lines = [
        f"! extracted bodies are as sensitive as the capture — redaction does not reach "
        f"inside them. Writing to {out_dir}"
    ]
    written = skipped = 0
    for row in rows:
        entry = entries.get(row["i"]) or read_entry(blob, found[row["i"]])
        decoded = _decoded_response(entry)
        if not decoded.present:
            skipped += 1
            continue
        name = safe_filename(row["i"], row.get("url") or "", row.get("mime") or "")
        target = (out_dir / name).resolve()
        # The second guard. `safe_filename` flattens, and this refuses anything
        # that still resolves outside the directory — an arbitrary file write
        # driven by an untrusted document is the worst outcome available here.
        if out_dir not in target.parents and target.parent != out_dir:
            lines.append(f"  refused {name}: resolves outside {out_dir}")
            skipped += 1
            continue
        if decoded.ok and is_textual(row.get("mime")):
            target.write_text(decoded.text or "", encoding="utf-8")
        elif decoded.raw is not None:
            target.write_bytes(decoded.raw)
        else:
            skipped += 1
            continue
        written += 1
    lines.append(f"wrote {written} body(ies), skipped {skipped} with none captured")
    return lines


def _json_payload(
    limited: list[dict[str, Any]],
    matched: list[dict[str, Any]],
    fields: list[str] | None,
    uncapped: bool,
) -> dict[str, Any]:
    rows = [
        {key: row.get(key) for key in fields} if fields else row
        for row in limited
    ]
    return {
        "entries": rows,
        "shown": len(rows),
        "matched": len(matched),
        "truncated": not uncapped and len(rows) < len(matched),
    }


def _emit(
    lines: list[str],
    payload: dict[str, Any] | None,
    matched: list[dict[str, Any]],
    limited: list[dict[str, Any]],
    args: argparse.Namespace,
    uncapped: bool,
) -> int:
    """Write the result, applying the budget only to what is rendered for a reader."""
    if payload is not None:
        if args.output:
            args.output.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            print(f"wrote {len(payload['entries'])} entries to {args.output}", file=sys.stderr)
            return 0
        # Bounded output must still PARSE, so the budget drops whole entries
        # from a fixed envelope rather than cutting bytes mid-structure.
        while True:
            text = json.dumps(payload, ensure_ascii=False)
            if uncapped or len(text.encode()) <= 4096 or not payload["entries"]:
                break
            payload["entries"].pop()
            payload["shown"] = len(payload["entries"])
            payload["truncated"] = True
        print(text)
        return 0

    if args.output:
        args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"wrote {len(lines)} line(s) to {args.output}", file=sys.stderr)
        return 0

    kept, note = apply_budget(lines, 0 if uncapped else 4096)
    print("\n".join(kept))
    if note:
        print(note)
    elif len(limited) < len(matched):
        print(f"… {len(matched) - len(limited)} more entr(ies) dropped by --limit {args.limit}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
