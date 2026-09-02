#!/usr/bin/env python3
"""Shared HAR primitives: entry spans, body decoding, redaction, output budget.

Everything that touches the capture file itself lives here, so the six commands
above it cannot disagree about what an entry is, what a body says, or what
counts as a secret.

Four things in this module are load-bearing, and each exists because the obvious
implementation is silently wrong:

* **The scanner works in bytes, never characters.** A character offset and a
  byte offset diverge at the first non-ASCII character, and captures of real
  sites are full of them. An index built on ``str`` positions passes every
  ASCII fixture and returns the wrong entry on the first accented job title.
* **Decoding never returns a mangled string.** ``Decoded.ok`` is False with a
  reason instead. A body that silently became mojibake is a wrong answer that
  looks like a right one, which is worse than no answer.
* **"No body was captured" is not "no match".** They are different states and
  the caller reports them differently, because conflating them sends a session
  hunting for an endpoint it already found.
* **Redacted values keep a fingerprint.** ``<redacted:ab12cd34>`` under a
  per-run salt that is never stored: equal values stay equal, different values
  stay different, and nothing about the original is recoverable. A bare marker
  would make every ``Authorization`` compare equal and destroy the
  constant-versus-varying split that finds the auth header.

Stdlib only, so the skill runs in a vendored consumer repo with no dependency
step. ``brotli`` is used when present and reported as unavailable when not.
"""

from __future__ import annotations

import base64
import binascii
import gzip
import hashlib
import re
import secrets
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit, urlunsplit

try:  # pragma: no cover - presence depends on the interpreter, not on us
    import brotli  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover
    brotli = None

# --------------------------------------------------------------------------
# Redaction policy
# --------------------------------------------------------------------------

# Header names whose value is a credential. Matched case-insensitively: HTTP
# header names are case-insensitive by definition, so a literal match would let
# `AUTHORIZATION` through while catching `Authorization` — a redaction bypass
# that depends on nothing but an exporter's capitalisation.
SENSITIVE_HEADERS = frozenset(
    {
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        "x-auth-token",
        "x-csrf-token",
        "x-xsrf-token",
        "x-session-token",
        "api-key",
        "authentication",
    }
)

# Parameter names that carry credentials, matched as substrings of the name so
# `access_token`, `apiKey` and `X-Sig` are all caught.
SENSITIVE_PARAM = re.compile(
    r"(token|key|secret|session|auth|password|passwd|pwd|signature|sig|credential|bearer)",
    re.IGNORECASE,
)

REDACTED = "<redacted>"


def new_salt() -> str:
    """A per-run salt for redaction fingerprints. Generated, used, never stored."""
    return secrets.token_hex(16)


def fingerprint(value: str, salt: str) -> str:
    """`<redacted:ab12cd34>` — stable under one salt, meaningless outside it."""
    digest = hashlib.sha256((salt + value).encode("utf-8")).hexdigest()[:8]
    return f"<redacted:{digest}>"


def is_sensitive_header(name: str) -> bool:
    return name.strip().lower() in SENSITIVE_HEADERS


def is_sensitive_param(name: str) -> bool:
    return bool(SENSITIVE_PARAM.search(name))


def redact_cookie_header(value: str, salt: str) -> str:
    """Redact cookie VALUES, keeping names and attributes.

    `Set-Cookie: sid=abc; HttpOnly; Secure` becomes
    `sid=<redacted:ab12cd34>; HttpOnly; Secure`. Replacing the whole header
    would be safe and useless: cookie names and flags are how a session
    identifies which cookie authenticates and whether it is `HttpOnly`, and
    losing them turns cookie analysis into a count of anonymous strings.
    """
    parts = [chunk.strip() for chunk in value.split(";")]
    out: list[str] = []
    for i, chunk in enumerate(parts):
        name, sep, raw = chunk.partition("=")
        # In a Set-Cookie only the FIRST pair is the cookie; the rest are
        # attributes (Path, Domain, Expires, Max-Age) and carry no secret.
        if sep and (i == 0 or not _COOKIE_ATTRIBUTE.fullmatch(name.strip())):
            out.append(f"{name}={fingerprint(raw, salt)}")
        else:
            out.append(chunk)
    return "; ".join(out)


# Set-Cookie attribute names, which are not cookies and hold nothing secret.
_COOKIE_ATTRIBUTE = re.compile(
    r"(?i)^(path|domain|expires|max-age|samesite|priority|partitioned)$"
)

_COOKIE_HEADERS = frozenset({"cookie", "set-cookie"})


