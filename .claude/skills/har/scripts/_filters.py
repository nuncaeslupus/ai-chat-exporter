#!/usr/bin/env python3
"""One selection grammar, shared by every command that picks entries out of a capture.

`query_har.py`, `create_har.py`, `compare_har.py` and eventually `run_har.py`
accept identical flags, implemented once here. A session that learns to select
entries once can list, export, prune and replay the same set — and divergent
flag sets across sibling scripts would be the most likely way for this toolkit
to become annoying.

The grammar is split in two on purpose:

* **Index predicates** answer from the sidecar alone — no capture, no bodies,
  flat memory. Everything except body content is one of these.
* **Body predicates** need an entry read back by byte offset and decoded.

They are evaluated in that order, and the second is only reached by rows the
first accepted. That ordering is not a micro-optimisation; it is what keeps a
filter that does not name a body independent of the capture's body bytes, which
is the entire premise of having an index.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from _harlib import decode_body, is_sensitive_header

# `--status 200`, `2xx`, `400-499`, or a comma-separated mix of them.
_STATUS_EXACT = re.compile(r"^(\d{3})$")
_STATUS_CLASS = re.compile(r"^([1-5])xx$", re.IGNORECASE)
_STATUS_RANGE = re.compile(r"^(\d{3})-(\d{3})$")


class FilterError(ValueError):
    """A selection flag that cannot be honoured, stated so the caller can fix it."""


def parse_status(spec: str) -> list[tuple[int, int]]:
    """`200,4xx,500-599` to inclusive ranges. Refuses anything it cannot represent."""
    ranges: list[tuple[int, int]] = []
    for part in spec.split(","):
        token = part.strip()
        if not token:
            continue
        exact = _STATUS_EXACT.match(token)
        if exact:
            code = int(exact.group(1))
            ranges.append((code, code))
            continue
        klass = _STATUS_CLASS.match(token)
        if klass:
            base = int(klass.group(1)) * 100
            ranges.append((base, base + 99))
            continue
        span = _STATUS_RANGE.match(token)
        if span:
            low, high = int(span.group(1)), int(span.group(2))
            if low > high:
                raise FilterError(f"--status {token}: the range runs backwards")
            ranges.append((low, high))
            continue
        raise FilterError(f"--status {token}: expected 200, 4xx or 400-499")
    return ranges


def parse_name_match(spec: str) -> tuple[str, re.Pattern[str] | None]:
    """`NAME` or `NAME=REGEX` — presence, or presence with a value pattern."""
    name, sep, pattern = spec.partition("=")
    if not name.strip():
        raise FilterError(f"{spec!r}: no name before the '='")
    if not sep:
        return name.strip(), None
    try:
        return name.strip(), re.compile(pattern)
    except re.error as exc:
        raise FilterError(f"{spec!r}: {exc}") from exc


def _compile(pattern: str | None, flag: str) -> re.Pattern[str] | None:
    if pattern is None:
        return None
    try:
        return re.compile(pattern, re.IGNORECASE)
    except re.error as exc:
        raise FilterError(f"{flag}: {exc}") from exc


def _as_utc(when: datetime) -> datetime:
    """Force a timestamp onto UTC so naive and aware values stay comparable.

    HAR `startedDateTime` carries an offset, but `--since`/`--until` are typed
    by hand and usually do not. Comparing the two raises TypeError, which no
    caller catches, so a bare `--since 2026-08-30` used to abort the run. A
    naive value is read as UTC rather than rejected: that is what someone
    filtering `Z` timestamps means, and it keeps the flag usable.
    """
    return when.replace(tzinfo=UTC) if when.tzinfo is None else when


def _parse_time(value: str | None, flag: str) -> datetime | None:
    if value is None:
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        return _as_utc(datetime.fromisoformat(text))
    except ValueError as exc:
        raise FilterError(f"{flag} {value!r}: expected an ISO-8601 timestamp") from exc


@dataclass
class Selection:
    """A compiled set of selection flags. Every predicate composes as AND."""

    url: re.Pattern[str] | None = None
    host: re.Pattern[str] | None = None
    methods: set[str] = field(default_factory=set)
    status: list[tuple[int, int]] = field(default_factory=list)
    mime: re.Pattern[str] | None = None
    types: set[str] = field(default_factory=set)
    min_size: int | None = None
    max_size: int | None = None
    slower_than: float | None = None
    has_header: list[tuple[str, re.Pattern[str] | None]] = field(default_factory=list)
    param: list[tuple[str, re.Pattern[str] | None]] = field(default_factory=list)
    body_match: re.Pattern[str] | None = None
    response_match: re.Pattern[str] | None = None
    page: str | None = None
    since: datetime | None = None
    until: datetime | None = None
    cache: str | None = None  # "true" | "false" | "unknown"
    invert: bool = False
    secrets: bool = False

    # ---------------------------------------------------------------- index

    def _header_needs_body(self) -> bool:
        """A value pattern against a header the index redacts cannot be answered there."""
        return any(
            pattern is not None and is_sensitive_header(name)
            for name, pattern in self.has_header
        )

    def needs_body(self) -> bool:
        """Whether matching a row requires reading the entry back from the capture."""
        return bool(self.body_match or self.response_match or self._header_needs_body())

    def matches_index(self, row: dict[str, Any]) -> bool:
        """Every predicate answerable from the sidecar. Never opens the capture."""
        if self.url and not self.url.search(row.get("url") or ""):
            return False
        if self.host and not self.host.search(row.get("host") or ""):
            return False
        if self.methods and (row.get("method") or "").upper() not in self.methods:
            return False
        if self.status:
            code = row.get("status")
            if code is None or not any(low <= code <= high for low, high in self.status):
                return False
        if self.mime and not self.mime.search(row.get("mime") or ""):
            return False
        if self.types and (row.get("type") or "") not in self.types:
            return False
        size = row.get("respBytes") or 0
        if self.min_size is not None and size < self.min_size:
            return False
        if self.max_size is not None and size > self.max_size:
            return False
        if self.slower_than is not None and (row.get("ms") or 0) < self.slower_than:
            return False
        if self.page is not None and row.get("page") != self.page:
            return False
        if self.cache is not None:
            state = row.get("cache")
            actual = "unknown" if state is None else ("true" if state else "false")
            if actual != self.cache:
                return False
        if (self.since or self.until) and not self._matches_time(row):
            return False
        if not self._matches_params(row):
            return False
        return self._matches_headers_from_index(row)

    def _matches_time(self, row: dict[str, Any]) -> bool:
        raw = row.get("ts")
        if not isinstance(raw, str):
            return False
        try:
            when = _as_utc(datetime.fromisoformat(raw.replace("Z", "+00:00")))
        except ValueError:
            return False
        if self.since and when < self.since:
            return False
        return not (self.until and when > self.until)

    def _matches_params(self, row: dict[str, Any]) -> bool:
        pairs = row.get("query") or []
        for name, pattern in self.param:
            hits = [value for key, value in pairs if key == name]
            if not hits:
                return False
            if pattern is not None and not any(pattern.search(value) for value in hits):
                return False
        return True

    def _matches_headers_from_index(self, row: dict[str, Any]) -> bool:
        """Presence always; value patterns only for headers the index did not redact."""
        headers = (row.get("reqHeaders") or []) + (row.get("respHeaders") or [])
        for name, pattern in self.has_header:
            key = name.lower()
            values = [value for header, value in headers if header == key]
            if not values:
                return False
            if pattern is None or is_sensitive_header(name):
                continue  # presence, or deferred to the body phase
            if not any(pattern.search(value) for value in values):
                return False
        return True

    # ----------------------------------------------------------------- body

    def matches_body(self, entry: dict[str, Any]) -> bool:
        """The predicates that need the entry itself. Only rows the index accepted reach here."""
        if self.body_match is not None:
            post = (entry.get("request") or {}).get("postData") or {}
            decoded = decode_body(post)
            if not decoded.ok or not self.body_match.search(decoded.text or ""):
                return False
        if self.response_match is not None:
            response = entry.get("response") or {}
            content = response.get("content") or {}
            encoding = next(
                (
                    h.get("value")
                    for h in response.get("headers") or []
                    if str(h.get("name", "")).lower() == "content-encoding"
                ),
                None,
            )
            decoded = decode_body(content, content_encoding=encoding)
            if not decoded.ok or not self.response_match.search(decoded.text or ""):
                return False
        return self._matches_headers_from_entry(entry)

    def _matches_headers_from_entry(self, entry: dict[str, Any]) -> bool:
        if not self._header_needs_body():
            return True
        request = entry.get("request") or {}
        response = entry.get("response") or {}
        headers = [
            (str(h.get("name", "")).lower(), str(h.get("value", "")))
            for h in (request.get("headers") or []) + (response.get("headers") or [])
        ]
        for name, pattern in self.has_header:
            if pattern is None or not is_sensitive_header(name):
                continue
            key = name.lower()
            values = [value for header, value in headers if header == key]
            if not any(pattern.search(value) for value in values):
                return False
        return True


def add_selection_args(parser: argparse.ArgumentParser) -> argparse._ArgumentGroup:
    """Add the shared selection flags. Spelled identically in every sibling script."""
    group = parser.add_argument_group(
        "selection", "every flag composes as AND; --invert negates the whole selection"
    )
    group.add_argument("--url", metavar="REGEX", help="match the full URL")
    group.add_argument("--host", metavar="REGEX", help="match the hostname")
    group.add_argument("--method", metavar="M", action="append", help="GET, POST, … (repeatable)")
    group.add_argument(
        "--status", metavar="SPEC", help="200, 4xx, 400-499, or a comma-separated mix"
    )
    group.add_argument("--mime", metavar="REGEX", help="match the response mime type")
    group.add_argument(
        "--type", metavar="T", action="append",
        help="resource type: xhr, fetch, document, script, image, … (repeatable)",
    )
    group.add_argument("--min-size", type=int, metavar="N", help="response body bytes >= N")
    group.add_argument("--max-size", type=int, metavar="N", help="response body bytes <= N")
    group.add_argument("--slower-than", type=float, metavar="MS", help="total time >= MS")
    group.add_argument(
        "--has-header", metavar="NAME[=REGEX]", action="append",
        help="header present, optionally with a value pattern",
    )
    group.add_argument(
        "--param", metavar="NAME[=REGEX]", action="append",
        help="query parameter present, optionally with a value pattern",
    )
    group.add_argument("--body-match", metavar="REGEX", help="match the REQUEST body")
    group.add_argument(
        "--response-match", metavar="REGEX",
        help="match the RESPONSE body — the operation this toolkit exists for",
    )
    group.add_argument("--page", metavar="ID", help="scope to one page id")
    group.add_argument("--since", metavar="ISO", help="started at or after this timestamp")
    group.add_argument("--until", metavar="ISO", help="started at or before this timestamp")
    # Three flags, not two, because `_fromCache` is three-state. Folding
    # "the exporter never said" into "false" would make --no-cache mean
    # different things on a Chrome capture and a Playwright one, silently.
    cache = group.add_mutually_exclusive_group()
    cache.add_argument("--from-cache", action="store_true", help="_fromCache is true")
    cache.add_argument("--no-cache", action="store_true", help="_fromCache is false ONLY")
    cache.add_argument(
        "--unknown-cache", action="store_true", help="the exporter recorded no _fromCache"
    )
    group.add_argument("--invert", action="store_true", help="select what does NOT match")
    return group


def selection_from_args(args: argparse.Namespace) -> Selection:
    """Compile the parsed flags. Raises FilterError with a message worth reading."""
    cache = None
    if getattr(args, "from_cache", False):
        cache = "true"
    elif getattr(args, "no_cache", False):
        cache = "false"
    elif getattr(args, "unknown_cache", False):
        cache = "unknown"

    return Selection(
        url=_compile(args.url, "--url"),
        host=_compile(args.host, "--host"),
        methods={m.upper() for m in (args.method or [])},
        status=parse_status(args.status) if args.status else [],
        mime=_compile(args.mime, "--mime"),
        types=set(args.type or []),
        min_size=args.min_size,
        max_size=args.max_size,
        slower_than=args.slower_than,
        has_header=[parse_name_match(h) for h in (args.has_header or [])],
        param=[parse_name_match(p) for p in (args.param or [])],
        body_match=_compile(args.body_match, "--body-match"),
        response_match=_compile(args.response_match, "--response-match"),
        page=args.page,
        since=_parse_time(args.since, "--since"),
        until=_parse_time(args.until, "--until"),
        cache=cache,
        invert=bool(args.invert),
        secrets=bool(getattr(args, "secrets", False)),
    )
