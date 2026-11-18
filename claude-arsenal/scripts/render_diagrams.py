#!/usr/bin/env python3
"""Render each ```drawspec fence in a Markdown file to an SVG GitHub can show.

GitHub does not know the `drawspec` fence, so a spec or plan read there shows JSON
where the picture should be. This draws each fence to `diagrams/<stem>-<n>.svg`
beside the document and writes, around the fence:

    ![Title](diagrams/plan-1.svg) <!-- drawspec-render -->

    <details><summary>Diagram source</summary>

    ```drawspec
    { ... }
    ```

    </details>

The fence stays the source of truth; the SVG is derived from it. The SVG keeps
drawspec's `currentColor` ink and sets that colour itself, dark under
`prefers-color-scheme: dark`, so it reads on GitHub's light and dark themes.
`create_reader.py` drops the image line and the wrapper, so the HTML reader still
draws each diagram once, inline.

    render_diagrams.py status/plan.md status/specification.md
    render_diagrams.py --check status/*.md     # exit 1 when an SVG or wrapper is stale

drawspec runs as $ARSENAL_DRAWSPEC when set, else `drawspec` on PATH, else
`uvx --from 'drawspec>=0.4,<0.5' drawspec` (PyPI).

Exit: 0 when everything is current (or was written), 1 when --check finds drift or
drawspec refuses a block, 2 on usage errors.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

DRAWSPEC_PACKAGE = "drawspec>=0.4,<0.5"
OPEN_RE = re.compile(r"^(?P<ind>[ \t]*)(?P<fence>`{3,}|~{3,})[ \t]*drawspec[ \t]*$")
MARK = "<!-- drawspec-render -->"
IMAGE_RE = re.compile(r"^[ \t]*!\[[^\]]*\]\([^)]*\)[ \t]*" + re.escape(MARK) + r"[ \t]*$")
SOURCE_OPEN = "<details><summary>Diagram source</summary>"
SOURCE_CLOSE = "</details>"
# GitHub's own text colours, so a diagram reads like the page around it.
INK = "svg{color:#1f2328}@media (prefers-color-scheme:dark){svg{color:#e6edf3}}"
VIEWBOX_RE = re.compile(r'viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"')


class RenderError(Exception):
    pass


def drawspec_command() -> list[str]:
    """$ARSENAL_DRAWSPEC, else `drawspec` on PATH, else uvx from PyPI (pinned range)."""
    if os.environ.get("ARSENAL_DRAWSPEC"):
        return shlex.split(os.environ["ARSENAL_DRAWSPEC"])
    if shutil.which("drawspec"):
        return ["drawspec"]
    if shutil.which("uvx"):
        return ["uvx", "--quiet", "--from", DRAWSPEC_PACKAGE, "drawspec"]
    raise RenderError(
        f"drawspec cannot be run here: install uv (uvx runs {DRAWSPEC_PACKAGE!r}), "
        "`pip install drawspec`, or set ARSENAL_DRAWSPEC"
    )


def render_svg(source: str, where: str) -> str:
    """The fence's JSON drawn as a standalone SVG whose ink follows the colour scheme."""
    proc = subprocess.run(
        [*drawspec_command(), "render", "--profile", "inline", "-"],
        input=source,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if proc.returncode != 0:
        raise RenderError(f"{where}: drawspec refused it —\n{proc.stderr.strip()}")
    svg = proc.stdout.strip()
    size = VIEWBOX_RE.search(svg)
    attrs = f' width="{size[1]}" height="{size[2]}"' if size else ""
    return svg.replace("<svg ", f"<svg{attrs} ", 1).replace(">", f"><style>{INK}</style>", 1) + "\n"


def alt_text(source: str, n: int) -> str:
    """The document's description, else its title, else "Diagram <n>"."""
    try:
        doc = json.loads(source)
    except ValueError:
        doc = None
    for key in ("description", "title"):
        value = doc.get(key) if isinstance(doc, dict) else None
        if isinstance(value, str) and value.strip():
            return re.sub(r"[\[\]\s]+", " ", value).strip()
    return f"Diagram {n}"


def unwrap(lines: list[str]) -> list[str]:
    """Drop what an earlier run wrote around the fences, so a rerun starts clean."""
    out: list[str] = []
    skip_blank = False
    # Only the close of a wrapper this script opened goes; an author's own </details> stays.
    in_wrapper = False
    for line in lines:
        if skip_blank and line.strip() == "":
            skip_blank = False
            continue
        skip_blank = False
        if IMAGE_RE.match(line) or line.strip() == SOURCE_OPEN:
            in_wrapper |= line.strip() == SOURCE_OPEN
            skip_blank = True
            continue
        if in_wrapper and line.strip() == SOURCE_CLOSE and out and out[-1].strip() == "":
            in_wrapper = False
            out.pop()
            continue
        out.append(line)
    return out


def process(doc: Path) -> tuple[str, dict[Path, str]]:
    """The document's new text, and each SVG it needs, by path."""
    lines = unwrap(doc.read_text(encoding="utf-8").split("\n"))
    out: list[str] = []
    svgs: dict[Path, str] = {}
    i = 0
    while i < len(lines):
        m = OPEN_RE.match(lines[i])
        if not m:
            out.append(lines[i])
            i += 1
            continue
        fence, ind = m.group("fence"), m.group("ind")
        j = i + 1
        while j < len(lines):
            close = lines[j].strip()
            if close and set(close) == {fence[0]} and len(close) >= len(fence):
                break
            j += 1
        body = "\n".join(ln[len(ind) :] if ln.startswith(ind) else ln for ln in lines[i + 1 : j])
        n = len(svgs) + 1
        rel = f"diagrams/{doc.stem}-{n}.svg"
        link = quote(rel)  # a name with spaces or parentheses must not break the link
        svgs[doc.parent / rel] = render_svg(body, f"{doc}, drawspec block {n}")
        out += [f"{ind}![{alt_text(body, n)}]({link}) {MARK}", "", ind + SOURCE_OPEN, ""]
        out += lines[i : j + 1]
        out += ["", ind + SOURCE_CLOSE]
        i = j + 1
    return "\n".join(out), svgs


def stale_svgs(doc: Path, keep: dict[Path, str]) -> list[Path]:
    """SVGs an earlier run drew for blocks the document no longer has."""
    folder = doc.parent / "diagrams"
    pattern = re.compile(re.escape(doc.stem) + r"-\d+\.svg")
    if not folder.is_dir():
        return []
    return [p for p in sorted(folder.iterdir()) if pattern.fullmatch(p.name) and p not in keep]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("docs", nargs="+", type=Path, help="Markdown files to render")
    ap.add_argument("--check", action="store_true", help="report drift, write nothing")
    args = ap.parse_args(argv)

    drift: list[str] = []
    for doc in args.docs:
        if not doc.is_file():
            print(f"error: {doc} not found", file=sys.stderr)
            return 2
        try:
            text, svgs = process(doc)
        except RenderError as err:
            print(f"error: {err}", file=sys.stderr)
            return 1
        changes: list[tuple[Path, str | None]] = []
        if text != doc.read_text(encoding="utf-8"):
            changes.append((doc, text))
        for path, svg in svgs.items():
            if not path.is_file() or path.read_text(encoding="utf-8") != svg:
                changes.append((path, svg))
        changes += [(p, None) for p in stale_svgs(doc, svgs)]
        for path, content in changes:
            if args.check:
                drift.append(f"{path}: {'stale' if content is None else 'out of date'}")
            elif content is None:
                path.unlink()
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
                print(f"wrote {path}")
    for line in drift:
        print(line)
    if drift:
        print(f"run: render_diagrams.py {' '.join(map(str, args.docs))}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    # Windows consoles default to a legacy codepage; a non-ASCII line degrades to "?".
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