def redact_pairs(
    pairs: list[tuple[str, str]], salt: str, *, headers: bool
) -> list[list[str]]:
    """Redact a list of name/value pairs, keeping order and repeats.

    Pairs, not a dict: `?tag=a&tag=b` is two values for one name and `Set-Cookie`
    appears once per cookie. Collapsing them into an object keeps the last one
    silently, which would make a filter miss a request that plainly contains the
    value it asked for — and only on the sites that use repetition, the worst
    possible distribution for a bug.
    """
    sensitive = is_sensitive_header if headers else is_sensitive_param
    out: list[list[str]] = []
    for name, value in pairs:
        key = name.lower() if headers else name
        if headers and key in _COOKIE_HEADERS:
            out.append([key, redact_cookie_header(value, salt)])
        elif sensitive(name):
            out.append([key, fingerprint(value, salt)])
        else:
            out.append([key, value])
    return out


def _redact_query_string(query: str, salt: str) -> str:
    """Redact token-shaped pairs inside a raw query string, byte-for-byte otherwise.

    Order, repeated names and each value's percent-encoding are preserved: a
    redaction pass that normalises the query silently changes the request it
    claims to describe.
    """
    if not query:
        return query
    parts = []
    for chunk in query.split("&"):
        if "=" not in chunk:
            parts.append(chunk)
            continue
        raw_name, raw_value = chunk.split("=", 1)
        name = parse_qsl(f"{raw_name}=", keep_blank_values=True)
        decoded_name = name[0][0] if name else raw_name
        if is_sensitive_param(decoded_name):
            parts.append(f"{raw_name}={fingerprint(raw_value, salt)}")
        else:
            parts.append(chunk)
    return "&".join(parts)


def redact_url(url: str, salt: str, *, keep_secrets: bool = False) -> str:
    """Strip userinfo and fragment, and redact token-shaped query values.

    Userinfo (`https://user:pass@host/`) and the fragment (`#access_token=…`,
    where OAuth implicit flows put live tokens) carry credentials that no
    name-matching rule would look for, so both are removed by default from
    every artifact. `keep_secrets` restores them, and only `create_repro.py`
    ever passes it — never a sidecar, a listing or a derived HAR, because those
    are files that get committed.
    """
    if keep_secrets:
        return url
    try:
        parts = urlsplit(url)
    except ValueError:
        return url
    netloc = parts.netloc.rsplit("@", 1)[-1] if "@" in parts.netloc else parts.netloc
    return urlunsplit(
        (parts.scheme, netloc, parts.path, _redact_query_string(parts.query, salt), "")
    )


# --------------------------------------------------------------------------
# The byte-offset scanner
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class EntrySpan:
    """Byte offset and length of one `log.entries[i]` object in the file."""

    index: int
    offset: int
    length: int

    @property
    def end(self) -> int:
        return self.offset + self.length


# Only structural bytes matter, so the scan jumps between them with a compiled
# regex rather than walking 200 MB one byte at a time in Python. Per-byte
# iteration is correct and roughly two orders of magnitude too slow for SC2.
_STRUCTURAL = re.compile(rb'["\\{}\[\]]')
_KEY_TAIL = re.compile(rb"\s*:")


class HarStructureError(ValueError):
    """The file is not a HAR whose entries can be located by offset."""


def scan_entries(data: bytes) -> list[EntrySpan]:
    """Byte spans of every `log.entries[i]` object, in capture order.

    Depth is tracked with string and escape awareness, which is the whole
    difficulty: a brace inside a response body is not a structural brace, and an
    escaped quote does not end a string. `data` is bytes throughout — see the
    module docstring for why that is not an implementation detail.
    """
    spans: list[EntrySpan] = []
    depth = 0
    in_string = False
    string_start = -1
    escaped_at = -1
    # Where we are relative to the one array we care about.
    log_key_depth = -1  # depth at which "log" was seen as a key
    entries_key_depth = -1
    in_entries = False
    entry_start = -1
    entry_depth = -1
    pending_key: bytes | None = None

    for match in _STRUCTURAL.finditer(data):
        pos = match.start()
        char = data[pos : pos + 1]

        if pos == escaped_at:
            continue  # this byte is the target of a backslash; not structural

        if in_string:
            if char == b"\\":
                escaped_at = pos + 1
            elif char == b'"':
                in_string = False
                content = data[string_start + 1 : pos]
                tail = _KEY_TAIL.match(data, pos + 1)
                pending_key = content if tail else None
            continue

        if char == b'"':
            in_string = True
            string_start = pos
            continue

        if char in (b"{", b"["):
            if in_entries and depth == entries_key_depth + 1 and char == b"{":
                entry_start = pos
                entry_depth = depth
            depth += 1
            if pending_key == b"log" and log_key_depth == -1:
                log_key_depth = depth
            elif pending_key == b"entries" and depth == log_key_depth + 1:
                entries_key_depth = depth - 1
                in_entries = True
            pending_key = None
            continue

        # `}` or `]`
        depth -= 1
        pending_key = None
        if in_entries and entry_start != -1 and depth == entry_depth and char == b"}":
            spans.append(EntrySpan(len(spans), entry_start, pos + 1 - entry_start))
            entry_start = -1
        elif in_entries and char == b"]" and depth == entries_key_depth:
            in_entries = False

    if in_string or depth != 0:
        raise HarStructureError("unbalanced JSON — the capture is truncated or not a HAR")
    return spans


