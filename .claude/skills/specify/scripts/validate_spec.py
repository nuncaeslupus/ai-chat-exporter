#!/usr/bin/env python3
"""validate_spec.py — structural lint for a status/specification.md document.

Checks that a produced specification has the sections the `specify` / `design`
workflow requires — it verifies shape, not content quality. Sections 1-4 are
owned by `specify` and required; 5-6 are appended by `design` and reported as
pending when absent. The measurable Success criteria block is required.

This is a shallow check: it confirms required `## ` sections exist, are not
empty or placeholder-only, and that the Success criteria block is present. It
cannot judge whether the prose is any good.

Human-readable on stdout; problems on stderr. Exit 0 = well-formed, 1 = missing
or unfilled required sections, 2 = usage error (file missing).
"""

import argparse
import re
import sys
from pathlib import Path

SECTION_RE = re.compile(r"^##\s+(\d+)\.\s+(.*\S)\s*$")
# A placeholder line, allowing a leading list/blockquote/ordinal marker: `- <x>`, `> <x>`, `1. <x>`.
PLACEHOLDER_RE = re.compile(r"^(?:[-*+>]|\d+\.)?\s*<.*>$")
# Inline template placeholder — an angle-bracket token that looks like a fill-in field, not an
# HTML/Markdown tag.  HTML tags start with a letter only; we exclude known HTML/Markdown constructs
# (tags that start with `/`, `!`, or are single-word HTML tag names) and match only tokens that
# contain at least one space or hyphen (e.g. `<your name here>`, `<project-name>`) or are
# multi-word identifiers that look like template slots.
_HTML_TAGS = (
    r"br|hr|p|a|ul|ol|li|em|strong|code|pre|h\d|div|span|img|table|tr|td|th"
    r"|details|summary|kbd|iframe|script|style|svg|path|g|meta|link"
)
INLINE_PLACEHOLDER_RE = re.compile(
    r"<(?![!?])(?!/?(?:" + _HTML_TAGS + r")\b)(?:[^>=]*?[ _-][^>=]*?|[A-Z0-9]{2,})>"
)
REQUIRED = {1: "Problem statement", 2: "Systems & Impact", 3: "Options", 4: "Recommendation"}
APPENDED = {5: "Contracts", 6: "Risks & Validation"}


def split_sections(text: str) -> dict[int, list[str]]:
    """Map each numbered `## N.` heading to its body lines (until the next `## `)."""
    sections: dict[int, list[str]] = {}
    current: int | None = None
    for line in text.splitlines():
        m = SECTION_RE.match(line)
        if m:
            current = int(m.group(1))
            sections[current] = []
        elif line.startswith("## "):
            current = None  # a non-numbered section closes the previous one
        elif current is not None:
            sections[current].append(line)
    return sections


def is_unfilled(body: list[str]) -> bool:
    """True when a section has no real content — empty or only `<placeholder>` lines."""
    content = [ln.strip() for ln in body if ln.strip() and not ln.strip().startswith("##")]
    return not content or all(PLACEHOLDER_RE.match(ln) for ln in content)


def has_inline_placeholders(body: list[str]) -> list[str]:
    """Return any inline angle-bracket placeholder tokens still present in the body.

    These are template fill-in fields like ``<your-project-name>`` or
    ``<describe the system here>`` that were never replaced with real content.
    A spec that still contains them has not been fully filled out.
    """
    found: list[str] = []
    for ln in body:
        for match in INLINE_PLACEHOLDER_RE.finditer(ln):
            found.append(match.group(0))
    return found


def lint(text: str) -> tuple[list[str], list[str]]:
    """Return (problems, notes) for a specification document."""
    sections = split_sections(text)
    problems: list[str] = []
    notes: list[str] = []

    for num, name in REQUIRED.items():
        if num not in sections:
            problems.append(f"missing required section {num}. {name}")
        elif is_unfilled(sections[num]):
            problems.append(f"section {num}. {name} is empty or still placeholder")
        else:
            placeholders = has_inline_placeholders(sections[num])
            if placeholders:
                examples = ", ".join(placeholders[:3])
                problems.append(
                    f"section {num}. {name} contains unfilled template placeholder(s): {examples}"
                )

    if not re.search(r"(?i)(?:##+|\*\*)\s*success criteria", text):
        problems.append("missing the measurable 'Success criteria' block (required)")

    for num, name in APPENDED.items():
        if num not in sections:
            notes.append(f"section {num}. {name} not present yet (design appends it)")

    return problems, notes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--input",
        default="status/specification.md",
        help="specification file to check (default: status/specification.md)",
    )
    args = parser.parse_args()

    path = Path(args.input)
    if not path.exists():
        print(f"✗ {path} not found — pass --input <spec>", file=sys.stderr)
        return 2
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"✗ failed to read {path}: {exc}", file=sys.stderr)
        return 2

    problems, notes = lint(text)
    for note in notes:
        print(f"  · {note}")
    if problems:
        for p in problems:
            print(f"  ✗ {p}")
        print(f"\n{path}: {len(problems)} structural problem(s)")
        return 1
    print(f"✓ {path}: required sections present and filled")
    return 0


if __name__ == "__main__":
    sys.exit(main())
