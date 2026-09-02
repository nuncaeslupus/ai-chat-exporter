#!/usr/bin/env python3
"""analyze_har.py — reduce a capture to insight, and build the index everything else uses.

The command run first, and the one that answers "what is even in here". A HAR is
5-500 MB of JSON, so the one thing nobody can do with it is read it; the few
hundred bytes that matter are reachable only through a script.

    analyze_har.py --input capture.har              # overview
    analyze_har.py --input capture.har --index      # build/refresh the sidecar
    analyze_har.py --input capture.har --index --verify-offsets

The sidecar (`<file>.har.index.jsonl`, one JSON object per entry, no bodies) is
what makes every later query cheap: filters, statistics and listings run against
it alone — flat memory, independent of the capture's body bytes, which is where
a HAR's size actually lives.

Exit: 0 on success, 1 when the capture cannot be read, 2 on a usage error.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _harlib import (
    EntrySpan,
    HarStructureError,
    apply_budget,
    decode_body,
    digest,
    elide,
    is_sensitive_header,
    is_textual,
    new_salt,
    output_collision,
    read_entry,
    redact_pairs,
    redact_url,
    scan_entries,
)

INDEX_VERSION = 2


def index_path(har: Path) -> Path:
    return har.with_name(har.name + ".index.jsonl")


# --------------------------------------------------------------------------
# Building
# --------------------------------------------------------------------------


def _pairs(items: Any) -> list[tuple[str, str]]:
    """HAR name/value arrays to pairs, tolerating the shapes exporters actually write."""
    out: list[tuple[str, str]] = []
    if not isinstance(items, list):
        return out
    for item in items:
        if isinstance(item, dict) and "name" in item:
            out.append((str(item["name"]), str(item.get("value", ""))))
    return out


def _infer_type(entry: dict[str, Any], mime: str) -> tuple[str, str]:
    """`_resourceType` when the exporter wrote one, otherwise an inference that says so.

    Reported as inferred rather than presented as fact: a filter that silently
    guesses is a filter whose result cannot be trusted when it matters.
    """
    declared = entry.get("_resourceType")
    if isinstance(declared, str) and declared:
        return declared, "declared"
    request = entry.get("request") or {}
    headers = {n.lower(): v for n, v in _pairs(request.get("headers"))}
    base = mime.split(";")[0].strip().lower()
    if headers.get("x-requested-with", "").lower() == "xmlhttprequest":
        return "xhr", "inferred"
    if "accept" in headers and "application/json" in headers["accept"] and base != "text/html":
        return "xhr", "inferred"
    if base.startswith("image/"):
        return "image", "inferred"
    if base.startswith("font/") or "font" in base:
        return "font", "inferred"
    if base in {"text/css"}:
        return "stylesheet", "inferred"
    if base in {"text/javascript", "application/javascript"}:
        return "script", "inferred"
    if base == "text/html":
        return "document", "inferred"
    if base in {"application/json", "application/graphql"}:
        return "xhr", "inferred"
    return "other", "inferred"


def build_row(entry: dict[str, Any], span: EntrySpan, salt: str) -> dict[str, Any]:
    """One index line. No bodies — only whether one is there and how it is encoded."""
    request = entry.get("request") or {}
    response = entry.get("response") or {}
    content = response.get("content") or {}
    url = str(request.get("url", ""))
    parts = urlsplit(url)
    mime = str(content.get("mimeType", ""))
    rtype, tsrc = _infer_type(entry, mime)

    # Query pairs come from the URL rather than `request.queryString`, which
    # some exporters omit — and are kept as pairs in captured order, because
    # `?tag=a&tag=b` is two values for one name and sorting them would make two
    # different requests compare equal.
    query = [[n, v] for n, v in parse_qsl(parts.query, keep_blank_values=True)]

    post = request.get("postData") or {}
    return {
        "i": span.index,
        "off": span.offset,
        "len": span.length,
        "ts": entry.get("startedDateTime"),
        "ms": entry.get("time"),
        "page": entry.get("pageref"),
        "method": str(request.get("method", "")).upper(),
        "url": redact_url(url, salt),
        "host": parts.hostname or "",
        "port": parts.port,
        "scheme": parts.scheme,
        "path": parts.path,
        "query": query,
        "status": response.get("status"),
        "statusText": response.get("statusText", ""),
        "mime": mime,
        "type": rtype,
        "typeSrc": tsrc,
        "reqBytes": request.get("bodySize"),
        "respBytes": content.get("size"),
        # Three-state on purpose: true / false / null = the exporter never said.
        # Folding the third into `false` would make `--no-cache` mean different
        # things on a Chrome capture and a Playwright one, silently.
        "cache": entry.get("_fromCache") if "_fromCache" in entry else None,
        "reqHeaders": redact_pairs(_pairs(request.get("headers")), salt, headers=True),
        "respHeaders": redact_pairs(_pairs(response.get("headers")), salt, headers=True),
        "hasReqBody": bool(post.get("text")),
        # Unsalted on purpose, unlike every other derived value in the row:
        # `compare_har` pairs rows across two independently indexed captures,
        # and a per-run salt would make the same body hash differently on each
        # side — which is the one thing this field exists to prevent. A SHA-256
        # of the bytes is not reversible, and the body itself never enters the
        # sidecar.
        "reqBodyHash": (
            hashlib.sha256(str(post.get("text")).encode("utf-8", "surrogatepass")).hexdigest()[:16]
            if post.get("text")
            else None
        ),
        "reqMime": post.get("mimeType"),
        "hasRespBody": content.get("text") is not None,
        "bodyEncoding": content.get("encoding"),
        "textual": is_textual(mime),
        "ws": len(entry.get("_webSocketMessages") or []) or None,
        "redirect": response.get("redirectURL") or None,
    }


def build_index(har: Path, *, verify: bool = False) -> tuple[Path, int, list[str]]:
    """Write the sidecar. Returns (path, row count, problems)."""
    data = har.read_bytes()
    spans = scan_entries(data)
    salt = new_salt()
    problems: list[str] = []

    header = {
        "index_version": INDEX_VERSION,
        "source": har.name,
        "size": len(data),
        "mtime": int(har.stat().st_mtime),
        "digest": digest(data),
        "entries": len(spans),
    }

    target = index_path(har)
    # Same directory, not the system temp dir: `rename` is only atomic within a
    # filesystem, so a temp file elsewhere fails with EXDEV the moment the
    # capture lives on another mount — the normal case for a large HAR on an
    # external disk. Without the atomic swap, an interrupted build leaves a
    # truncated JSONL whose header line is perfectly valid, so the next run
    # trusts it and answers every query from a partial index.
    handle, tmp_name = tempfile.mkstemp(dir=str(har.parent), prefix=".har-index-", suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as out:
            out.write(json.dumps(header, separators=(",", ":")) + "\n")
            for span in spans:
                entry = read_entry(data, span)
                if verify:
                    reparsed = json.loads(data[span.offset : span.end])
                    if reparsed != entry:  # pragma: no cover - identical by construction
                        problems.append(f"entry {span.index}: re-parse from offset differs")
                out.write(
                    json.dumps(build_row(entry, span, salt), separators=(",", ":"), default=str)
                    + "\n"
                )
            out.flush()
            os.fsync(out.fileno())
        tmp.replace(target)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise

    if verify:
        problems += verify_offsets(har, data, spans)
    return target, len(spans), problems


def verify_offsets(har: Path, data: bytes, spans: list[EntrySpan]) -> list[str]:
    """Re-parse the whole capture and compare every entry against its span.

    The offset scanner is the one risky part of this toolkit: a wrong span is a
    wrong body for an entry, which is a silent wrong answer. This is the check
    that makes that failure loud, and it is why the mode exists at all.
    """
    problems: list[str] = []
    try:
        truth = json.loads(data)["log"]["entries"]
    except (ValueError, KeyError, TypeError) as exc:
        return [f"cannot re-parse {har.name} to verify offsets: {exc}"]
    if len(truth) != len(spans):
        problems.append(f"offset scan found {len(spans)} entries, the parser found {len(truth)}")
    for span, expected in zip(spans, truth, strict=False):
        if read_entry(data, span) != expected:
            problems.append(
                f"entry {span.index}: bytes at offset {span.offset} are a different entry"
            )
    return problems


# --------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------


def _header_is_current(header: dict[str, Any], har: Path) -> bool:
    """Currency is size and mtime — deliberately not the content digest.

    Verifying a digest means reading the whole capture, which is the exact cost
    the sidecar exists to avoid, and a metadata query never uses a byte offset.
    The digest is checked only by the commands that seek (`verify_for_seek`).
    """
    stat = har.stat()
    return (
        header.get("index_version") == INDEX_VERSION
        and header.get("size") == stat.st_size
        and header.get("mtime") == int(stat.st_mtime)
    )


def open_index(har: Path) -> tuple[dict[str, Any], Iterator[dict[str, Any]]] | None:
    """The sidecar as a header plus a *stream* of rows, or None if it is stale.

    Streamed rather than materialised, because a list of 50k parsed rows is
    ~240 MB and ~1.3 s before a single one has been looked at — which breaks
    SC3's memory bound with the index doing exactly what it was built to avoid.
    Every consumer here folds rows as they arrive, so nothing needs them all in
    memory at once.

    The declared row count is checked when the stream is exhausted, not up
    front: counting first would mean reading the file twice. A caller that
    stops early skips the check, which is correct — it stopped because it found
    what it wanted.
    """
    path = index_path(har)
    try:
        handle = path.open(encoding="utf-8")
    except OSError:
        return None
    try:
        header = json.loads(handle.readline())
        if not isinstance(header, dict) or not _header_is_current(header, har):
            handle.close()
            return None
    except (OSError, ValueError):
        handle.close()
        return None

    def rows() -> Iterator[dict[str, Any]]:
        seen = 0
        try:
            for line in handle:
                if not line.strip():
                    continue
                seen += 1
                yield json.loads(line)
        finally:
            handle.close()
        declared = header.get("entries")
        if isinstance(declared, int) and seen != declared:
            raise HarStructureError(
                f"{path.name} holds {seen} rows but declares {declared} — "
                "the index is truncated; re-run `analyze_har.py --index`"
            )

    return header, rows()


def load_index(har: Path) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    """`open_index`, materialised. For callers that genuinely need every row."""
    opened = open_index(har)
    if opened is None:
        return None
    header, stream = opened
    return header, list(stream)


def verify_for_seek(har: Path, header: dict[str, Any], data: bytes) -> None:
    """Raise unless the capture is byte-for-byte what the index was built from.

    Size and mtime are not a content identity — a copy-preserving move or a
    coarse filesystem clock carries both across two different files — so no
    offset is ever trusted on their word. This costs one pass over a file the
    calling command is already reading.
    """
    if header.get("digest") != digest(data):
        raise HarStructureError(
            "the capture changed since its index was built; "
            "re-run `analyze_har.py --index` before reading bodies by offset"
        )


def ensure_index(
    har: Path, *, rebuild: bool = False
) -> tuple[dict[str, Any], Iterator[dict[str, Any]]]:
    """The current index as a stream, building it first when it is missing or stale."""
    if not rebuild:
        opened = open_index(har)
        if opened is not None:
            return opened
    build_index(har)
    opened = open_index(har)
    if opened is None:  # pragma: no cover - would mean we wrote an index we cannot read
        raise HarStructureError(f"could not read the index just written for {har}")
    return opened


# --------------------------------------------------------------------------
# Overview
# --------------------------------------------------------------------------


def overview(rows: Iterable[dict[str, Any]]) -> list[str]:
    """The first answer: what is in here, and does this site have an API.

    One pass over the row stream, folding as it goes — nothing accumulates but
    the counters, so the overview of a 500 MB capture costs the same memory as
    the overview of a small one.
    """
    from collections import Counter

    hosts: Counter[str] = Counter()
    types: Counter[str] = Counter()
    statuses: Counter[str] = Counter()
    total_bytes = 0
    total = api = 0
    first_ts: str | None = None
    last_ts: str | None = None

    for row in rows:
        total += 1
        if row["host"]:
            hosts[row["host"]] += 1
        types[row["type"]] += 1
        if row["status"] is not None:
            statuses[f"{row['status'] // 100}xx"] += 1
        total_bytes += row["respBytes"] or 0
        if row["type"] in {"xhr", "fetch"} or "json" in (row["mime"] or ""):
            api += 1
        ts = row["ts"]
        if ts:
            first_ts = ts if first_ts is None or ts < first_ts else first_ts
            last_ts = ts if last_ts is None or ts > last_ts else last_ts

    times = [t for t in (first_ts, last_ts) if t]
    lines = [
        f"{total} entries · {len(hosts)} host(s) · {total_bytes / 1e6:.1f} MB of bodies",
    ]
    if times:
        lines.append(f"span: {times[0]} → {times[-1]}")
    lines.append("types: " + ", ".join(f"{k} {v}" for k, v in types.most_common(8)))
    lines.append("status: " + ", ".join(f"{k} {v}" for k, v in sorted(statuses.items())))
    lines.append("hosts: " + ", ".join(f"{elide(k, 40)} {v}" for k, v in hosts.most_common(5)))
    lines.append(
        f"API-shaped requests (xhr/fetch/json): {api}"
        + ("  ← this site has an API worth reading" if api else "  ← no XHR/JSON; page-rendered")
    )
    return lines


# --------------------------------------------------------------------------
# Insight modes
# --------------------------------------------------------------------------

_ID_SEGMENT = re.compile(
    r"^(\d+|[0-9a-f]{8,}|[0-9a-f-]{32,}|[A-Za-z0-9_-]{22,})$", re.IGNORECASE
)


def path_template(path: str) -> str:
    """Collapse identifier-looking segments so two URLs for one endpoint agree.

    `/api/jobs/12345` and `/api/jobs/98765` are one endpoint asked twice, and a
    listing that shows them as two teaches nothing. Numeric, hex and long
    opaque segments become `{id}`; everything else is left alone, because a
    template that collapses real path words invents endpoints that do not exist.
    """
    parts = []
    for segment in path.split("/"):
        parts.append("{id}" if segment and _ID_SEGMENT.match(segment) else segment)
    return "/".join(parts)


def endpoints(rows: Iterable[dict[str, Any]], limit: int) -> list[str]:
    """URL paths collapsed to templates, with which parameters vary and over what.

    The pagination finder, and the mode that earns this script. Turning
    `/api/jobs?page=1&loc=NY`, `?page=2&loc=NY`, `?page=3&loc=NY` into one row
    saying `page` varies 1-3 while `loc` is constant is the difference between
    reading forty URLs and reading how to iterate the site.
    """
    from collections import defaultdict

    groups: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in rows:
        key = (row.get("method") or "", row.get("host") or "", path_template(row.get("path") or ""))
        group = groups.setdefault(
            key, {"n": 0, "params": defaultdict(list), "status": set(), "bytes": 0}
        )
        group["n"] += 1
        group["status"].add(row.get("status"))
        group["bytes"] += row.get("respBytes") or 0
        for name, value in row.get("query") or []:
            group["params"][name].append(value)

    lines: list[str] = []
    ordered = sorted(groups.items(), key=lambda item: (-item[1]["n"], item[0]))
    for (method, host, template), group in ordered[: limit or None]:
        statuses = ",".join(str(s) for s in sorted(x for x in group["status"] if x is not None))
        lines.append(f"{method:<6} {host}{template}  x{group['n']}  [{statuses}]")
        for name, values in sorted(group["params"].items()):
            distinct = sorted(set(values))
            if len(distinct) == 1:
                lines.append(f"    {name} = {elide(distinct[0], 40)}  (constant)")
            else:
                span = (
                    f"{distinct[0]}..{distinct[-1]}"
                    if len(distinct) > 3
                    else ", ".join(distinct)
                )
                lines.append(f"    {name} varies over {len(distinct)}: {elide(span, 46)}")
    return lines or ["no entries"]


def header_analysis(rows: Iterable[dict[str, Any]], limit: int) -> list[str]:
    """Request headers by host, split into constant across requests versus varying.

    A header sent identically on every request to a host is a candidate
    credential; one that changes per request is not. The split only works
    because redacted values keep a salted fingerprint — with a bare marker
    every `Authorization` would compare equal and the interesting half would
    disappear into the boring one.
    """
    from collections import defaultdict

    by_host: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    counts: dict[str, int] = defaultdict(int)
    seen: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for row in rows:
        host = row.get("host") or ""
        counts[host] += 1
        for name, value in row.get("reqHeaders") or []:
            by_host[host][name].add(value)
            seen[host][name] += 1

    lines: list[str] = []
    for host in sorted(by_host, key=lambda h: -counts[h])[: limit or None]:
        lines.append(f"{host}  ({counts[host]} requests)")
        constant = [
            name
            for name, values in by_host[host].items()
            if len(values) == 1 and seen[host][name] == counts[host]
        ]
        varying = [n for n in by_host[host] if n not in constant]
        for name in sorted(constant):
            value = next(iter(by_host[host][name]))
            marker = "  ← candidate auth" if is_sensitive_header(name) else ""
            lines.append(f"    constant  {name}: {elide(value, 44)}{marker}")
        for name in sorted(varying):
            lines.append(f"    varying   {name} ({len(by_host[host][name])} distinct)")
    return lines or ["no entries"]


def cookie_analysis(rows: Iterable[dict[str, Any]], limit: int) -> list[str]:
    """Cookies sent and set, by domain, with their flags.

    Values are redacted; names and attributes are not, because those are what
    say which cookie authenticates and whether it is `HttpOnly`.
    """
    from collections import defaultdict

    sent: dict[str, set[str]] = defaultdict(set)
    setby: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        host = row.get("host") or ""
        for name, value in row.get("reqHeaders") or []:
            if name == "cookie":
                for chunk in value.split(";"):
                    key = chunk.split("=")[0].strip()
                    if key:
                        sent[host].add(key)
        for name, value in row.get("respHeaders") or []:
            if name == "set-cookie":
                parts = [c.strip() for c in value.split(";")]
                flags = [
                    part
                    for part in parts[1:]
                    if "=" not in part or part.lower().startswith(("path", "domain"))
                ]
                setby[host].add(f"{parts[0].split('=')[0]} [{', '.join(flags) or 'no flags'}]")

    lines: list[str] = []
    for host in sorted(set(sent) | set(setby))[: limit or None]:
        lines.append(host)
        if sent[host]:
            lines.append(f"    sent: {', '.join(sorted(sent[host]))}")
        for entry in sorted(setby[host]):
            lines.append(f"    set:  {entry}")
    return lines or ["no cookies in this capture"]


def stats(rows: Iterable[dict[str, Any]], field: str, limit: int) -> list[str]:
    """A histogram over one field. Sizes and times are bucketed, everything else is exact."""
    from collections import Counter

    buckets: Counter[str] = Counter()
    total = 0
    for row in rows:
        total += 1
        if field == "status":
            buckets[str(row.get("status"))] += 1
        elif field == "host":
            buckets[row.get("host") or "<none>"] += 1
        elif field == "mime":
            buckets[(row.get("mime") or "<none>").split(";")[0]] += 1
        elif field == "type":
            buckets[row.get("type") or "<none>"] += 1
        elif field == "method":
            buckets[row.get("method") or "<none>"] += 1
        elif field == "size":
            edges = (1_000, 10_000, 100_000, 1_000_000)
            buckets[_bucket(row.get("respBytes") or 0, edges, "B")] += 1
        elif field == "time":
            buckets[_bucket(row.get("ms") or 0, (50, 200, 1_000, 5_000), "ms")] += 1
        else:
            raise FilterlessError(
                f"--stats {field}: choose status, host, mime, type, method, size or time"
            )
    width = max((len(k) for k in buckets), default=1)
    lines = [f"{field} over {total} entries"]
    for key, count in buckets.most_common(limit or None):
        bar = "#" * min(40, max(1, round(40 * count / max(1, total))))
        lines.append(f"  {key:<{width}}  {count:>6}  {bar}")
    return lines


def _bucket(value: float, edges: tuple[float, ...], unit: str) -> str:
    previous = 0.0
    for edge in edges:
        if value < edge:
            return f"{previous:g}-{edge:g}{unit}"
        previous = edge
    return f">{edges[-1]:g}{unit}"


class FilterlessError(ValueError):
    """A mode argument that names nothing this script can compute."""


def redirects(rows: Iterable[dict[str, Any]], limit: int) -> list[str]:
    """Redirect chains, collapsed — where a request actually ended up."""
    lines: list[str] = []
    for row in rows:
        if row.get("status") in (301, 302, 303, 307, 308) or row.get("redirect"):
            # `response.redirectURL` is the HAR field for this, and exporters
            # leave it empty often enough that falling back to the `Location`
            # header is the difference between a chain and a list of dead ends.
            target = row.get("redirect") or next(
                (v for k, v in row.get("respHeaders") or [] if k == "location"),
                "<no Location recorded>",
            )
            lines.append(f"{row['i']:>4}  {row.get('status')}  {elide(row.get('url') or '', 44)}")
            lines.append(f"          → {elide(target, 66)}")
        if limit and len(lines) >= limit * 2:
            break
    return lines or ["no redirects in this capture"]


def websockets(
    rows: Iterable[dict[str, Any]], read_entry_by_index: Any, limit: int
) -> list[str]:
    """Per-socket frame counts, direction and the first frames.

    Sites that stream their data over a socket have no HTTP response body to
    search, so a capture can look empty while carrying everything.
    """
    lines: list[str] = []
    shown = 0
    for row in rows:
        if not row.get("ws"):
            continue
        entry = read_entry_by_index(row["i"])
        frames = entry.get("_webSocketMessages") or []
        sent = sum(1 for f in frames if f.get("type") == "send")
        received = len(frames) - sent
        size = sum(len(str(f.get("data", ""))) for f in frames)
        lines.append(
            f"{row['i']:>4}  {elide(row.get('url') or '', 52)}  "
            f"{len(frames)} frames ({sent} sent, {received} received), {size} B"
        )
        for frame in frames[:3]:
            arrow = "→" if frame.get("type") == "send" else "←"
            lines.append(f"        {arrow} {elide(str(frame.get('data', '')), 70)}")
        shown += 1
        if limit and shown >= limit:
            break
    return lines or ["no websocket frames in this capture"]


def errors(rows: Iterable[dict[str, Any]], read_entry_by_index: Any, limit: int) -> list[str]:
    """Every non-2xx, with a short body snippet where one exists.

    The snippet is the point: an API that returns 400 with
    `{"error":"missing page param"}` has told you how to fix the request.
    """
    lines: list[str] = []
    shown = 0
    for row in rows:
        status = row.get("status")
        # Non-2xx, minus 1xx: a 101 is a websocket upgrade succeeding, and
        # listing protocol handshakes as errors trains a reader to skim the
        # list that exists to be read.
        if status is None or 100 <= status < 300:
            continue
        lines.append(
            f"{row['i']:>4}  {status} {row.get('statusText', '')}  "
            f"{elide(row.get('url') or '', 60)}"
        )
        if row.get("hasRespBody"):
            entry = read_entry_by_index(row["i"])
            decoded = decode_body((entry.get("response") or {}).get("content") or {})
            if decoded.ok and decoded.text:
                snippet = " ".join(decoded.text.split())[:120]
                lines.append(f"        {snippet}")
        shown += 1
        if limit and shown >= limit:
            break
    return lines or ["no non-2xx responses in this capture"]


def top_by(rows: Iterable[dict[str, Any]], key: str, limit: int) -> list[str]:
    """Top-N by time or size — the format's original purpose, still useful."""
    field = "ms" if key == "time" else "respBytes"
    ranked = sorted(rows, key=lambda r: r.get(field) or 0, reverse=True)[: limit or None]
    unit = "ms" if key == "time" else "B"
    return [
        f"{row.get(field) or 0:>10.0f}{unit}  {row.get('status')}  "
        f"{elide(row.get('url') or '', 58)}"
        for row in ranked
    ] or ["no entries"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="the .har file")
    parser.add_argument(
        "--index", action="store_true", help="build or refresh the index sidecar and exit"
    )
    parser.add_argument(
        "--verify-offsets",
        action="store_true",
        help="re-parse every entry from its byte offset and compare — proves the scanner",
    )
    parser.add_argument("--no-index", action="store_true", help="do not read or write a sidecar")

    modes = parser.add_argument_group("insight", "pick one; the default is the overview")
    modes.add_argument(
        "--stats", metavar="FIELD",
        help="histogram over status, host, mime, type, method, size or time",
    )
    modes.add_argument("--errors", action="store_true", help="every non-2xx, with a body snippet")
    modes.add_argument(
        "--endpoints", action="store_true",
        help="URL paths collapsed to templates, with which parameters vary — the pagination finder",
    )
    modes.add_argument(
        "--headers", action="store_true",
        help="request headers by host, constant across requests versus varying",
    )
    modes.add_argument("--cookies", action="store_true", help="cookies sent and set, with flags")
    modes.add_argument("--redirects", action="store_true", help="redirect chains, collapsed")
    modes.add_argument("--slowest", action="store_true", help="top-N by total time")
    modes.add_argument("--largest", action="store_true", help="top-N by response body size")
    modes.add_argument("--websockets", action="store_true", help="per-socket frames and sizes")

    parser.add_argument("--json", action="store_true", dest="as_json", help="machine-readable")
    parser.add_argument("--limit", type=int, default=20, help="0 removes the row and byte caps")
    parser.add_argument(
        "--output", type=Path, metavar="PATH", help="write the FULL result to a file"
    )
    args = parser.parse_args(argv)

    if not args.input.is_file():
        print(f"analyze_har: no such file: {args.input}", file=sys.stderr)
        return 2
    collision = output_collision(args, inputs=("input",))
    if collision:
        print(f"analyze_har: {collision}", file=sys.stderr)
        return 2

    try:
        if args.index or args.verify_offsets:
            path, count, problems = build_index(args.input, verify=args.verify_offsets)
            for problem in problems:
                print(f"analyze_har: {problem}", file=sys.stderr)
            if args.as_json:
                print(json.dumps({"index": str(path), "entries": count, "problems": problems}))
            else:
                print(f"index: {path.name} — {count} entries" + (
                    f", {len(problems)} offset problem(s)" if problems else
                    (", offsets verified" if args.verify_offsets else "")
                ))
            return 1 if problems else 0

        rows: Iterable[dict[str, Any]]
        header: dict[str, Any] = {}
        if args.no_index:
            data = args.input.read_bytes()
            salt = new_salt()
            rows = (build_row(read_entry(data, span), span, salt) for span in scan_entries(data))
        else:
            header, rows = ensure_index(args.input)
    except HarStructureError as exc:
        print(f"analyze_har: {exc}", file=sys.stderr)
        return 1
    except (OSError, ValueError) as exc:
        print(f"analyze_har: cannot read {args.input}: {exc}", file=sys.stderr)
        return 1

    # Modes that need a body read get a lazy reader rather than the capture:
    # the overview, the histograms and the endpoint collapse must never open it,
    # and passing the bytes around would make that easy to lose by accident.
    capture: dict[str, Any] = {}

    def read_entry_by_index(index: int) -> dict[str, Any]:
        if "spans" not in capture:
            data = args.input.read_bytes()
            if not args.no_index:
                verify_for_seek(args.input, header, data)
            capture["data"] = data
            capture["spans"] = scan_entries(data)
        return read_entry(capture["data"], capture["spans"][index])

    try:
        lines = _run_mode(args, rows, read_entry_by_index)
    except (FilterlessError, HarStructureError) as exc:
        print(f"analyze_har: {exc}", file=sys.stderr)
        return 2 if isinstance(exc, FilterlessError) else 1

    if args.as_json:
        print(json.dumps({"mode": _mode_name(args), "lines": lines}, ensure_ascii=False))
        return 0
    if args.output:
        args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"wrote {len(lines)} line(s) to {args.output}", file=sys.stderr)
        return 0
    kept, note = apply_budget(lines, 0 if args.limit == 0 else 4096)
    print("\n".join(kept))
    if note:
        print(note)
    return 0


def _mode_name(args: argparse.Namespace) -> str:
    for name in (
        "stats", "errors", "endpoints", "headers", "cookies",
        "redirects", "slowest", "largest", "websockets",
    ):
        if getattr(args, name):
            return name
    return "overview"


def _run_mode(
    args: argparse.Namespace, rows: Iterable[dict[str, Any]], read_entry_by_index: Any
) -> list[str]:
    """Dispatch to one insight mode. The default is the overview."""
    limit = args.limit
    if args.stats:
        return stats(rows, args.stats, limit)
    if args.endpoints:
        return endpoints(rows, limit)
    if args.headers:
        return header_analysis(rows, limit)
    if args.cookies:
        return cookie_analysis(rows, limit)
    if args.redirects:
        return redirects(rows, limit)
    if args.slowest:
        return top_by(rows, "time", limit)
    if args.largest:
        return top_by(rows, "size", limit)
    if args.websockets:
        return websockets(rows, read_entry_by_index, limit)
    if args.errors:
        return errors(rows, read_entry_by_index, limit)
    return overview(rows)


if __name__ == "__main__":
    raise SystemExit(main())