def read_bytes(path: Path) -> bytes:
    return Path(path).read_bytes()


def read_entry(data: bytes, span: EntrySpan) -> dict[str, Any]:
    """Parse exactly one entry from its span.

    The caller verifies the content digest once per run before the first call:
    an offset is only ever as good as the file it was measured against.
    """
    import json

    parsed = json.loads(data[span.offset : span.end])
    if not isinstance(parsed, dict):
        raise HarStructureError(f"entry {span.index} is not an object")
    return parsed


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# --------------------------------------------------------------------------
# Body decoding
# --------------------------------------------------------------------------


@dataclass
class Decoded:
    """The result of trying to read one body. Never a mangled string."""

    ok: bool
    present: bool
    text: str | None = None
    raw: bytes | None = None
    charset: str | None = None
    charset_source: str = "none"  # bom | declared | utf-8 | none
    content_encoding: str | None = None
    reason: str | None = None

    def __bool__(self) -> bool:  # pragma: no cover - convenience only
        return self.ok


_CHARSET_IN_MIME = re.compile(r"charset\s*=\s*\"?([\w.:+-]+)", re.IGNORECASE)

_BOMS: tuple[tuple[bytes, str], ...] = (
    (b"\xef\xbb\xbf", "utf-8-sig"),
    (b"\xff\xfe\x00\x00", "utf-32-le"),
    (b"\x00\x00\xfe\xff", "utf-32-be"),
    (b"\xff\xfe", "utf-16-le"),
    (b"\xfe\xff", "utf-16-be"),
)


# Every exception a codec in `_decompress` can raise. `gzip.BadGzipFile` is an
# `OSError` and `zlib.error` is named, but `brotli.error` subclasses `Exception`
# directly — outside a tuple of the other three it escapes the handler, out of
# `matches_body`, and out of a loop over every entry, so one mislabelled body
# ends the whole query with a traceback. Built at import time because `brotli`
# is optional and `except ()` is not valid.
_CODEC_ERRORS: tuple[type[BaseException], ...] = (OSError, zlib.error, ValueError) + (
    (brotli.error,) if brotli is not None else ()
)

# Control characters that no textual body contains outside of whitespace. Enough
# on its own: compressed bytes essentially never decode as valid UTF-8, so this
# only has to reject the ones that do by accident.
_CONTROL_CHARS = frozenset(chr(c) for c in range(0x20) if chr(c) not in "\t\n\r\f\v") | {"\x7f"}


def _already_decoded(raw: bytes) -> bool:
    """Whether bytes that failed their declared codec are simply not compressed."""
    if not raw:
        return False
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return not any(ch in _CONTROL_CHARS for ch in text)


