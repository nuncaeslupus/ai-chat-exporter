"""Compose the README's hero image — a conversation, exported.

Not shipped code. Writes docs/hero.svg, then rasterises it to docs/hero.png with a
headless Chromium (the README shows the PNG: GitHub's `<img>` view of an SVG loads
no fonts). Needs the Inter and DejaVu Sans Mono fonts and Pillow (to crop).

Same drafting-sheet family as the author's other repos, built around the
extension's own icon. Platforms appear as names, never as their logos, and the
sheet carries no version or counts, so nothing on it goes stale.

Usage, from the repository root:

    make hero
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
OUT_SVG = ROOT / "docs" / "hero.svg"
OUT_PNG = ROOT / "docs" / "hero.png"

#: The GitHub social-preview size, which the README shows scaled to its column.
W, H = 1280, 640

GROUND = "#0c1d18"
GRID = "#132a22"
INK = "#eef5f1"
SOFT = "#c5d8d0"
DIM = "#8fb3a5"
FRAME = "#3f6656"
PANEL = "#12291f"
LOGO = "#0A6B54"  # the extension icon's green
MINT = "#4fd1a1"
SANS = "Inter, 'DejaVu Sans', sans-serif"
DISPLAY = "'Inter Display', Inter, sans-serif"
MONO = "'DejaVu Sans Mono', monospace"


def text(
    x: float,
    y: float,
    s: str,
    *,
    size: float,
    fill: str = INK,
    family: str = SANS,
    weight: int = 400,
    anchor: str = "start",
    spacing: float = 0,
    italic: bool = False,
) -> str:
    style = ' font-style="italic"' if italic else ""
    return (
        f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" '
        f'font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" '
        f'letter-spacing="{spacing}"{style} xml:space="preserve">{escape(s)}</text>'
    )


def sheet() -> list[str]:
    """Grid, border with zone marks, registration marks — the family's drafting sheet."""
    out = [f'<rect width="{W}" height="{H}" fill="{GROUND}"/>']
    for x in range(0, W, 20):
        width = 0.9 if x % 100 == 0 else 0.4
        out.append(
            f'<line x1="{x}" y1="0" x2="{x}" y2="{H}" stroke="{GRID}" stroke-width="{width}"/>'
        )
    for y in range(0, H, 20):
        width = 0.9 if y % 100 == 0 else 0.4
        out.append(
            f'<line x1="0" y1="{y}" x2="{W}" y2="{y}" stroke="{GRID}" stroke-width="{width}"/>'
        )
    out.append(
        f'<rect x="16" y="16" width="{W - 32}" height="{H - 32}" fill="none" stroke="{GRID}"/>'
    )
    out.append(
        f'<rect x="30" y="30" width="{W - 60}" height="{H - 60}" fill="none" '
        f'stroke="{FRAME}" stroke-width="1.5"/>'
    )
    zw = (W - 60) / 8
    for i in range(8):
        x = 30 + zw * i
        if i:
            out.append(f'<line x1="{x}" y1="16" x2="{x}" y2="30" stroke="{FRAME}"/>')
            out.append(
                f'<line x1="{x}" y1="{H - 30}" x2="{x}" y2="{H - 16}" stroke="{FRAME}"/>'
            )
        for y in (27, H - 19):
            out.append(
                text(
                    x + zw / 2,
                    y,
                    str(8 - i),
                    size=9,
                    fill=DIM,
                    family=MONO,
                    anchor="middle",
                )
            )
    zh = (H - 60) / 4
    for i in range(4):
        y = 30 + zh * i
        if i:
            out.append(f'<line x1="16" y1="{y}" x2="30" y2="{y}" stroke="{FRAME}"/>')
            out.append(
                f'<line x1="{W - 30}" y1="{y}" x2="{W - 16}" y2="{y}" stroke="{FRAME}"/>'
            )
        for x in (23, W - 23):
            out.append(
                text(
                    x,
                    y + zh / 2 + 3,
                    "ABCD"[i],
                    size=9,
                    fill=DIM,
                    family=MONO,
                    anchor="middle",
                )
            )
    for cx, cy in ((48, 48), (48, H - 48)):
        out += [
            f'<circle cx="{cx}" cy="{cy}" r="7" fill="none" stroke="{MINT}"/>',
            f'<line x1="{cx - 11}" y1="{cy}" x2="{cx + 11}" y2="{cy}" stroke="{MINT}"/>',
            f'<line x1="{cx}" y1="{cy - 11}" x2="{cx}" y2="{cy + 11}" stroke="{MINT}"/>',
        ]
    return out


