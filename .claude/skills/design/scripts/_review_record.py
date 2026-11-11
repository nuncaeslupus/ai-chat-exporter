"""_review_record.py — read the review history a spec or plan records in its header.

DUPLICATED ACROSS SKILLS:
- plugins/core/skills/specify/scripts/_review_record.py (canonical)
- plugins/core/skills/design/scripts/_review_record.py

Keep both copies in sync. Update via skill-workshop's sync_duplicates.py

Imported by validate_spec.py / validate_plan.py; not a command of its own. The
header lines it reads, above the document's first `## ` section:

    **Revision**: 3
    **Status**: approved (2026-09-29, revision 3) — without annotations
    **Revision log**:
    - r1 — first draft
    - r2 — applied `yourproject-spec-v1-2026-09-20-notes.md`
    - r3 — applied `yourproject-spec-v2-2026-09-25-notes.md`

A notes file is named by its basename and lives beside the document. Naming one
that is not in the repository is a problem: the revision it drove then cites
review history nobody can read.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

# `<project>-<spec|plan>-notes-<date>-r<N>.md` (older readers) or
# `<repo>-<doc>-v<N>-<YYYY-MM-DD[-HHMM]>-notes.md` (the reader's own naming).
NOTES_RE = re.compile(
    r"[\w.-]+-(?:(?:spec|plan)-notes-[\w.-]+|v\d+-\d{4}-\d{2}-\d{2}(?:-\d{4})?-notes)\.md"
)
REVISION_RE = re.compile(r"^\*\*Revision\*\*:\s*r?(\d+)\b", re.MULTILINE)
STATUS_RE = re.compile(r"^\*\*Status\*\*:\s*(.+)$", re.MULTILINE)
APPROVED_RE = re.compile(r"^approved\b[^()]*\(([^)]*)\)(.*)$", re.IGNORECASE)
REV_IN_STATUS_RE = re.compile(r"revision\s*r?(\d+)", re.IGNORECASE)
WITHOUT_RE = re.compile(r"without annotations", re.IGNORECASE)


def header(text: str) -> str:
    """Everything above the first `## ` section."""
    return re.split(r"^## ", text, maxsplit=1, flags=re.MULTILINE)[0]


def revision(text: str) -> int | None:
    m = REVISION_RE.search(header(text))
    return int(m.group(1)) if m else None


def status(text: str) -> str | None:
    m = STATUS_RE.search(header(text))
    return m.group(1).strip() if m else None


def _tracked(path: Path) -> bool | None:
    """True/False when `path` is in a git repository's index; None outside one."""
    try:
        inside = subprocess.run(
            ["git", "-C", str(path.parent), "rev-parse", "--is-inside-work-tree"],
            capture_output=True,
            text=True,
            check=False,
        )
        if inside.returncode != 0:
            return None
        listed = subprocess.run(
            ["git", "-C", str(path.parent), "ls-files", "--error-unmatch", path.name],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None
    return listed.returncode == 0


def notes_problems(text: str, doc: Path) -> list[str]:
    """One problem per notes file the header names that is not in the repository."""
    problems = []
    for name in dict.fromkeys(NOTES_RE.findall(header(text))):
        path = doc.parent / name
        if not path.is_file():
            problems.append(f"header names notes file {name}, which is not beside {doc.name}")
        elif _tracked(path) is False:
            problems.append(
                f"notes file {name} is not committed — `git add` it with the revision it drove"
            )
    return problems


def approval_problems(text: str, doc: Path) -> list[str]:
    """Why the document is not approved for the next step, or [] when it is."""
    raw = status(text)
    m = APPROVED_RE.match(raw or "")
    if m is None:
        return [f"**Status** is {raw or 'missing'!r}, not approved — the reviewer approves first"]
    problems = []
    rev_m = REV_IN_STATUS_RE.search(m.group(1))
    current = revision(text)
    if rev_m is None:
        return ["**Status** says approved but names no revision"]
    approved = int(rev_m.group(1))
    if current is not None and approved != current:
        problems.append(
            f"approved revision {approved}, but the document is at revision {current} — "
            "an edit after approval needs approving again"
        )
    if WITHOUT_RE.search(raw or ""):
        return problems
    log = re.search(rf"^\s*[-*]\s*r{approved}\b.*$", header(text), re.MULTILINE)
    backing = NOTES_RE.findall(raw or "") + (NOTES_RE.findall(log.group(0)) if log else [])
    if not any(
        (doc.parent / n).is_file() and _tracked(doc.parent / n) is not False for n in backing
    ):
        problems.append(
            f"approved revision {approved} names no committed notes file — record the "
            "reviewer's export, or `without annotations` when they approved without one"
        )
    return problems