def _decompress(raw: bytes, encoding: str | None) -> tuple[bytes, str | None, str | None]:
    """Apply a content-encoding when one is declared or its magic bytes are present."""
    name = (encoding or "").strip().lower()
    if not name:
        # Sniffed only where the magic bytes are unambiguous. An exporter that
        # stored compressed bytes without recording the content-encoding is
        # common enough that refusing to guess would lose real bodies.
        if raw[:2] == b"\x1f\x8b":
            name = "gzip"
        elif raw[:1] == b"\x78" and len(raw) > 2 and (raw[0] * 256 + raw[1]) % 31 == 0:
            name = "zlib"
        else:
            return raw, None, None
    try:
        if name == "gzip":
            return gzip.decompress(raw), "gzip", None
        if name in {"deflate", "zlib"}:
            try:
                return zlib.decompress(raw), name, None
            except zlib.error:
                return zlib.decompress(raw, -zlib.MAX_WBITS), name, None
        if name == "br":
            if brotli is None:
                # Checked before reporting the dependency: these scripts are
                # stdlib-only on purpose, so "no brotli" is the *normal* state
                # in a vendored consumer repo — and a body an exporter stored
                # already decoded needs no brotli at all. Asking for an install
                # that would not change the answer is the wrong instruction.
                if _already_decoded(raw):
                    return raw, None, None
                return raw, "br", "brotli unavailable — install brotli to read this body"
            return brotli.decompress(raw), "br", None
    except _CODEC_ERRORS as exc:
        # An exporter that stored the body already decoded while keeping the
        # original `content-encoding` header is the common case, not the
        # corrupt one: playwright's `record_har_content="embed"` does exactly
        # that, so every brotli-served response in such a capture arrives here
        # with readable bytes. Reporting those as a decode failure loses a body
        # that is sitting right there. No encoding was applied, so `None` is the
        # honest answer for which one was.
        if _already_decoded(raw):
            return raw, None, None
        return raw, name, f"{name} decompression failed: {exc}"
    return raw, name or None, None


def _decode_text(raw: bytes, declared: str | None) -> Decoded:
    """Bytes to text, saying which rule produced the answer — or that none did."""
    for bom, codec in _BOMS:
        if raw.startswith(bom):
            try:
                return Decoded(
                    ok=True,
                    present=True,
                    text=raw.decode(codec),
                    raw=raw,
                    charset=codec,
                    charset_source="bom",
                )
            except (UnicodeDecodeError, LookupError):
                break
    # UTF-8 wins over a declared charset when the bytes are valid UTF-8 *and*
    # carry a multi-byte sequence. Bytes that decode as multi-byte UTF-8 by
    # accident are vanishingly rare; a body mislabelled `shift_jis` that is
    # really UTF-8 is common. Taking the declaration on faith there produces
    # "Dﾃｩveloppeur" — a silently mangled string, which is the one outcome this
    # function exists to prevent. The override is reported, never silent.
    utf8_text: str | None = None
    try:
        utf8_text = raw.decode("utf-8")
    except UnicodeDecodeError:
        utf8_text = None
    if utf8_text is not None and not raw.isascii():
        source = "utf-8"
        reason = None
        if declared and declared.replace("_", "-") not in {"utf-8", "utf8"}:
            source = "utf-8-over-declared"
            reason = f"declared charset {declared!r} rejected: the bytes are valid multi-byte UTF-8"
        return Decoded(
            ok=True,
            present=True,
            text=utf8_text,
            raw=raw,
            charset="utf-8",
            charset_source=source,
            reason=reason,
        )
    if declared:
        try:
            return Decoded(
                ok=True,
                present=True,
                text=raw.decode(declared),
                raw=raw,
                charset=declared,
                charset_source="declared",
            )
        except (UnicodeDecodeError, LookupError):
            pass
    try:
        return Decoded(
            ok=True,
            present=True,
            text=raw.decode("utf-8") if utf8_text is None else utf8_text,
            raw=raw,
            charset="utf-8",
            charset_source="utf-8",
        )
    except UnicodeDecodeError as exc:
        return Decoded(
            ok=False,
            present=True,
            raw=raw,
            charset=declared,
            charset_source="none",
            reason=(
                f"undecodable bytes: {exc.reason} at byte {exc.start}"
                + (f"; declared charset {declared!r} did not apply" if declared else "")
            ),
        )


