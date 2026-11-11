#!/usr/bin/env python3
"""ideas_log.py — read and check `status/ideas.md`, the durable ideas backlog.

`explore-idea` owns the file: ideas sorted into lettered groups with stable
`I-N` ids, sub-projects (`S-N`) built from those groups, and the `D-N`
decision log. This is the one parser for it, so the skill's check, the board
line `query_status.py` prints and `validate_spec.py`'s coverage warning all
read the file the same way.

    ideas_log.py check   [--file status/ideas.md] [--base REF]
    ideas_log.py summary [--file status/ideas.md]

`check` validates ids and statuses: every idea bullet ends in `(I-N)`, no id
is used twice, a sub-project's status is one of parked / exploring /
specified / dropped and its groups exist, a decision's status is agreed /
open / open (research) / superseded by D-N naming a real row. With `--base`,
any id present in that git revision's copy and gone now is a problem: ids
are never removed or renumbered, because a spec and a decision cite them.

`summary` prints one line — `ideas: N parked, M exploring, K sub-projects
without spec` (sub-project counts; "without spec" is every exploring or specified
sub-project with an empty Spec section cell). It prints nothing when the file
does not exist, so a repo with no backlog pays nothing for it.

Exit: 0 clean (or no file); 1 problems found by `check`; 2 usage error.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_FILE = Path("status/ideas.md")

SUBPROJECT_STATUSES = ("parked", "exploring", "specified", "dropped")
DECISION_STATUS_RE = re.compile(r"^(agreed|open|open \(research\)|superseded by (D-\d+))$")

H2_RE = re.compile(r"^##\s+(.*\S)\s*$")
GROUP_RE = re.compile(r"^###\s+([A-Z]{1,2})\.\s+(.*\S)\s*$")
BULLET_RE = re.compile(r"^\s*[-*+]\s+(.*\S)\s*$")
IDEA_ID_RE = re.compile(r"\((I-\d+)\)\s*$")
EMPTY_CELL = {"", "-", "\u2014", "\u2013", "n/a", "none"}


@dataclass
class Idea:
    id: str
    text: str
    group: str


@dataclass
class SubProject:
    id: str
    name: str
    groups: list[str]
    status: str
    spec: str


@dataclass
class Decision:
    id: str
    text: str
    status: str
    date: str
    subproject: str = ""


@dataclass
class IdeasLog:
    groups: dict[str, str] = field(default_factory=dict)
    ideas: list[Idea] = field(default_factory=list)
    subprojects: list[SubProject] = field(default_factory=list)
    decisions: list[Decision] = field(default_factory=list)
    # True when the decision log carries a Sub-project column, which is what
    # lets a decision be mapped to the spec that must carry it.
    decisions_scoped: bool = False
    problems: list[str] = field(default_factory=list)

    def ids(self) -> set[str]:
        return (
            {i.id for i in self.ideas}
            | {s.id for s in self.subprojects}
            | {d.id for d in self.decisions}
        )


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _is_separator(cells: list[str]) -> bool:
    return all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c)


def _tables(lines: list[str]) -> list[tuple[list[str], list[list[str]]]]:
    """Every pipe table in a block of lines, as (lower-cased header, rows)."""
    out: list[tuple[list[str], list[list[str]]]] = []
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith("|") and i + 1 < len(lines):
            header = [c.lower() for c in _cells(lines[i])]
            if _is_separator(_cells(lines[i + 1])):
                rows: list[list[str]] = []
                j = i + 2
                while j < len(lines) and lines[j].lstrip().startswith("|"):
                    rows.append(_cells(lines[j]))
                    j += 1
                out.append((header, rows))
                i = j
                continue
        i += 1
    return out


def _col(header: list[str], *names: str) -> int | None:
    for idx, h in enumerate(header):
        if any(h.startswith(n) for n in names):
            return idx
    return None


def _cell(row: list[str], idx: int | None) -> str:
    return row[idx].strip("` ") if idx is not None and idx < len(row) else ""


def parse(text: str) -> IdeasLog:
    """Parse an ideas file. Structural problems land in `.problems`, never raise."""
    log = IdeasLog()
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in text.splitlines():
        m = H2_RE.match(line)
        if m:
            current = m.group(1).strip().lower()
            sections[current] = []
        elif current is not None:
            sections[current].append(line)

    # Groups: `### A. <theme>`, then `- <idea>  (I-N)` bullets.
    group = ""
    for line in sections.get("groups", []):
        g = GROUP_RE.match(line)
        if g:
            group = g.group(1)
            if group in log.groups:
                log.problems.append(f"group {group} is declared twice")
            log.groups[group] = g.group(2)
            continue
        b = BULLET_RE.match(line)
        if not b:
            continue
        body = b.group(1)
        idm = IDEA_ID_RE.search(body)
        if not idm:
            log.problems.append(f"idea without an (I-N) id: {body[:60]}")
            continue
        if not group:
            log.problems.append(f"{idm.group(1)} sits outside any `### X. <theme>` group")
        log.ideas.append(Idea(idm.group(1), body[: idm.start()].strip(), group))

    for header, rows in _tables(sections.get("sub-projects", [])):
        c_id, c_name = _col(header, "id"), _col(header, "name")
        c_groups, c_status, c_spec = (
            _col(header, "group"),
            _col(header, "status"),
            _col(header, "spec"),
        )
        for row in rows:
            groups = [g for g in re.split(r"[,\s]+", _cell(row, c_groups)) if g]
            log.subprojects.append(
                SubProject(
                    _cell(row, c_id),
                    _cell(row, c_name),
                    groups,
                    _cell(row, c_status).lower(),
                    _cell(row, c_spec),
                )
            )

    for header, rows in _tables(sections.get("decision log", [])):
        c_id, c_dec = _col(header, "id"), _col(header, "decision")
        c_status, c_date = _col(header, "status"), _col(header, "date")
        c_sub = _col(header, "sub-project", "subproject")
        log.decisions_scoped = log.decisions_scoped or c_sub is not None
        for row in rows:
            log.decisions.append(
                Decision(
                    _cell(row, c_id),
                    _cell(row, c_dec),
                    _cell(row, c_status),
                    _cell(row, c_date),
                    _cell(row, c_sub),
                )
            )

    _validate(log)
    return log


def _validate(log: IdeasLog) -> None:
    seen: set[str] = set()

    def claim(id_: str, kind: str, pattern: str) -> None:
        if not re.fullmatch(pattern, id_):
            log.problems.append(f"{kind} id {id_ or '(empty)'!r} is not of the form {pattern}")
        elif id_ in seen:
            log.problems.append(f"{id_} is used twice — ids are never reused")
        seen.add(id_)

    for idea in log.ideas:
        claim(idea.id, "idea", r"I-\d+")
    decision_ids = {d.id for d in log.decisions}
    for sp in log.subprojects:
        claim(sp.id, "sub-project", r"S-\d+")
        if sp.status not in SUBPROJECT_STATUSES:
            log.problems.append(
                f"{sp.id}: status {sp.status!r} is not one of {', '.join(SUBPROJECT_STATUSES)}"
            )
        for g in sp.groups:
            if g not in log.groups:
                log.problems.append(f"{sp.id}: names group {g}, which is not declared")
        if sp.status == "specified" and sp.spec.lower() in EMPTY_CELL:
            log.problems.append(f"{sp.id}: specified, but its Spec section cell is empty")
    sub_ids = {s.id for s in log.subprojects}
    for d in log.decisions:
        claim(d.id, "decision", r"D-\d+")
        m = DECISION_STATUS_RE.match(d.status)
        if not m:
            log.problems.append(
                f"{d.id}: status {d.status!r} is not agreed / open / open (research) / "
                "superseded by D-N"
            )
        elif m.group(2) and m.group(2) not in decision_ids:
            log.problems.append(f"{d.id}: superseded by {m.group(2)}, which has no row")
        if d.subproject and d.subproject.lower() not in EMPTY_CELL and d.subproject not in sub_ids:
            log.problems.append(f"{d.id}: names sub-project {d.subproject}, which has no row")


def load(path: Path) -> IdeasLog | None:
    """The parsed file, or None when it does not exist or cannot be read."""
    try:
        return parse(path.read_text(encoding="utf-8"))
    except OSError:
        return None


def summary_line(path: Path = DEFAULT_FILE) -> str | None:
    """The one board line, or None when there is no ideas file."""
    log = load(path)
    if log is None:
        return None
    count = {s: sum(1 for p in log.subprojects if p.status == s) for s in SUBPROJECT_STATUSES}
    nospec = sum(
        1
        for p in log.subprojects
        if p.status in {"exploring", "specified"} and p.spec.lower() in EMPTY_CELL
    )
    line = (
        f"ideas: {count['parked']} parked, {count['exploring']} exploring, "
        f"{nospec} sub-projects without spec"
    )
    if log.problems:
        line += f" ({len(log.problems)} problem(s) — run ideas_log.py check)"
    return line


def decisions_for_spec(log: IdeasLog, spec_path: Path) -> tuple[list[Decision], str | None]:
    """Agreed decisions that a spec at `spec_path` must carry, or a reason it cannot tell.

    A sub-project is tied to this spec when its Spec section cell names the
    spec's file name, or when it is `exploring` with no spec named yet. A
    decision is tied to a sub-project by the log's optional Sub-project column;
    without that column, the mapping is only clean when exactly one sub-project
    is in play, and then every agreed decision belongs to it.
    """
    in_play = [p for p in log.subprojects if p.status in {"exploring", "specified"}]
    mine = [
        p
        for p in in_play
        if spec_path.name in p.spec or (p.status == "exploring" and p.spec.lower() in EMPTY_CELL)
    ]
    if not mine:
        return [], None
    agreed = [d for d in log.decisions if d.status == "agreed"]
    if log.decisions_scoped:
        ids = {p.id for p in mine}
        return [d for d in agreed if d.subproject in ids], None
    if len(in_play) == 1:
        return agreed, None
    return [], (
        "decision log has no Sub-project column and several sub-projects are in play — "
        "decision coverage not checked"
    )


def _base_ids(path: Path, ref: str) -> set[str] | None:
    try:
        done = subprocess.run(
            # `./` makes the path relative to cwd, so --file works absolute or relative.
            ["git", "show", f"{ref}:./{path.name}"],
            cwd=path.resolve().parent,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None
    if done.returncode != 0:
        return None
    return parse(done.stdout).ids()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=("check", "summary"))
    parser.add_argument("--file", type=Path, default=DEFAULT_FILE)
    parser.add_argument(
        "--base",
        metavar="REF",
        help="check: also fail on any id present in REF's copy of the file and gone now",
    )
    args = parser.parse_args(argv)

    if args.command == "summary":
        line = summary_line(args.file)
        if line:
            print(line)
        return 0

    log = load(args.file)
    if log is None:
        print(f"ideas_log: {args.file} not found — nothing to check")
        return 0
    problems = list(log.problems)
    if args.base:
        before = _base_ids(args.file, args.base)
        if before is not None:
            for gone in sorted(before - log.ids(), key=lambda s: (s[0], int(s[2:]))):
                problems.append(
                    f"{gone} was in {args.base} and is gone — ids are never removed or "
                    "renumbered; keep the row and change its status instead"
                )
    for p in problems:
        print(f"  ✗ {p}", file=sys.stderr)
    if problems:
        print(f"{args.file}: {len(problems)} problem(s)", file=sys.stderr)
        return 1
    print(
        f"✓ {args.file}: {len(log.ideas)} ideas, {len(log.subprojects)} sub-projects, "
        f"{len(log.decisions)} decisions"
    )
    return 0


if __name__ == "__main__":
    # Windows consoles default to a legacy codepage (cp1252 and friends);
    # a non-ASCII line must degrade to "?", never take the process down.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