def icon(x: float, y: float, size: float) -> list[str]:
    """The extension icon (src/assets/icons/icon.svg), redrawn at any size."""
    k = size / 34
    return [
        f'<g transform="translate({x},{y}) scale({k})">'
        f'<rect x="1.5" y="1.5" width="31" height="31" rx="9" fill="{LOGO}"/>'
        '<path d="M17 9v11m0 0 4.5-4.5M17 20l-4.5-4.5M10 24.5h14" stroke="#FFFFFF" '
        'stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g>'
    ]


def wordmark() -> list[str]:
    return [
        *icon(60, 52, 84),
        f'<text x="160" y="118" font-family="{DISPLAY}" font-size="66" font-weight="800" '
        f'letter-spacing="-1.5"><tspan fill="{INK}">AI Chat </tspan>'
        f'<tspan fill="{MINT}">Exporter</tspan></text>',
        text(
            66,
            172,
            "Your AI conversations, exported the way you want them.",
            size=25,
            fill=SOFT,
        ),
        text(
            66,
            200,
            "A browser extension for ChatGPT, Claude and Gemini, on Chrome and Firefox.",
            size=15,
            fill=DIM,
        ),
    ]


def title_block() -> list[str]:
    x, y, w, h = 842, 62, 376, 64
    half = w / 2 - 20
    cells = [(0.0, "RUNS IN", "Chrome · Firefox"), (half, "LICENSE", "MIT")]
    out = [
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{GROUND}" stroke="{FRAME}" '
        f'stroke-width="1.2"/>',
        f'<line x1="{x}" y1="{y + h / 2 + 4}" x2="{x + w}" y2="{y + h / 2 + 4}" stroke="{FRAME}"/>',
        f'<line x1="{x + half}" y1="{y + h / 2 + 4}" x2="{x + half}" y2="{y + h}" '
        f'stroke="{FRAME}"/>',
        text(x + 10, y + 14, "PROJECT", size=8, fill=DIM, family=MONO, spacing=1.5),
        text(x + 10, y + 30, "ai-chat-exporter", size=14, weight=700, family=MONO),
    ]
    for cx, label, value in cells:
        out.append(
            text(x + cx + 10, y + 47, label, size=8, fill=DIM, family=MONO, spacing=1.5)
        )
        out.append(
            text(
                x + cx + 10,
                y + 61,
                value,
                size=11,
                family=MONO,
                fill=MINT if cx else INK,
            )
        )
    return out


def checkbox(x: float, y: float, on: bool) -> list[str]:
    out = [
        f'<rect x="{x}" y="{y}" width="14" height="14" rx="3" fill="{LOGO if on else "none"}" '
        f'stroke="{MINT if on else FRAME}" stroke-width="1.4"/>'
    ]
    if on:
        out.append(
            f'<path d="M{x + 3.5},{y + 7.5} l2.6,2.6 l4.6,-5.4" fill="none" stroke="#fff" '
            f'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
        )
    return out


