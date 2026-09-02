#!/usr/bin/env python3
"""create_repro.py — one captured entry to a runnable request.

The handoff from "found the endpoint" to "have a scraper", and the point where
a HAR stops being a diagnostic artifact.

    create_repro.py --input capture.har --id 4 --format curl
    create_repro.py --input capture.har --id 4 --format python --secrets

**Every emitted value is escaped for its destination.** A HAR is an untrusted
document — its URLs, header values and bodies came off the network — and this
command's whole purpose is to produce something an operator pastes into a
shell. Shell output quotes every argument through `shlex.quote`, never
interpolating raw text; Python output uses `repr()` rather than concatenation;
bodies go through `--data-raw`, so a body beginning with `@` stays inline data
instead of becoming a local-file read. A generated command that executes
something the capture did not contain is the worst bug this toolkit could have,
so this is a correctness requirement rather than a hardening note.

Exit: 0 on success, 1 when the entry cannot be read, 2 on a usage error.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _harlib import (
    HarStructureError,
    decode_body,
    fingerprint,
    is_sensitive_header,
    new_salt,
    output_collision,
    read_entry,
    redact_cookie_header,
    redact_url,
    scan_entries,
)
from analyze_har import ensure_index, verify_for_seek

# Headers a client sets for itself. Emitting them makes a reproduction that
# lies about what it is doing — `Content-Length` in particular goes stale the
# moment the body is edited, which is the first thing anyone does with one.
SKIP_HEADERS = frozenset({"content-length", "host", "connection", "transfer-encoding"})


def sh(value: str) -> str:
    """Single-quote for the shell, ALWAYS — even where `shlex.quote` would not.

    `shlex.quote` leaves a string bare when it happens to contain no
    metacharacters, which is safe as emitted and fragile as edited: a bare
    `@/etc/passwd` looks like an argument and becomes a local-file read the
    moment someone changes `--data-raw` to `--data`. Uniform quoting removes
    the class rather than the instance, and makes the output readable as data
    at a glance.
    """
    return "'" + value.replace("'", "'\"'\"'") + "'"


def _headers(entry: dict[str, Any], salt: str, secrets: bool) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for header in (entry.get("request") or {}).get("headers") or []:
        name = str(header.get("name", ""))
        value = str(header.get("value", ""))
        if name.lower() in SKIP_HEADERS or name.startswith(":"):
            continue
        if not secrets:
            if name.lower() == "cookie":
                value = redact_cookie_header(value, salt)
            elif is_sensitive_header(name):
                # Per value, not per run: a reproduction shows one entry, but a
                # marker derived from the salt alone would make two different
                # credentials on it look like the same one.
                value = fingerprint(value, salt)
        out.append((name, value))
    return out


def _body(entry: dict[str, Any]) -> str | None:
    post = (entry.get("request") or {}).get("postData") or {}
    if not post.get("text"):
        return None
    decoded = decode_body(post)
    return decoded.text if decoded.ok else post.get("text")


def as_curl(entry: dict[str, Any], salt: str, secrets: bool) -> list[str]:
    """A curl command whose every argument is quoted for the shell."""
    request = entry.get("request") or {}
    url = str(request.get("url", ""))
    if not secrets:
        url = redact_url(url, salt)
    method = str(request.get("method", "GET")).upper()

    parts = ["curl"]
    if method != "GET":
        parts += ["-X", sh(method)]
    parts.append(sh(url))
    lines = [" ".join(parts)]
    for name, value in _headers(entry, salt, secrets):
        lines.append(f"  -H {sh(f'{name}: {value}')}")
    body = _body(entry)
    if body is not None:
        # --data-raw, never --data: `--data @file` reads a local file, so a
        # captured body that starts with `@` would make the reproduction send
        # the operator's own file instead of the payload.
        lines.append(f"  --data-raw {sh(body)}")
    return [" \\\n".join(lines)]


def as_python(entry: dict[str, Any], salt: str, secrets: bool) -> list[str]:
    """A `requests` snippet built with repr(), never string concatenation."""
    request = entry.get("request") or {}
    url = str(request.get("url", ""))
    if not secrets:
        url = redact_url(url, salt)
    method = str(request.get("method", "GET")).lower()
    headers = dict(_headers(entry, salt, secrets))
    body = _body(entry)

    lines = ["import requests", "", f"url = {url!r}", "headers = {"]
    lines += [f"    {name!r}: {value!r}," for name, value in headers.items()]
    lines.append("}")
    if body is not None:
        lines.append(f"data = {body!r}")
        lines.append(f"response = requests.{method}(url, headers=headers, data=data)")
    else:
        lines.append(f"response = requests.{method}(url, headers=headers)")
    lines += ["response.raise_for_status()", "print(response.status_code, len(response.content))"]
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="the .har file")
    parser.add_argument("--id", type=int, required=True, metavar="IDX", help="entry index")
    parser.add_argument(
        "--format", choices=("curl", "python"), default="curl", help="output language"
    )
    parser.add_argument(
        "--secrets", action="store_true",
        help="emit real credentials, userinfo and fragment — a working reproduction needs them",
    )
    parser.add_argument("--output", type=Path, metavar="PATH", help="write to a file")
    parser.add_argument("--json", action="store_true", dest="as_json", help="machine-readable")
    args = parser.parse_args(argv)

    if not args.input.is_file():
        print(f"create_repro: no such file: {args.input}", file=sys.stderr)
        return 2
    collision = output_collision(args, inputs=("input",))
    if collision:
        print(f"create_repro: {collision}", file=sys.stderr)
        return 2

    try:
        header, _rows = ensure_index(args.input)
        data = args.input.read_bytes()
        verify_for_seek(args.input, header, data)
        spans = scan_entries(data)
        if not 0 <= args.id < len(spans):
            print(
                f"create_repro: no entry {args.id}; the capture has {len(spans)}",
                file=sys.stderr,
            )
            return 2
        entry = read_entry(data, spans[args.id])
    except (HarStructureError, OSError, ValueError) as exc:
        print(f"create_repro: {exc}", file=sys.stderr)
        return 1

    salt = new_salt()
    lines = (as_curl if args.format == "curl" else as_python)(entry, salt, args.secrets)
    text = "\n".join(lines)

    if not args.secrets:
        lines.append("")
        lines.append(
            "# credentials redacted — re-run with --secrets for a request that authenticates"
            if args.format == "python"
            else "# credentials redacted; re-run with --secrets for a request that authenticates"
        )
        text = "\n".join(lines)

    if args.as_json:
        import json

        print(json.dumps({"id": args.id, "format": args.format, "text": text}))
        return 0
    if args.output:
        args.output.write_text(text + "\n", encoding="utf-8")
        print(f"wrote {args.output}", file=sys.stderr)
        return 0
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
