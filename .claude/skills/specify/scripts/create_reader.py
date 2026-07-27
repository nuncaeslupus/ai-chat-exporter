#!/usr/bin/env python3
"""create_reader.py — generate an annotatable HTML + Markdown reader from specification files.

Auto-discovers spec source(s):
  1. --input FILE      single specification file
  2. --input-dir DIR   scans DIR/*/spec.md (workspace mode)
  3. auto (no flags): looks for claude-arsenal/project/*/spec.md,
                      then falls back to status/specification.md

Outputs (--output-dir, default: directory of the single spec, or docs/spec-reader/ in
workspace mode):
  spec-reader.html      self-contained HTML reader with per-section note fields
                        (notes auto-save in browser; Export button saves a Markdown file)
  spec-annotated.md     same spec as Markdown with a note slot per section

Seed notes from a previous Export by placing the downloaded file as
{output-dir}/notes.json. Notes are keyed by stable section IDs and are
re-injected into both output artifacts.

Requires: pip install markdown   (or: uv run --with markdown python3 create_reader.py)

Usage (run from repo root):
    uv run --with markdown python3 "$CLAUDE_SKILL_DIR/scripts/create_reader.py"
    uv run --with markdown python3 "$CLAUDE_SKILL_DIR/scripts/create_reader.py" \\
        --input status/specification.md --output-dir status
    uv run --with markdown python3 "$CLAUDE_SKILL_DIR/scripts/create_reader.py" \\
        --input-dir claude-arsenal/project --output-dir docs/spec-reader
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

try:
    import markdown
except ImportError:
    print(
        "✗ 'markdown' package not found. Install it: pip install markdown\n"
        "  or run: uv run --with markdown python3 create_reader.py",
        file=sys.stderr,
    )
    sys.exit(2)

_md = markdown.Markdown(extensions=["tables", "fenced_code", "sane_lists", "attr_list"])

HEADING_RE = re.compile(r"^(#{2,3})\s+(.*)$")
NUM_RE = re.compile(r"^(\d+(?:\.\d+)*)[.)]?\s+(.*)$")
HR_RE = re.compile(r"^-{3,}\s*$")


# ---------------------------------------------------------------- Markdown parsing

def normalize_list_indent(text: str) -> str:
    """Promote 1-3 space list indents to 4 spaces for python-markdown (HTML path only)."""
    out = []
    in_code_block = False
    for ln in text.split("\n"):
        if ln.strip().startswith("```"):
            in_code_block = not in_code_block
        if not in_code_block:
            m = re.match(r"^( {1,3})([-*+]|\d+[.)])(\s)", ln)
            if m:
                ln = "    " + ln[len(m.group(1)):]
        out.append(ln)
    return "\n".join(out)


def render_md(text: str) -> str:
    _md.reset()
    return _md.convert(normalize_list_indent(text))


def render_inline(text: str) -> str:
    _md.reset()
    out = _md.convert(text).strip()
    if out.startswith("<p>") and out.endswith("</p>"):
        out = out[3:-4]
    return out


def strip_inline_md(text: str) -> str:
    text = re.sub(r"`(.*?)`", r"\1", text)
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    text = re.sub(r"\*(.*?)\*", r"\1", text)
    text = re.sub(r"_(.*?)_", r"\1", text)
    return text.strip()


def slug(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def parse_doc(raw: str) -> tuple[str, str, list[dict]]:
    """Return (h1_title, intro_md, [sections])."""
    lines = raw.split("\n")
    h1 = ""
    i = 0
    h1_found = False
    in_code_block = False
    while i < len(lines):
        line = lines[i]
        if line.strip().startswith("```"):
            in_code_block = not in_code_block
        if not in_code_block:
            m = re.match(r"^#\s+(.*)$", line)
            if m:
                h1 = m.group(1).strip()
                i += 1
                h1_found = True
                break
        i += 1
    if not h1_found:
        i = 0
    intro_lines: list[str] = []
    in_code_block = False
    while i < len(lines):
        line = lines[i]
        if line.strip().startswith("```"):
            in_code_block = not in_code_block
        if not in_code_block and HEADING_RE.match(line):
            break
        intro_lines.append(line)
        i += 1
    sections: list[dict] = []
    cur: dict | None = None
    while i < len(lines):
        line = lines[i]
        if line.strip().startswith("```"):
            in_code_block = not in_code_block
        m = HEADING_RE.match(line) if not in_code_block else None
        if m:
            if cur:
                sections.append(cur)
            cur = {"level": len(m.group(1)), "heading": m.group(2).strip(), "body": []}
        else:
            if cur is not None:
                cur["body"].append(line)
        i += 1
    if cur:
        sections.append(cur)

    def clean(block_lines: list[str]) -> str:
        kept = [ln for ln in block_lines if not HR_RE.match(ln)]
        while kept and kept[0].strip() == "":
            kept.pop(0)
        while kept and kept[-1].strip() == "":
            kept.pop()
        return "\n".join(kept)

    intro_md = clean(intro_lines)
    for s in sections:
        s["body_md"] = clean(s["body"])
    return h1, intro_md, sections


def build_part(file_md: str, code: str, part_label: str, title: str) -> dict:
    """Parse one document into a structured part with stable ids/labels."""
    h1, intro_md, sections = parse_doc(file_md)
    items: list[dict] = []
    used: set[str] = set()

    def mk(domid_base: str) -> str:
        d = "s-" + slug(domid_base)
        n = d
        k = 1
        while n in used:
            k += 1
            n = f"{d}-{k}"
        used.add(n)
        return n

    if intro_md.strip():
        domid = mk(f"{code}-intro")
        items.append({
            "domid": domid,
            "key": f"{code} · intro",
            "chip": "overview",
            "title_html": "Preamble &amp; scope",
            "label": "Preamble & scope",
            "level": 2,
            "body_html": render_md(intro_md),
            "toc": "Preamble & scope",
            "raw_body": intro_md,
        })
    for s in sections:
        heading = s["heading"]
        m = NUM_RE.match(heading)
        if m:
            num, rest = m.group(1), m.group(2)
            chip = f"§{num}"
            key = f"{code} §{num}"
            title_html = render_inline(rest)
            label = f"§{num} {strip_inline_md(rest)}"
            toc = f"§{num} {strip_inline_md(rest)}"
            domid = mk(f"{code}-{num}")
        else:
            chip = "▸"
            title_html = render_inline(heading)
            plain = strip_inline_md(heading)
            key = f"{code} › {plain}"
            label = plain
            toc = plain
            domid = mk(f"{code}-{slug(plain)[:32]}")
        items.append({
            "domid": domid,
            "key": key,
            "chip": chip,
            "title_html": title_html,
            "label": label,
            "level": s["level"],
            "body_html": render_md(s["body_md"]),
            "toc": toc,
            "raw_body": s["body_md"],
        })
    return {
        "code": code,
        "part_label": part_label,
        "title": title,
        "h1": h1,
        "items": items,
    }


# ---------------------------------------------------------------- Source discovery

def collect_parts_single(spec_path: Path) -> list[tuple[str, dict]]:
    """Single-file mode: one part from the spec at spec_path."""
    code = "SPEC"
    raw = spec_path.read_text(encoding="utf-8")
    return [("spec", build_part(raw, code, "Specification", spec_path.stem.replace("-", " ").title()))]


def collect_parts_workspace(workspace_dir: Path) -> list[tuple[str, dict]]:
    """Workspace mode: scan workspace_dir/*/spec.md alphabetically."""
    parts = []
    for spec_file in sorted(workspace_dir.glob("*/spec.md")):
        ws_name = spec_file.parent.name
        code = ws_name.upper()[:8]
        raw = spec_file.read_text(encoding="utf-8")
        parts.append(("workspace", build_part(raw, code, "Workspace", ws_name.replace("-", " ").title())))
    return parts