def decode_body(content: dict[str, Any] | None, *, content_encoding: str | None = None) -> Decoded:
    """Decode one `response.content` (or `request.postData`) into text.

    The whole chain in one place: base64 → content-encoding → charset. Absence
    is reported as absence — `present=False` — because "no body was captured"
    and "no match" are different answers and a session told the wrong one goes
    hunting for an endpoint it already found.
    """
    if not content:
        return Decoded(ok=False, present=False, reason="no body captured")
    text = content.get("text")
    if text is None:
        return Decoded(ok=False, present=False, reason="no body captured")
    if not isinstance(text, str):
        return Decoded(ok=False, present=False, reason="body is not a string")

    declared = None
    mime = content.get("mimeType") or ""
    found = _CHARSET_IN_MIME.search(mime)
    if found:
        declared = found.group(1).lower()

    if (content.get("encoding") or "").lower() == "base64":
        try:
            raw = base64.b64decode(text, validate=True)
        except (binascii.Error, ValueError) as exc:
            return Decoded(ok=False, present=True, reason=f"invalid base64 body: {exc}")
        raw, applied, problem = _decompress(raw, content_encoding)
        if problem:
            return Decoded(
                ok=False, present=True, raw=raw, content_encoding=applied, reason=problem
            )
        result = _decode_text(raw, declared)
        result.content_encoding = applied
        return result

    # Not base64: the exporter already stored text, so the JSON parser has
    # decoded it. Re-encoding it to "decode" it again would only invent
    # failures — the only thing left to check is that it can be written out.
    # A JSON `\udNNN` escape without its pair survives json.loads and then
    # raises on every encode downstream, so it is caught here where the reason
    # can still be reported instead of at the point of writing a file.
    try:
        raw = text.encode("utf-8")
    except UnicodeEncodeError as exc:
        return Decoded(
            ok=False,
            present=True,
            text=None,
            raw=text.encode("utf-8", "surrogatepass"),
            charset=declared or "utf-8",
            charset_source="none",
            reason=f"body contains unpaired surrogates and cannot be encoded: {exc.reason}",
        )
    return Decoded(
        ok=True,
        present=True,
        text=text,
        raw=raw,
        charset=declared or "utf-8",
        charset_source="declared" if declared else "none",
    )


# --------------------------------------------------------------------------
# Output budget
# --------------------------------------------------------------------------

# Mime types whose bodies are meant to be read as text. Anything else that
# fails to decode is binary, not broken — reporting a PNG as an undecodable
# body would train a reader to ignore the count that matters.
_TEXTUAL_MIME = re.compile(
    r"^(text/|application/(json|xml|javascript|x-www-form-urlencoded|graphql|ld\+json"
    r"|[\w.+-]*\+json|[\w.+-]*\+xml))",
    re.IGNORECASE,
)


def is_textual(mime: str | None) -> bool:
    """Whether a body of this mime type is expected to decode to text."""
    return bool(_TEXTUAL_MIME.match((mime or "").split(";")[0].strip()))


OUTPUT_BUDGET = 4096


def apply_budget(lines: list[str], cap: int = OUTPUT_BUDGET) -> tuple[list[str], str | None]:
    """Trim rendered lines to a byte budget, saying what the budget dropped.

    A row cap alone does not bound output — twenty entries with 300-character
    tracking URLs blow the budget on their own — so the byte budget is the
    backstop, and the caller reports which of the two did the dropping.
    """
    if cap <= 0:
        return lines, None
    kept: list[str] = []
    used = 0
    for line in lines:
        size = len(line.encode("utf-8")) + 1
        if used + size > cap:
            dropped = len(lines) - len(kept)
            return kept, f"… {dropped} more line(s) dropped by the {cap}-byte output budget"
        kept.append(line)
        used += size
    return kept, None


def elide(text: str, width: int) -> str:
    """Shorten a long field keeping both ends — the tail always survives.

    A truncated URL that loses its query string loses the part a scraping
    session is reading it for.
    """
    if width <= 3 or len(text) <= width:
        return text
    head = (width - 1) // 2
    tail = width - 1 - head
    return text[:head] + "…" + text[len(text) - tail :]


# --------------------------------------------------------------------------
# Destination safety
# --------------------------------------------------------------------------


def output_collision(args: Any, *, inputs: tuple[str, ...] = ("input",)) -> str | None:
    """The reason `--output` must be refused, or None when the destination is safe.

    A HAR is not a regenerable build artifact. It is a recording of one moment
    on a live site — the board has rotated its adverts, the build id in the
    asset URLs has moved, the session is gone — so re-recording gets you *a*
    capture, never *that* one. And the slip is an easy one to make, because the
    natural loop is to up-arrow the last command and edit the tail of the line:
    `--output tmp/site.har` is one mistyped word from `--output tmp/site.txt`.

    Lives here, taking the attribute names, rather than in the five commands
    that have an `--output`: the sixth one to grow one inherits the guard
    instead of re-deriving it.
    """
    destination = getattr(args, "output", None)
    if destination is None:
        return None
    try:
        target = Path(destination).resolve()
    except OSError:  # pragma: no cover - resolve() is strict=False, so rare
        return None
    for name in inputs:
        source = getattr(args, name, None)
        if source is None:
            continue
        try:
            if Path(source).resolve() == target:
                return (
                    f"--output is the capture named by --{name.replace('_', '-')}. "
                    "Refusing: a capture records one moment on a live site and "
                    "re-recording will not reproduce it. Choose another destination."
                )
        except OSError:  # pragma: no cover
            continue
    return None
