#!/usr/bin/env python3
"""validate_har.py — is this capture usable, and what did its exporter leave out?

Run when something surprising happens. It separates a bad capture from a bad
query, which is the distinction that otherwise costs an hour: Chrome, Firefox,
mitmproxy and Playwright each omit different optional fields, and a query that
finds nothing because the exporter never saved response bodies looks exactly
like a query that finds nothing because the endpoint is elsewhere.

    validate_har.py --input capture.har
    validate_har.py --input capture.har --json

Exit: 0 when the file is a usable HAR (warnings do not fail it), 1 when it is
not, 2 on a usage error.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _harlib import (
    HarStructureError,
    apply_budget,
    decode_body,
    is_textual,
    scan_entries,
)

REQUIRED_ENTRY = ("request", "response")
REQUIRED_REQUEST = ("method", "url")
REQUIRED_RESPONSE = ("status",)


def _capabilities(entries: list[dict[str, Any]]) -> dict[str, Any]:
    """What this exporter actually recorded — the half of the answer that is not pass/fail."""
    bodies = base64_bodies = undecodable = binary = 0
    resource_types: Counter[str] = Counter()
    cache = Counter({"true": 0, "false": 0, "unknown": 0})
    websockets = post_bodies = 0
    for entry in entries:
        # `get(key, {})` supplies the default only when the key is *absent*, so
        # a capture carrying `"response": null` — what a proxy writes for a
        # request whose response never arrived — returned None and raised on the
        # chained `get`. This is the script whose whole job is to be pointed at
        # a HAR of unknown provenance, and "the exporter wrote a null response"
        # is a finding, not a traceback.
        if not isinstance(entry, dict):
            continue
        response = entry.get("response")
        content = (response.get("content") if isinstance(response, dict) else None) or {}
        # Without the header, _decompress can only sniff magic bytes: gzip and
        # zlib are guessable, brotli is not. A base64 brotli body then counted
        # as undecodable here while `query_har.py --show` decoded it fine,
        # because that path supplies the header.
        encoding = next(
            (
                h.get("value")
                for h in (response.get("headers") if isinstance(response, dict) else None) or []
                if isinstance(h, dict) and str(h.get("name", "")).lower() == "content-encoding"
            ),
            None,
        )
        decoded = decode_body(content, content_encoding=encoding)
        if decoded.present:
            bodies += 1
            if (content.get("encoding") or "").lower() == "base64":
                base64_bodies += 1
            if not decoded.ok:
                if is_textual(content.get("mimeType")):
                    undecodable += 1
                else:
                    binary += 1
        rtype = entry.get("_resourceType")
        resource_types[rtype if isinstance(rtype, str) else "<absent>"] += 1
        if "_fromCache" not in entry:
            cache["unknown"] += 1
        else:
            cache["true" if entry["_fromCache"] else "false"] += 1
        if entry.get("_webSocketMessages"):
            websockets += 1
        if (entry.get("request") or {}).get("postData"):
            post_bodies += 1
    return {
        "entries": len(entries),
        "response_bodies": bodies,
        "base64_bodies": base64_bodies,
        "undecodable_bodies": undecodable,
        "binary_bodies": binary,
        "request_bodies": post_bodies,
        "resource_type_declared": len(entries) - resource_types["<absent>"],
        "resource_types": dict(resource_types),
        "from_cache": dict(cache),
        "websocket_entries": websockets,
    }


def validate(path: Path) -> tuple[list[str], list[str], dict[str, Any]]:
    """Return (errors, warnings, report). Errors mean the file cannot be used."""
    errors: list[str] = []
    warnings: list[str] = []
    data = path.read_bytes()
    try:
        doc = json.loads(data)
    except ValueError as exc:
        return [f"not valid JSON: {exc}"], [], {}
    if not isinstance(doc, dict) or not isinstance(doc.get("log"), dict):
        return ["no top-level `log` object — this is not a HAR"], [], {}

    log = doc["log"]
    version = str(log.get("version", ""))
    if version != "1.2":
        warnings.append(f"log.version is {version or 'absent'!r}, not '1.2' — read as 1.2 anyway")
    entries = log.get("entries")
    if not isinstance(entries, list):
        return ["log.entries is missing or not an array"], warnings, {}

    for i, entry in enumerate(entries):
        if not isinstance(entry, dict):
            errors.append(f"entry {i} is not an object")
            continue
        for field in REQUIRED_ENTRY:
            if not isinstance(entry.get(field), dict):
                errors.append(f"entry {i}: no `{field}` object")
        for field in REQUIRED_REQUEST:
            if field not in (entry.get("request") or {}):
                errors.append(f"entry {i}: request has no `{field}`")
        for field in REQUIRED_RESPONSE:
            if field not in (entry.get("response") or {}):
                errors.append(f"entry {i}: response has no `{field}`")

    # The offsets are what every body-touching command depends on, so a file
    # that parses but cannot be spanned is reported here rather than at the
    # first `--show` three commands later.
    try:
        spans = scan_entries(data)
    except HarStructureError as exc:
        errors.append(f"entry offsets cannot be located: {exc}")
        spans = []
    if spans and len(spans) != len(entries):
        errors.append(
            f"offset scan found {len(spans)} entries but the parser found {len(entries)} — "
            "do not trust byte-offset reads on this file"
        )

    report = _capabilities([e for e in entries if isinstance(e, dict)])
    report["creator"] = (log.get("creator") or {}).get("name", "<absent>")
    report["pages"] = len(log.get("pages") or [])
    report["offsets_located"] = len(spans)

    if report["entries"] and report["response_bodies"] == 0:
        warnings.append(
            "no response bodies captured — content search will find nothing here. "
            "Re-export with 'Save all as HAR (with content)'"
        )
    if report["resource_type_declared"] == 0 and report["entries"]:
        warnings.append(
            "no `_resourceType` on any entry — `--type` filters fall back to inference"
        )
    if report["undecodable_bodies"]:
        warnings.append(
            f"{report['undecodable_bodies']} body(ies) could not be decoded; "
            "`query_har.py --show` reports the reason per entry"
        )
    return errors, warnings, report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="the .har file to check")
    parser.add_argument("--json", action="store_true", dest="as_json", help="machine-readable")
    parser.add_argument(
        "--limit", type=int, default=20, help="max problems to print (0 = all). Default 20"
    )
    args = parser.parse_args(argv)

    if not args.input.is_file():
        print(f"validate_har: no such file: {args.input}", file=sys.stderr)
        return 2

    errors, warnings, report = validate(args.input)

    if args.as_json:
        print(json.dumps({"ok": not errors, "errors": errors, "warnings": warnings, **report}))
        return 1 if errors else 0

    lines: list[str] = []
    if errors:
        shown = errors if args.limit == 0 else errors[: args.limit]
        lines.append(f"NOT USABLE — {len(errors)} error(s):")
        lines += [f"  ✗ {e}" for e in shown]
        if len(errors) > len(shown):
            lines.append(f"  … {len(errors) - len(shown)} more (raise --limit)")
    else:
        lines.append(
            f"usable HAR — {report['entries']} entries, {report['pages']} page(s), "
            f"exporter {report['creator']}"
        )
        lines.append(
            f"  bodies: {report['response_bodies']} response "
            f"({report['base64_bodies']} base64, {report['binary_bodies']} binary, "
            f"{report['undecodable_bodies']} undecodable), "
            f"{report['request_bodies']} request"
        )
        cache = report["from_cache"]
        lines.append(
            f"  _resourceType on {report['resource_type_declared']}/{report['entries']}; "
            f"_fromCache true {cache['true']} / false {cache['false']} / unknown {cache['unknown']}"
        )
        if report["websocket_entries"]:
            lines.append(f"  websockets: {report['websocket_entries']} entry(ies) with frames")
    for warning in warnings:
        lines.append(f"  ! {warning}")

    kept, note = apply_budget(lines, 0 if args.limit == 0 else 4096)
    print("\n".join(kept))
    if note:
        print(note)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