def chat() -> list[str]:
    """A conversation window: platform tabs, two Q&A pairs, one of them deselected."""
    x, y, w, h = 64, 252, 430, 262
    out = [
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{PANEL}" stroke="{FRAME}"/>',
        f'<line x1="{x}" y1="{y + 34}" x2="{x + w}" y2="{y + 34}" stroke="{FRAME}"/>',
    ]
    tx = x + 12
    for i, name in enumerate(("ChatGPT", "Claude", "Gemini")):
        tw = len(name) * 7.4 + 22
        active = i == 1
        out += [
            f'<rect x="{tx}" y="{y + 8}" width="{tw}" height="20" rx="10" '
            f'fill="{LOGO if active else "none"}" stroke="{MINT if active else FRAME}"/>',
            text(
                tx + tw / 2,
                y + 22,
                name,
                size=11.5,
                fill=INK if active else DIM,
                anchor="middle",
            ),
        ]
        tx += tw + 8
    # Pair 1, selected: a question, an answer with code and a citation.
    py = y + 50
    out += checkbox(x + 12, py + 4, True)
    out += [
        f'<rect x="{x + w - 248}" y="{py}" width="236" height="24" rx="12" fill="{LOGO}"/>',
        text(
            x + w - 24,
            py + 16.5,
            "How do I parse a date in Python?",
            size=12,
            fill=INK,
            anchor="end",
        ),
        text(
            x + 40,
            py + 48,
            "Use datetime.strptime with the format:",
            size=12,
            fill=SOFT,
        ),
        f'<rect x="{x + 40}" y="{py + 58}" width="{w - 56}" height="26" rx="4" fill="#0a1813" '
        f'stroke="{FRAME}" stroke-width="0.8"/>',
        f'<text x="{x + 50}" y="{py + 75}" font-family="{MONO}" font-size="11.5" '
        f'xml:space="preserve"><tspan fill="{MINT}">datetime</tspan><tspan fill="{INK}">'
        f'.strptime(s, </tspan><tspan fill="#e8c56a">"%Y-%m-%d"</tspan>'
        f'<tspan fill="{INK}">)</tspan></text>',
        f'<rect x="{x + 40}" y="{py + 94}" width="118" height="18" rx="9" fill="none" '
        f'stroke="{FRAME}"/>',
        text(
            x + 99, py + 107, "↗ docs.python.org", size=10.5, fill=DIM, anchor="middle"
        ),
    ]
    # Pair 2, left out of the export: dimmed.
    qy = y + 182
    out += checkbox(x + 12, qy + 4, False)
    out += [
        f'<rect x="{x + w - 168}" y="{qy}" width="156" height="24" rx="12" fill="none" '
        f'stroke="{FRAME}"/>',
        text(
            x + w - 24,
            qy + 16.5,
            "Thanks! And a joke?",
            size=12,
            fill=DIM,
            anchor="end",
        ),
        text(
            x + 40,
            qy + 48,
            "left out of this export",
            size=11.5,
            fill=FRAME,
            italic=True,
        ),
    ]
    return out


def exporter() -> list[str]:
    """The middle: the icon as the action, and the three ways to trigger it."""
    cx, y = 578, 300
    out = [
        f'<line x1="502" y1="{y + 40}" x2="{cx - 46}" y2="{y + 40}" stroke="{MINT}" '
        f'stroke-width="1.6" stroke-dasharray="5 3"/>',
        f'<line x1="{cx + 46}" y1="{y + 40}" x2="652" y2="{y + 40}" stroke="{MINT}" '
        f'stroke-width="1.6" stroke-dasharray="5 3"/>',
        f'<path d="M646,{y + 34} L654,{y + 40} L646,{y + 46}" fill="none" stroke="{MINT}" '
        f'stroke-width="1.6"/>',
        *icon(cx - 40, y, 80),
    ]
    ky = y + 104
    for i, key in enumerate(("Ctrl", "Shift", "E")):
        kw = len(key) * 8 + 16
        kx = cx - 74 + sum(len(k) * 8 + 16 + 6 for k in ("Ctrl", "Shift", "E")[:i])
        out += [
            f'<rect x="{kx}" y="{ky}" width="{kw}" height="24" rx="4" fill="{PANEL}" '
            f'stroke="{SOFT}" stroke-width="1"/>',
            text(kx + kw / 2, ky + 16.5, key, size=11.5, family=MONO, anchor="middle"),
        ]
    out += [
        text(cx, ky + 48, "or the popup", size=12, fill=DIM, anchor="middle"),
        text(cx, ky + 66, "or right-click", size=12, fill=DIM, anchor="middle"),
    ]
    return out


FORMATS = [
    ("MD", "clean, readable"),
    ("PDF", "paginated, highlighted"),
    ("HTML", "standalone, dark mode"),
    ("DOCX", "rich Word document"),
    ("TXT", "plain text"),
    ("JSON", "structured data"),
]


