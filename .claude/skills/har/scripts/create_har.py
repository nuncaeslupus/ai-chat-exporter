#!/usr/bin/env python3
"""create_har.py — write a derived capture: filtered, redacted, small enough to commit.

Three uses, one operation with different flags:

* **A fixture.** A capture reduced to twelve XHR entries with redacted headers
  and no bodies is small enough to commit, and a committed capture is how a
  scraper gets a regression test that does not touch the network.
* **A smaller working copy.** A 400 MB capture with images, fonts and media
  dropped is a 3 MB file that opens instantly and travels between machines.
* **Something safe to hand over.** Redacted, body-dropped, filtered to the
  requests that matter — a file that can go in an issue without carrying a
  session.

    create_har.py --input capture.har --type xhr --output small.har
    create_har.py --input capture.har --drop-types image,font,media --output small.har
    create_har.py --input capture.har --keep-bodies --output fixture.har

Selection is the shared grammar and selects what to KEEP; `--invert` keeps what
does not match. Exit: 0 on success, 1 on a read failure, 2 on a usage error.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _filters import FilterError, add_selection_args, selection_from_args
from _harlib import (
    HarStructureError,
    fingerprint,
    is_sensitive_header,
    is_sensitive_param,
    new_salt,
    output_collision,
    read_entry,
    redact_cookie_header,
    redact_url,
    scan_entries,
)
from analyze_har import ensure_index, verify_for_seek

DEFAULT_DROP_TYPES = ("image", "font", "media", "stylesheet")


# A "://" test only catches authority-form URLs. `myapp:/callback#access_token=…`
# and `about:blank#access_token=…` are valid URI references that carry a fragment
# just the same, and both kept it in the output.
_URI_SCHEME_RE = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*:")


def _redact_pages(pages: Any, salt: str) -> list[dict[str, Any]]:
    """`log.pages` was copied through verbatim while every entry was redacted.

    Browsers set a page's `title` to the page URL, so a capture that includes an
    OAuth redirect carried the token in the fragment straight into an artifact
    this script describes as safe to commit. `redact_url` already strips
    userinfo and the fragment and redacts token-shaped query values.
    """
    out: list[dict[str, Any]] = []
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        copied = dict(page)
        title = copied.get("title")
        if isinstance(title, str) and _URI_SCHEME_RE.match(title):
            copied["title"] = redact_url(title, salt)
        out.append(copied)
    return out


def _redact_entry(entry: dict[str, Any], salt: str) -> dict[str, Any]:
    """Redact every bounded field of one entry, in place on a copy.

    Each value gets its OWN fingerprint under one per-run salt. Deriving the
    marker from the salt alone — `<redacted:{salt[:8]}>` — is the literal-marker
    bug wearing a fingerprint's clothes: every `Authorization` in the file
    compares equal, so `analyze_har.py --headers` on it reports every header
    constant. A file that looks analysable and is not.

    The salt is per RUN, so fingerprints are comparable **within one artifact**
    and never across two. That is the whole guarantee, and it is enough:
    `--headers` builds its own index of whatever file it is given, and
    `compare_har.py` keys on method, authority, path, query and body — never on
    a header value. Nothing here compares a fingerprint from one file with one
    from another, and nothing should start.
    """
    # Deep-copied through JSON rather than mutated: the caller's entry came from
    # the capture and is read again by later rows.
    out: dict[str, Any] = json.loads(json.dumps(entry))
    request = out.get("request") or {}
    response = out.get("response") or {}

    request["url"] = redact_url(str(request.get("url", "")), salt)
    for section in (request, response):
        for header in section.get("headers") or []:
            name = str(header.get("name", ""))
            if name.lower() in {"cookie", "set-cookie"}:
                header["value"] = redact_cookie_header(str(header.get("value", "")), salt)
            elif is_sensitive_header(name):
                header["value"] = fingerprint(str(header.get("value", "")), salt)
        for cookie in section.get("cookies") or []:
            cookie["value"] = fingerprint(str(cookie.get("value", "")), salt)
    for pairs in (request.get("queryString"), (request.get("postData") or {}).get("params")):
        for pair in pairs or []:
            if is_sensitive_param(str(pair.get("name", ""))):
                pair["value"] = fingerprint(str(pair.get("value", "")), salt)
    return out


def _drop_bodies(entry: dict[str, Any]) -> dict[str, Any]:
    """Remove request and response body text, keeping sizes and mime types.

    Bodies are dropped by DEFAULT because redaction covers named fields and a
    response body is unbounded text that may carry a credential anywhere in it.
    A derived HAR that kept them by default would hand back a file that looks
    sanitised and is not.
    """
    content = (entry.get("response") or {}).get("content")
    if isinstance(content, dict):
        content.pop("text", None)
        content.pop("encoding", None)
    post = (entry.get("request") or {}).get("postData")
    if isinstance(post, dict):
        post.pop("text", None)
        post.pop("params", None)
    for frame in entry.get("_webSocketMessages") or []:
        frame.pop("data", None)
    return entry


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="the .har file to derive from")
    parser.add_argument("--output", type=Path, required=True, metavar="PATH", help="destination")
    add_selection_args(parser)
    parser.add_argument(
        "--drop-types", metavar="A,B",
        nargs="?", const=",".join(DEFAULT_DROP_TYPES),
        help="drop these resource types; bare flag drops " + ", ".join(DEFAULT_DROP_TYPES),
    )
    parser.add_argument(
        "--keep-bodies", action="store_true",
        help="keep response and request bodies — the result is as sensitive as the capture",
    )
    parser.add_argument(
        "--secrets", action="store_true", help="do not redact (never for a file you will commit)"
    )
    parser.add_argument("--json", action="store_true", dest="as_json", help="machine-readable")
    args = parser.parse_args(argv)

    if not args.input.is_file():
        print(f"create_har: no such file: {args.input}", file=sys.stderr)
        return 2
    # Refused before anything is opened: a direct writer would truncate the
    # source while still reading it, and there is no recovering the capture.
    collision = output_collision(args, inputs=("input",))
    if collision:
        print(f"create_har: {collision}", file=sys.stderr)
        return 2

    try:
        selection = selection_from_args(args)
    except FilterError as exc:
        print(f"create_har: {exc}", file=sys.stderr)
        return 2

    dropped_types = {t.strip() for t in (args.drop_types or "").split(",") if t.strip()}

    try:
        header, rows = ensure_index(args.input)
        data = args.input.read_bytes()
        verify_for_seek(args.input, header, data)
        spans = scan_entries(data)
        source = json.loads(data)
    except (HarStructureError, OSError, ValueError) as exc:
        print(f"create_har: {exc}", file=sys.stderr)
        return 1

    salt = new_salt()
    kept: list[dict[str, Any]] = []
    for row in rows:
        if row.get("type") in dropped_types:
            continue
        # Both phases, spelled as `query_har.py` spells them. Evaluating only
        # the index phase here — which is what this loop used to do — accepted
        # `--body-match`, `--response-match` and `--has-header`, documented them
        # in `--help`, and ignored them: the "minimal" fixture came out as the
        # whole capture, every other host the page talked to included, and the
        # mistake announced itself as a large file rather than as an error.
        entry: dict[str, Any] | None = None
        hit = selection.matches_index(row)
        if hit and selection.needs_body():
            entry = read_entry(data, spans[row["i"]])
            hit = selection.matches_body(entry)
        if hit == selection.invert:
            continue
        if entry is None:
            entry = read_entry(data, spans[row["i"]])
        if not args.secrets:
            entry = _redact_entry(entry, salt)
        if not args.keep_bodies:
            entry = _drop_bodies(entry)
        kept.append(entry)

    log = source.get("log") or {}
    derived = {
        "log": {
            "version": log.get("version", "1.2"),
            "creator": {"name": "claude-arsenal har", "version": "1.0"},
            "browser": log.get("browser"),
            "pages": (
                log.get("pages") or [] if args.secrets else _redact_pages(log.get("pages"), salt)
            ),
            "entries": kept,
        }
    }
    derived["log"] = {k: v for k, v in derived["log"].items() if v is not None}

    # Same-directory temp plus atomic rename, as the index does: `rename` is
    # only atomic within a filesystem, and an interrupted run must leave either
    # the old file or the new one, never a half-written HAR.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp_name = tempfile.mkstemp(
        dir=str(args.output.parent), prefix=".har-derive-", suffix=".tmp"
    )
    tmp = Path(tmp_name)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as out:
            json.dump(derived, out, ensure_ascii=False)
            out.flush()
            os.fsync(out.fileno())
        tmp.replace(args.output)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise

    size = args.output.stat().st_size
    note = (
        "bodies KEPT — this file is as sensitive as the capture it came from"
        if args.keep_bodies
        else "bodies dropped"
    )
    if args.secrets:
        note += "; NOT redacted"
    if args.as_json:
        print(json.dumps({"output": str(args.output), "entries": len(kept), "bytes": size,
                          "bodies_kept": args.keep_bodies, "redacted": not args.secrets}))
    else:
        print(f"{args.output}: {len(kept)} entries, {size} bytes ({note})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
