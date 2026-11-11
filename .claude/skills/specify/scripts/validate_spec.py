#!/usr/bin/env python3
"""validate_spec.py — structural lint for a status/specification.md document.

Checks that a produced specification has the sections the `specify` / `design`
workflow requires — it verifies shape, not content quality. Sections 1-4 are
owned by `specify` and required; 5-6 are appended by `design` and reported as
pending when absent. The measurable Success criteria block is required.

This is a shallow check: it confirms required `## ` sections exist, are not
empty or placeholder-only, and that the Success criteria block is present. It
cannot judge whether the prose is any good.

It also reads the review record in the header (see _review_record.py): a notes
file the header names must be committed beside the spec. `--require-approved`
additionally demands a **Status** approving the current revision — `design`
runs it before starting.

When `status/ideas.md` exists (explore-idea's backlog), it also warns — never
fails — when an agreed `D-N` decision of a sub-project tied to this spec is not
cited anywhere in it. The parser is the bundle's `ideas_log.py`; when it cannot
be imported, the warning is skipped.

Human-readable on stdout; problems on stderr. Exit 0 = well-formed, 1 = missing
or unfilled required sections, a notes file not in the repo, or (with
--require-approved) no backed approval, 2 = usage error (file missing).
"""

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _review_record as review_record

# The ideas-backlog parser ships once, in the bundle beside query_status.py.
# Optional: a spec check must not fail because a sibling skill is missing.
sys.path.insert(1, str(Path(__file__).resolve().parents[2] / "init" / "assets" / "scripts"))
try:
    import ideas_log
except ImportError:  # pragma: no cover - only when the init skill is absent
    ideas_log = None  # type: ignore[assignment]

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


def ideas_file(spec_path: Path) -> Path:
    """`status/ideas.md`: beside a spec kept in `status/`, else under the working directory."""
    beside = spec_path.parent / "ideas.md"
    return beside if beside.is_file() else Path("status") / "ideas.md"


def ideas_warnings(text: str, spec_path: Path, ideas_path: Path) -> list[str]:
    """Agreed decisions from the ideas backlog that this spec does not cite."""
    if ideas_log is None or not ideas_path.is_file():
        return []
    log = ideas_log.load(ideas_path)
    if log is None:
        return []
    owed, reason = ideas_log.decisions_for_spec(log, spec_path)
    if reason:
        return [reason]
    missing = [d.id for d in owed if not re.search(rf"\b{re.escape(d.id)}\b", text)]
    if not missing:
        return []
    return [
        f"agreed decision(s) {', '.join(missing)} in {ideas_path} are not in this spec — "
        "carry the D-N rows under the Recommendation section"
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--input",
        default="status/specification.md",
        help="specification file to check (default: status/specification.md)",
    )
    parser.add_argument(
        "--require-approved",
        action="store_true",
        help="also fail unless **Status** approves the current revision, backed by a "
        "committed notes file or an explicit `without annotations`",
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
    problems += review_record.notes_problems(text, path)
    if review_record.revision(text) is None:
        notes.append("no **Revision** header line yet — see the template's header block")
    if args.require_approved:
        problems += review_record.approval_problems(text, path)
    for note in notes:
        print(f"  · {note}")
    for warning in ideas_warnings(text, path, ideas_file(path)):
        print(f"  ! {warning}")
    if problems:
        for p in problems:
            print(f"  ✗ {p}")
        print(f"\n{path}: {len(problems)} structural problem(s)")
        return 1
    print(f"✓ {path}: required sections present and filled")
    return 0


if __name__ == "__main__":
    # Windows consoles default to a legacy codepage (cp1252 and friends);
    # a non-ASCII line must degrade to "?", never take the process down.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