def formats() -> list[str]:
    x0, y0, w, h, gx, gy = 670, 252, 268, 76, 14, 17
    out = []
    for i, (ext, sub) in enumerate(FORMATS):
        x = x0 + (i % 2) * (w + gx)
        y = y0 + (i // 2) * (h + gy)
        fold = 14
        out += [
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{PANEL}" '
            f'stroke="{FRAME}"/>',
            # A page with a folded corner, its extension on it.
            f'<path d="M{x + 14},{y + 12} h{40 - fold} l{fold},{fold} v{52 - fold} h-40 z" '
            f'fill="{INK}"/>',
            f'<path d="M{x + 54 - fold},{y + 12} v{fold} h{fold}" fill="#c9d6d0"/>',
            text(
                x + 34,
                y + 54,
                ext,
                size=10,
                weight=800,
                family=MONO,
                fill=LOGO,
                anchor="middle",
            ),
            text(
                x + 70,
                y + 34,
                f".{ext.lower()}",
                size=17,
                weight=700,
                family=MONO,
                fill=INK,
            ),
            text(x + 70, y + 56, sub, size=12.5, fill=SOFT),
        ]
    return out


def strip() -> list[str]:
    items = [
        ("pairs", "choose which Q&A to keep"),
        ("content", "code, math, citations kept"),
        ("filename", "drag-and-drop builder"),
        ("languages", "the UI speaks yours"),
    ]
    x0, y, w, h, gap = 64, 548, 278, 40, 12
    out = []
    for i, (name, sub) in enumerate(items):
        x = x0 + i * (w + gap)
        out += [
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="{PANEL}" '
            f'stroke="{FRAME}" stroke-width="0.8"/>',
            f'<rect x="{x}" y="{y}" width="4" height="{h}" rx="2" fill="{MINT}"/>',
            text(x + 16, y + 25, name, size=12.5, weight=700, family=MONO, fill=MINT),
            text(x + 16 + len(name) * 7.6 + 10, y + 25, sub, size=12, fill=SOFT),
        ]
    return out


#: claude-arsenal's own logo, for the "powered by" stamp on the frame.
ARSENAL_LOGO = ROOT / "docs" / "claude-arsenal-logo.svg"


def powered_by() -> list[str]:
    """A "powered by" stamp for claude-arsenal, set on the frame's bottom edge at the right."""
    src = ARSENAL_LOGO.read_text().strip()
    inner = src[src.index(">") + 1 : src.rindex("</svg>")]
    lead, name = "powered by github.com/nuncaeslupus/", "claude-arsenal"
    size, tile, pad, gap = 9.5, 16, 8, 6
    width = pad + tile + gap + (len(lead) + len(name)) * size * 0.602 + pad
    right, cy = W - 30 - 24, H - 30
    x = right - width
    return [
        f'<rect x="{x:.1f}" y="{cy - 11}" width="{width:.1f}" height="22" rx="11" '
        f'fill="{GROUND}" stroke="{FRAME}"/>',
        f'<svg x="{x + pad:.1f}" y="{cy - tile / 2}" width="{tile}" height="{tile}" '
        f'viewBox="0 0 64 64">{inner}</svg>',
        f'<text x="{x + pad + tile + gap:.1f}" y="{cy + 3.4}" font-family="{MONO}" '
        f'font-size="{size}" fill="{DIM}">{lead}'
        f'<tspan font-weight="700" fill="{INK}">{name}</tspan></text>',
    ]


def svg() -> str:
    parts = (
        sheet() + wordmark() + title_block() + chat() + exporter() + formats() + strip()
    )
    parts += powered_by()
    body = "\n  ".join(parts)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}">\n  {body}\n</svg>\n'
    )


def chromium() -> str:
    for candidate in (
        os.environ.get("CHROMIUM"),
        "/opt/pw-browsers/chromium",
        shutil.which("chromium"),
        shutil.which("google-chrome"),
    ):
        if candidate and Path(candidate).exists():
            return candidate
    sys.exit("hero: no Chromium found; set CHROMIUM=/path/to/chrome")


def main() -> None:
    OUT_SVG.write_text(svg())
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "hero.html"
        page.write_text(
            f'<html><body style="margin:0;overflow:hidden">{svg()}</body></html>'
        )
        subprocess.run(
            [
                chromium(),
                "--headless=new",
                "--no-sandbox",
                "--hide-scrollbars",
                "--force-device-scale-factor=2",
                f"--window-size={W},{H + 200}",
                f"--screenshot={OUT_PNG}",
                page.as_uri(),
            ],
            check=True,
            capture_output=True,
        )
    # Headless Chromium's viewport is shorter than its window: shoot tall, then crop.
    from PIL import Image  # type: ignore[import-not-found, unused-ignore]

    with Image.open(OUT_PNG) as shot:
        shot.crop((0, 0, W * 2, H * 2)).save(OUT_PNG, optimize=True)
    print(f"wrote {OUT_SVG.relative_to(ROOT)} and {OUT_PNG.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