def auto_discover(cwd: Path) -> tuple[str, list[tuple[str, dict]]]:
    """Detect mode and collect parts; returns (mode, parts)."""
    ws_dir = cwd / "claude-arsenal" / "project"
    if ws_dir.is_dir() and any(ws_dir.glob("*/spec.md")):
        return "workspace", collect_parts_workspace(ws_dir)
    single = cwd / "status" / "specification.md"
    if single.is_file():
        return "single", collect_parts_single(single)
    print(
        "✗ No spec found. Run from the repo root with a status/specification.md or "
        "claude-arsenal/project/*/spec.md present, or pass --input / --input-dir.",
        file=sys.stderr,
    )
    sys.exit(1)


def infer_title(cwd: Path) -> str:
    """Infer project title from git remote name or directory name."""
    try:
        import subprocess
        remote = subprocess.check_output(
            ["git", "remote", "get-url", "origin"], cwd=cwd, stderr=subprocess.DEVNULL, text=True
        ).strip()
        match = re.search(r"([^/:]+?)(?:\.[gG][iI][tT])?/?$", remote)
        name = match.group(1) if match else ""
        if name:
            return name.replace("-", " ").replace("_", " ").title()
    except Exception:
        pass
    return cwd.name.replace("-", " ").replace("_", " ").title()


# ---------------------------------------------------------------- HTML build

def esc(t: str) -> str:
    return (t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


def build_html(parts: list[tuple[str, dict]], title: str, gen_date: str, seed_notes: dict | None = None) -> str:
    seed_notes = seed_notes or {}
    total_sections = sum(len(p["items"]) for _, p in parts)
    ls_ns = slug(title) + "-spec-v1:"

    toc = ['<details class="toc" open><summary>Contents</summary>']
    for _kind, p in parts:
        head = esc(p["title"])
        if p["part_label"] != "Specification":
            head = f'{esc(p["part_label"])} — {head}'
        toc.append('<details class="toc-part">')
        toc.append(f'<summary>{head}</summary><ul>')
        for it in p["items"]:
            toc.append(f'<li><a href="#{it["domid"]}">{esc(it["toc"])}</a></li>')
        toc.append("</ul></details>")
    toc.append("</details>")
    toc_html = "\n".join(toc)

    body = []
    for kind, p in parts:
        part_head = esc(p["title"])
        if p["part_label"] != "Specification":
            part_head = f'{esc(p["part_label"])} — {part_head}'
        badge_cls = kind
        badge_label = p["part_label"]
        body.append('<section class="part">')
        body.append(
            f'<h2 class="part-title"><span class="badge {badge_cls}">{esc(badge_label)}</span>'
            f'{part_head}</h2>'
        )
        for it in p["items"]:
            tag = "h3" if it["level"] == 2 else "h4"
            body.append(f'<article class="sec" id="{it["domid"]}">')
            body.append(
                f'<{tag} class="sec-h"><span class="chip">{esc(it["chip"])}</span>'
                f'<span class="sec-title">{it["title_html"]}</span></{tag}>'
            )
            body.append(f'<div class="sec-body">{it["body_html"]}</div>')
            body.append(
                f'<div class="note" data-for="{it["domid"]}">'
                f'<div class="note-head"><span class="note-ico">✎</span>'
                f'<span class="note-label">Your note</span>'
                f'<span class="note-ref">{esc(it["key"])}</span></div>'
                f'<textarea class="note-ta" data-key="{esc(it["domid"])}" '
                f'data-label="{esc(it["label"])}" data-part="{part_head}" '
                f'rows="1" placeholder="Tap to add a note for this point…"></textarea>'
                f'</div>'
            )
            body.append("</article>")
        body.append("</section>")
    body_html = "\n".join(body)

    page = HTML_TEMPLATE
    page = page.replace("__TITLE__", esc(title))
    page = page.replace("__GEN_DATE__", gen_date)
    page = page.replace("__TOTAL__", str(total_sections))
    page = page.replace("__TOC__", toc_html)
    page = page.replace("__BODY__", body_html)
    page = page.replace("__CSS__", CSS)
    page = page.replace("__JS__", JS.replace("__LS_NS__", ls_ns))
    page = page.replace(
        "__SEED_NOTES__",
        json.dumps(seed_notes, ensure_ascii=False).replace("<", "\\u003c"),
    )
    return page


# ---------------------------------------------------------------- Markdown build

def build_markdown(parts: list[tuple[str, dict]], title: str, gen_date: str, seed_notes: dict | None = None) -> str:
    seed_notes = seed_notes or {}
    out = [f"# {title} — Specification (annotated edition)", ""]
    out.append(
        f"> Generated {gen_date}. This is the specification with a **note slot** after every "
        "section. Read it in any Markdown app. To annotate, replace the `_(your notes…)_` "
        "placeholder under any section. When done, send the file back — notes are acted on."
    )
    out += ["", "---", ""]
    for _, p in parts:
        title_line = f"# {p['part_label']} — {p['title']}" if p["part_label"] != "Specification" \
            else f"# {p['title']}"
        out.append(title_line)
        out.append("")
        for it in p["items"]:
            hashes = "##" if it["level"] == 2 else "###"
            out.append(f"{hashes} {it['label']}")
            out.append("")
            out.append(it["raw_body"])
            out.append("")
            out.append(f"> **✎ Notes** · `{it['key']}`")
            note_text = seed_notes.get(it["domid"], "").strip()
            if note_text:
                for line in note_text.split("\n"):
                    out.append(f"> {line}")
            else:
                out.append("> _(your notes here — replace this line)_")
            out.append("")
        out.append("")
    return "\n".join(out)


# ---------------------------------------------------------------- CSS / JS / HTML template

CSS = r"""
:root{
  --bg:#fbfaf7;--fg:#1d1c1a;--muted:#6b6862;--line:#e6e2da;
  --card:#ffffff;--accent:#0f766e;--accent2:#b45309;--chip:#eef2f1;
  --note:#fff8ec;--note-line:#f0cf94;--code:#f3f1ec;--link:#0f766e;
}
@media(prefers-color-scheme:dark){
  :root{
    --bg:#16151a;--fg:#e9e7e2;--muted:#a09c95;--line:#2e2c33;
    --card:#1e1d23;--accent:#5eead4;--accent2:#fbbf24;--chip:#26313055;
    --note:#251f10;--note-line:#6b531c;--code:#26242b;--link:#5eead4;
  }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;background:var(--bg);color:var(--fg);
  font:17px/1.62 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  padding-bottom:96px;
}
.wrap{max-width:760px;margin:0 auto;padding:0 16px}
a{color:var(--link)}
code{background:var(--code);padding:.08em .35em;border-radius:5px;font-size:.86em;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-word}
pre{background:var(--code);padding:12px;border-radius:8px;overflow:auto}
pre code{background:none;padding:0}
.topbar{position:sticky;top:0;z-index:30;background:var(--bg);
  border-bottom:1px solid var(--line);backdrop-filter:saturate(120%) blur(6px)}
.topbar .wrap{display:flex;align-items:center;gap:8px;padding-top:10px;padding-bottom:10px}
.brand{font-weight:700;font-size:16px;margin-right:auto;letter-spacing:.2px}
.brand small{font-weight:500;color:var(--muted);display:block;font-size:11px;letter-spacing:0}
.btn{appearance:none;border:1px solid var(--line);background:var(--card);color:var(--fg);
  border-radius:9px;padding:8px 11px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.btn:active{transform:translateY(1px)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
@media(prefers-color-scheme:dark){.btn.primary{color:#06201d}}
.count{font-size:12px;color:var(--muted);white-space:nowrap;font-weight:600}
.savestate{font-size:12px;font-weight:700;white-space:nowrap;transition:color .2s}
.savestate.ok{color:var(--accent)}
.savestate.warn{color:#b45309}
@media(prefers-color-scheme:dark){.savestate.warn{color:#fbbf24}}
.statusbar{border-bottom:1px solid var(--line);background:var(--card)}
.statusbar .wrap{padding:7px 16px;font-size:12px;color:var(--muted)}
#warnbar{display:none;background:#fff4e5;border-bottom:1px solid var(--note-line);color:#7c2d12}
#warnbar .wrap{padding:10px 16px;font-size:13px;line-height:1.45}
@media(prefers-color-scheme:dark){#warnbar{background:#3a2a0e;color:#fde68a;border-color:#6b531c}}
.hero{padding:22px 0 6px}
.hero h1{font-size:25px;line-height:1.2;margin:.1em 0 .3em}
.hero p{color:var(--muted);margin:.3em 0}
.help{border:1px solid var(--line);background:var(--card);border-radius:12px;padding:4px 14px;margin:14px 0}
.help summary{cursor:pointer;font-weight:600;padding:10px 0}
.help ul{margin:.2em 0 1em;padding-left:1.2em}
.help li{margin:.3em 0}
.toc{border:1px solid var(--line);background:var(--card);border-radius:12px;padding:4px 14px;margin:14px 0}
.toc>summary{cursor:pointer;font-weight:700;padding:11px 0;font-size:15px}
.toc-part{margin:2px 0;border-top:1px solid var(--line)}
.toc-part>summary{cursor:pointer;padding:9px 2px;font-weight:600;font-size:14px}
.toc-part ul{margin:.1em 0 .7em;padding-left:1.1em}
.toc-part li{margin:.22em 0;font-size:13.5px;line-height:1.4}
.toc-part a{text-decoration:none}
.toc-part a:hover{text-decoration:underline}
.part{margin:26px 0}
.part-title{font-size:21px;line-height:1.25;border-bottom:2px solid var(--accent);
  padding-bottom:8px;margin:18px 0 8px;position:sticky;top:54px;background:var(--bg);z-index:10}
.badge{display:inline-block;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;
  vertical-align:middle;padding:3px 7px;border-radius:6px;margin-right:8px}
.badge.spec{background:var(--chip);color:var(--accent)}
.badge.workspace{background:var(--chip);color:var(--accent2)}
.sec{padding:6px 0 2px;border-bottom:1px solid var(--line);scroll-margin-top:100px}
.sec:last-child{border-bottom:none}
.sec-h{margin:10px 0 6px;line-height:1.3;position:sticky;top:94px;background:var(--bg);z-index:5;padding-top:6px}
h3.sec-h{font-size:18.5px}
h4.sec-h{font-size:16.5px;color:var(--fg)}
.chip{display:inline-block;font-family:ui-monospace,Menlo,monospace;font-size:12px;font-weight:700;
  color:var(--accent);background:var(--chip);border-radius:6px;padding:2px 7px;margin-right:8px;vertical-align:middle}
.sec-title{vertical-align:middle}
.sec-body{margin:.2em 0 .4em}
.sec-body p{margin:.55em 0}
.sec-body ul,.sec-body ol{margin:.5em 0;padding-left:1.35em}
.sec-body li{margin:.3em 0}
.sec-body blockquote{margin:.7em 0;padding:.5em .9em;border-left:3px solid var(--accent2);
  background:var(--code);border-radius:0 8px 8px 0;color:var(--fg)}
.sec-body blockquote p{margin:.3em 0}
.sec-body table{border-collapse:collapse;width:100%;font-size:13.5px;margin:.6em 0;display:block;overflow-x:auto}
.sec-body th,.sec-body td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}
.sec-body th{background:var(--chip);font-weight:700}
.sec-body strong{font-weight:700}
.note{background:var(--note);border:1px solid var(--note-line);border-radius:10px;
  padding:8px 11px;margin:10px 0 16px}
.note-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.note-ico{color:var(--accent2);font-weight:800}
.note-label{font-size:12px;font-weight:700;color:var(--accent2);text-transform:uppercase;letter-spacing:.05em}
.note-ref{margin-left:auto;font-family:ui-monospace,Menlo,monospace;font-size:10.5px;color:var(--muted)}
.note-ta{width:100%;border:none;background:transparent;color:var(--fg);font:inherit;font-size:15.5px;
  resize:none;outline:none;line-height:1.5;padding:2px 0;overflow:hidden;min-height:1.6em}
.note-ta::placeholder{color:var(--muted);opacity:.8}
.note.filled{box-shadow:0 0 0 2px var(--note-line) inset}
.fab{position:fixed;right:14px;bottom:16px;z-index:40;display:flex;flex-direction:column;gap:8px;align-items:flex-end}
.fab .btn{box-shadow:0 4px 14px #0003}
.modal{position:fixed;inset:0;z-index:60;background:#0008;display:none;align-items:center;justify-content:center;padding:16px}
.modal.open{display:flex}
.modal-card{background:var(--card);border:1px solid var(--line);border-radius:14px;max-width:680px;width:100%;
  max-height:86vh;display:flex;flex-direction:column;padding:16px}
.modal-card h3{margin:.1em 0 .5em}
.modal-card p{color:var(--muted);font-size:13.5px;margin:.2em 0 .6em}
.modal-card textarea{width:100%;flex:1;min-height:220px;border:1px solid var(--line);border-radius:8px;
  background:var(--bg);color:var(--fg);font:13px/1.5 ui-monospace,Menlo,monospace;padding:10px;resize:vertical}
.modal-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.hidden-input{display:none}
.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:70;background:#111;color:#fff;
  padding:9px 14px;border-radius:9px;font-size:13px;opacity:0;transition:opacity .25s;pointer-events:none}
.toast.show{opacity:.96}
"""

JS = r"""
(function(){
  var NS = '__LS_NS__';
  var tas = Array.prototype.slice.call(document.querySelectorAll('.note-ta'));

  function autoGrow(t){t.style.height='auto';t.style.height=(t.scrollHeight)+'px';}
  function setFilled(t){var box=t.closest('.note');if(box){box.classList.toggle('filled',t.value.trim()!=='');}}
  function updateCount(){
    var n=0;tas.forEach(function(t){if(t.value.trim()!=='')n++;});
    var el=document.getElementById('count');if(el){el.textContent=n+' / '+tas.length+' notes';}
    return n;
  }
  var lsOK=true,dirty=false;
  try{localStorage.setItem('__vs__','1');localStorage.removeItem('__vs__');}catch(e){lsOK=false;}
  var WARN='⚠ Not saving — tap Save / Export';
  function nowStamp(){var d=new Date();return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());}
  function setState(txt,cls){var el=document.getElementById('savestate');if(el){el.textContent=txt;el.className='savestate '+(cls||'');}}
  window.addEventListener('beforeunload',function(e){if(!lsOK&&dirty){e.preventDefault();e.returnValue='';}});

  var saveTimers={};
  function save(t){
    if(!lsOK){dirty=true;setState(WARN,'warn');return;}
    var k=NS+t.dataset.key;
    try{
      if(t.value.trim()===''){localStorage.removeItem(k);}else{localStorage.setItem(k,t.value);}
      dirty=true;setState('✓ Saved '+nowStamp(),'ok');
    }catch(e){lsOK=false;document.getElementById('warnbar').style.display='block';setState(WARN,'warn');}
  }
  var SEED=(typeof SPEC_SEED_NOTES!=='undefined')?SPEC_SEED_NOTES:{};
  tas.forEach(function(t){
    try{var v=localStorage.getItem(NS+t.dataset.key);
        if(v!=null){t.value=v;}else if(Object.prototype.hasOwnProperty.call(SEED,t.dataset.key)){t.value=SEED[t.dataset.key];}}catch(e){}
    autoGrow(t);setFilled(t);
    t.addEventListener('input',function(){
      autoGrow(t);setFilled(t);updateCount();
      clearTimeout(saveTimers[t.dataset.key]);
      saveTimers[t.dataset.key]=setTimeout(function(){save(t);},350);
    });
    t.addEventListener('blur',function(){save(t);});
  });
  updateCount();
  if(lsOK){setState('✓ Auto-saving','ok');}else{document.getElementById('warnbar').style.display='block';setState(WARN,'warn');}

  function toast(msg){var el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');setTimeout(function(){el.classList.remove('show');},1900);}
  function pad(n){return n<10?'0'+n:''+n;}
  function today(){var d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}

  function buildExport(){
    var byPart={},order=[],data={},n=0;
    tas.forEach(function(t){
      var v=t.value.trim();if(v==='')return;n++;
      data[t.dataset.key]=t.value;
      var part=t.dataset.part||'Other';
      if(!byPart[part]){byPart[part]=[];order.push(part);}
      byPart[part].push({label:t.dataset.label,ref:keyFromDom(t.dataset.key,t),note:t.value});
    });
    var lines=['# Specification notes','','_Exported '+today()+' · '+n+' note'+(n===1?'':'s')+'._','',
      '> Send this file back to continue the review. Notes are embedded as data at the bottom','> so importing this file restores them in the reader.',''];
    order.forEach(function(part){
      lines.push('## '+part,'');
      byPart[part].forEach(function(it){
        lines.push('**'+it.label+'**  `'+it.ref+'`');
        it.note.split('\n').forEach(function(ln){lines.push('> '+ln);});
        lines.push('');
      });
    });
    lines.push('<!-- SPEC-NOTES-DATA');
    lines.push(JSON.stringify(data));
    lines.push('-->');
    return{text:lines.join('\n'),n:n};
  }
  function keyFromDom(domkey,t){var box=t.closest('.note');var r=box?box.querySelector('.note-ref'):null;return r?r.textContent:domkey;}

  function download(name,text){
    try{var blob=new Blob([text],{type:'text/markdown'});var url=URL.createObjectURL(blob);
        var a=document.createElement('a');a.href=url;a.download=name;
        document.body.appendChild(a);a.click();
        setTimeout(function(){URL.revokeObjectURL(url);a.remove();},1500);return true;}catch(e){return false;}
  }

  var modal=document.getElementById('modal');
  var modalTa=document.getElementById('modal-ta');
  function openModal(text){modalTa.value=text;modal.classList.add('open');}
  function closeModal(){modal.classList.remove('open');}

  document.getElementById('btn-export').addEventListener('click',function(){
    var r=buildExport();
    if(r.n===0){toast('No notes yet — add some first.');return;}
    var name='spec-notes-'+today()+'.md';
    download(name,r.text);openModal(r.text);
    if(navigator.clipboard){navigator.clipboard.writeText(r.text).then(function(){},function(){});}
    dirty=false;setState('✓ Backup saved '+nowStamp(),'ok');
    toast('Exported '+r.n+' note'+(r.n===1?'':'s'));
  });
  document.getElementById('btn-export2').addEventListener('click',function(){document.getElementById('btn-export').click();});

  document.getElementById('modal-copy').addEventListener('click',function(){
    modalTa.select();var ok=false;try{ok=document.execCommand('copy');}catch(e){}
    if(navigator.clipboard){navigator.clipboard.writeText(modalTa.value).then(function(){},function(){});ok=true;}
    toast(ok?'Copied to clipboard':'Select the text and copy');
  });
  document.getElementById('modal-dl').addEventListener('click',function(){download('spec-notes-'+today()+'.md',modalTa.value);toast('Download started');});
  document.getElementById('modal-close').addEventListener('click',closeModal);
  modal.addEventListener('click',function(e){if(e.target===modal)closeModal();});

  function applyData(obj){
    var applied=0;
    tas.forEach(function(t){
      if(Object.prototype.hasOwnProperty.call(obj,t.dataset.key)){t.value=obj[t.dataset.key];save(t);autoGrow(t);setFilled(t);applied++;}
    });
    updateCount();return applied;
  }
  document.getElementById('file-import').addEventListener('change',function(e){
    var f=e.target.files[0];if(!f)return;
    var rd=new FileReader();
    rd.onload=function(){
      var txt=String(rd.result||'');var obj=null;
      var m=txt.lastIndexOf('SPEC-NOTES-DATA');
      try{
        if(m>=0){var after=txt.slice(m+15);var jstart=after.indexOf('{');var jend=after.lastIndexOf('}');
                  if(jstart>=0&&jend>jstart){obj=JSON.parse(after.slice(jstart,jend+1));}}
        else{obj=JSON.parse(txt);}
      }catch(err){obj=null;}
      if(!obj){toast('Could not read notes from that file');return;}
      var k=applyData(obj);toast('Imported '+k+' note'+(k===1?'':'s'));
    };
    rd.readAsText(f);e.target.value='';
  });
  document.getElementById('btn-import').addEventListener('click',function(){document.getElementById('file-import').click();});

  document.getElementById('btn-clear').addEventListener('click',function(){
    if(!confirm('Clear ALL notes from this browser? Export first if you want to keep them.'))return;
    tas.forEach(function(t){t.value='';save(t);autoGrow(t);setFilled(t);});
    updateCount();toast('All notes cleared');
  });

  document.getElementById('btn-top').addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});});
})();
"""

HTML_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>__TITLE__ — Specification (annotatable)</title>
<style>__CSS__</style>
</head>
<body>
<div class="topbar">
  <div class="wrap">
    <div class="brand">__TITLE__ — Specification<small>annotatable reader · __GEN_DATE__</small></div>
    <span class="savestate ok" id="savestate">✓ Auto-saving</span>
    <button class="btn primary" id="btn-export">Save / Export</button>
  </div>
</div>
<div class="statusbar"><div class="wrap"><span class="count" id="count">0 / __TOTAL__ notes</span><span class="hint"> · notes save automatically; <strong>Save / Export</strong> keeps a file you can send back</span></div></div>
<div id="warnbar"><div class="wrap"><strong>Heads up —</strong> this browser isn't storing your notes automatically (private/incognito mode or restricted file view). Tap <strong>Save / Export</strong> regularly.</div></div>

<div class="wrap">
  <div class="hero">
    <h1>__TITLE__ specification</h1>
    <p>Read at your own pace and leave a note on any point you want to discuss.</p>
  </div>
  <details class="help">
    <summary>How to annotate (tap)</summary>
    <ul>
      <li>Tap the note field under any section and type. Each note is tagged so your feedback maps to an exact point.</li>
      <li><strong>Notes save automatically</strong> in this browser as you type.</li>
      <li><strong>Save / Export</strong> downloads a Markdown file of your notes — the copy to send back. Tap whenever you pause, especially on a phone.</li>
      <li><strong>Import</strong> reloads notes from a file you exported earlier (after clearing the browser or switching devices).</li>
      <li><strong>Clear</strong> erases every note in this browser. Export first.</li>
    </ul>
  </details>
  __TOC__
  __BODY__
</div>

<div class="fab">
  <button class="btn" id="btn-top" title="Back to top">↑ Top</button>
  <button class="btn" id="btn-import">Import</button>
  <button class="btn" id="btn-clear">Clear</button>
  <button class="btn primary" id="btn-export2">💾 Save / Export</button>
</div>
<input type="file" id="file-import" class="hidden-input" accept=".md,.markdown,.json,text/markdown,application/json">

<div class="modal" id="modal">
  <div class="modal-card">
    <h3>Your notes</h3>
    <p>Downloaded as a Markdown file. You can also copy the text below and paste it back.</p>
    <textarea id="modal-ta" readonly></textarea>
    <div class="modal-actions">
      <button class="btn primary" id="modal-copy">Copy</button>
      <button class="btn" id="modal-dl">Download again</button>
      <button class="btn" id="modal-close">Close</button>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>var SPEC_SEED_NOTES=__SEED_NOTES__;</script>
<script>__JS__</script>
</body>
</html>
"""


# ---------------------------------------------------------------- Entry point

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", metavar="FILE", help="single specification Markdown file")
    parser.add_argument("--input-dir", metavar="DIR", help="directory containing workspace subdirs with spec.md")
    parser.add_argument("--output-dir", metavar="DIR", help="where to write spec-reader.html and spec-annotated.md")
    parser.add_argument("--name", metavar="TEXT", help="project name for the reader title (default: git repo name)")
    args = parser.parse_args()

    cwd = Path.cwd()

    if args.input:
        spec_path = Path(args.input)
        if not spec_path.is_file():
            print(f"✗ {spec_path} not found", file=sys.stderr)
            return 2
        parts = collect_parts_single(spec_path)
        default_out = spec_path.parent
    elif args.input_dir:
        ws_dir = Path(args.input_dir)
        if not ws_dir.is_dir():
            print(f"✗ {ws_dir} is not a directory", file=sys.stderr)
            return 2
        parts = collect_parts_workspace(ws_dir)
        if not parts:
            print(f"✗ no workspace spec.md files found under {ws_dir}", file=sys.stderr)
            return 1
        default_out = cwd / "docs" / "spec-reader"
    else:
        mode, parts = auto_discover(cwd)
        default_out = (cwd / "docs" / "spec-reader") if mode == "workspace" else (cwd / "status")

    out_dir = Path(args.output_dir) if args.output_dir else default_out
    out_dir.mkdir(parents=True, exist_ok=True)

    title = args.name or infer_title(cwd)
    gen_date = date.today().isoformat()

    notes_path = out_dir / "notes.json"
    seed_notes: dict = {}
    if notes_path.exists():
        try:
            loaded = json.loads(notes_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                seed_notes = loaded
                print(f"ℹ  seeding from {notes_path} ({len(seed_notes)} notes)", file=sys.stderr)
            else:
                print(f"⚠  {notes_path} does not contain a JSON object", file=sys.stderr)
        except Exception as exc:
            print(f"⚠  could not read {notes_path}: {exc}", file=sys.stderr)

    html_out = build_html(parts, title, gen_date, seed_notes)
    md_out = build_markdown(parts, title, gen_date, seed_notes)

    html_file = out_dir / "spec-reader.html"
    md_file = out_dir / "spec-annotated.md"
    html_file.write_text(html_out, encoding="utf-8")
    md_file.write_text(md_out, encoding="utf-8")

    n_parts = len(parts)
    n_secs = sum(len(p["items"]) for _, p in parts)
    print(f"✓ {n_parts} part(s), {n_secs} annotatable section(s)", file=sys.stderr)
    print(f"  {html_file}", file=sys.stderr)
    print(f"  {md_file}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
