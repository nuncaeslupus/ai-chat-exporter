#!/usr/bin/env python3
"""digest.py — one short page of what was done, for a human to decide on.

Every PR carries its own record: a machine block in its body,

    <!-- arsenal-digest
    {"v":1, "pr":42, "head":"1a2b3c4", "tier":"high", "mark":"amber", "state":..., ...}
    -->

written by `record` when the PR opens and rewritten on every new head, merge or
decision. The PR body is the store because any session that can see the PR can
read and rewrite it, it needs no second ref to push, and a closed PR still holds
it. `render` turns the records of the open PRs, and of those merged or closed
since the last digest, into one page: a folded card per PR, red first, each with
Approve / Deny / Question. The page exports a decisions file that
apply_decisions.py acts on.

Usage:
    digest.py record --pr N --notes FILE [--pr-json FILE] [--files-json FILE]
    digest.py check  (--pr N | --record FILE)
    digest.py render [--since last|YYYY-MM-DD] [--format html|md] [--out DIR] [--prs-json FILE]
                     [--audit LEDGER]

`--notes` is what only the worker knows, as JSON:
    {"summary": "2-3 sentences, <= 60 words", "undo": "...", "expected_lines": 120,
     "fixes": [{"what": "...", "found_by": "cold-reviewer", "fix": "...", "commit": "abc1234"}],
     "open": ["RISK: ..."], "state": "needs-decision"}   # state optional
Review rounds are counted from the adversarial review's round files.

`--pr-json` / `--files-json` / `--prs-json` stand in for the GitHub fetch on a
surface with no scriptable channel (github_channel.sh exit 5): fetch with your
GitHub tools, save, and pass the files. `record` then prints the new body instead
of writing it. Config: digest-delivery, digest-every (arsenal/config.toml).
Exit: 0 ok, 1 check failed, 2 bad input, 5 no channel (the call to make is printed).
"""

from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import arsenal_config
import review_policy

CHANNEL = Path(__file__).resolve().parent.parent / "bin" / "github_channel.sh"
BLOCK_RX = re.compile(r"<!--\s*arsenal-digest\s*(\{.*?\})\s*-->", re.DOTALL)
STATE_FILE = Path("arsenal/session/digest.json")
MAX_WORDS, MAX_SENTENCES = 60, 3
FINDING_SOURCES = ("self", "cold-reviewer", "ci", "human")  # plus bot:<login>
MARK_ORDER = {"red": 0, "amber": 1, "green": 2}
STATE_ORDER = {
    "needs-decision": 0,
    "awaiting-approval": 1,
    "merged-awaiting-ratification": 2,
    "blocked-by-dep": 3,
    "open": 4,
    "merged": 5,
    "closed": 6,
}


class DigestError(Exception):
    pass


class NoChannel(Exception):
    pass


# --- GitHub ----------------------------------------------------------------------
def _api(method: str, path: str, body: dict[str, Any] | None = None) -> Any:
    cmd = ["bash", str(CHANNEL), "--api", method, path]
    if body is not None:
        cmd.append(json.dumps(body))
    res = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if res.returncode == 5:
        raise NoChannel(f"{method} {path}")
    if res.returncode != 0:
        raise DigestError(f"{method} {path} failed: {res.stderr.strip() or res.stdout[:200]}")
    return json.loads(res.stdout) if res.stdout.strip() else None


def _slug() -> str:
    res = subprocess.run(
        ["bash", str(CHANNEL), "--slug"], capture_output=True, text=True, check=False
    )
    if res.returncode != 0:
        raise DigestError("cannot tell owner/repo from the git remote")
    return res.stdout.strip()


def _load_json(path: str) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise DigestError(f"{path}: {exc}") from exc


# --- the record ------------------------------------------------------------------
def read_block(body: str | None) -> dict[str, Any] | None:
    m = BLOCK_RX.search(body or "")
    if not m:
        return None
    try:
        rec = json.loads(m.group(1))
    except ValueError:
        return None
    return rec if isinstance(rec, dict) else None


def write_block(body: str | None, record: dict[str, Any]) -> str:
    """The body with its digest block replaced (or appended); other text untouched."""
    # `<`, `>` and `--` escaped inside the JSON, so no value can close the HTML
    # comment early (spilling the rest into the PR body) or cut the record short.
    raw = json.dumps(record, ensure_ascii=False)
    raw = raw.replace("<", "\\u003c").replace(">", "\\u003e").replace("--", "-\\u002d")
    block = "<!-- arsenal-digest\n" + raw + "\n-->"
    body = body or ""
    if BLOCK_RX.search(body):
        return BLOCK_RX.sub(lambda _: block, body, count=1)
    return (body.rstrip() + "\n\n" if body.strip() else "") + block + "\n"


def oversize(size: dict[str, Any]) -> float:
    """How many times its own estimate a PR grew, when over 2x; else 0 (or no estimate)."""
    expected = int(size.get("expected") or 0)
    ratio = (int(size.get("add", 0)) + int(size.get("del", 0))) / expected if expected else 0
    return round(ratio, 1) if ratio > 2 else 0


def mark(tier: str, state: str, open_items: list[str], over: float = 0) -> str:
    """red: high with something open, or a decision only a human can make;
    amber: high, medium with something open, or over twice its size estimate;
    green otherwise."""
    if state == "needs-decision" or (tier == "high" and open_items):
        return "red"
    if tier == "high" or (tier == "medium" and open_items) or over:
        return "amber"
    return "green"


def size_problems(summary: str) -> list[str]:
    words = len(summary.split())
    sentences = len([s for s in re.split(r"(?<=[.!?])\s+", summary.strip()) if s])
    out = []
    if not summary.strip():
        out.append("summary is empty")
    if words > MAX_WORDS:
        out.append(f"summary is {words} words (max {MAX_WORDS})")
    if sentences > MAX_SENTENCES:
        out.append(f"summary is {sentences} sentences (max {MAX_SENTENCES})")
    return out


def count_rounds(root: Path = Path("tmp/arsenal-review")) -> int:
    """Review rounds of the newest round directory the adversarial review left."""
    dirs = sorted(root.glob("**/rounds"), key=lambda p: p.stat().st_mtime) if root.is_dir() else []
    return len(list(dirs[-1].glob("round-*.md"))) if dirs else 0


def _state(pr: dict[str, Any], req: dict[str, Any], rec: dict[str, Any], notes: dict) -> str:
    if pr.get("merged") or pr.get("merged_at"):
        return (
            "merged-awaiting-ratification"
            if req["ratify"] and not rec.get("ratified")
            else "merged"
        )
    if pr.get("state") == "closed":
        return "closed"
    if notes.get("state") in ("needs-decision", "blocked-by-dep"):
        return str(notes["state"])
    return "awaiting-approval" if req["humans"] else "open"


def build_record(
    pr: dict[str, Any],
    files: list[dict[str, Any]],
    notes: dict[str, Any],
    cfg: dict[str, Any],
    rounds: int,
) -> dict[str, Any]:
    old = read_block(pr.get("body")) or {}
    cls = review_policy.classify(files, cfg)
    req = review_policy.requirement(cls["tier"], cfg, bool(cls["human_paths"]))
    fixes = []
    for f in notes.get("fixes", []):
        if not isinstance(f, dict):
            raise DigestError("--notes fixes must be objects {what, found_by, fix, commit}")
        src = str(f.get("found_by") or "cold-reviewer")
        if src not in FINDING_SOURCES and not src.startswith("bot:"):
            raise DigestError(
                f"found_by {src!r}: use self, cold-reviewer, ci, human or bot:<login>"
            )
        fixes.append({k: str(f.get(k, "")) for k in ("what", "fix", "commit")} | {"found_by": src})
    open_items = [str(x) for x in notes.get("open", [])]
    expected = notes.get("expected_lines", old.get("size", {}).get("expected", 0)) or 0
    if type(expected) is not int or expected < 0:
        raise DigestError(f"expected_lines must be a whole number >= 0, got {expected!r}")
    rec = {
        "v": 1,
        "pr": pr.get("number"),
        "head": str((pr.get("head") or {}).get("sha") or ""),
        "tier": cls["tier"],
        "tier_reasons": cls["reasons"],
        "summary": str(notes.get("summary", old.get("summary", ""))).strip(),
        "deps": [int(d) for d in notes.get("deps", old.get("deps", []))],
        "size": {
            "add": sum(int(f.get("additions", 0)) for f in files),
            "del": sum(int(f.get("deletions", 0)) for f in files),
            "files": len(files),
            "expected": expected,
        },
        "rounds": rounds or int(old.get("rounds", 0)),
        "findings": fixes or old.get("findings", []),
        "open": open_items,
        "undo": str(notes.get("undo", old.get("undo", ""))),
        "questions": old.get("questions", []),
        "ratified": old.get("ratified"),
    }
    rec["state"] = _state(pr, req, rec, notes)
    rec["mark"] = mark(rec["tier"], rec["state"], open_items, oversize(rec["size"]))
    return rec


# --- render ----------------------------------------------------------------------
def _since(arg: str) -> str:
    if arg == "last":
        try:
            return str(json.loads(STATE_FILE.read_text(encoding="utf-8"))["rendered_at"])
        except (OSError, ValueError, KeyError):
            return "1970-01-01T00:00:00Z"
    return arg if "T" in arg else arg + "T00:00:00Z"


def collect(prs: list[dict[str, Any]], since: str) -> list[dict[str, Any]]:
    """Records of open PRs and of PRs closed after `since`, sorted for reading."""
    out = []
    for pr in prs:
        rec = read_block(pr.get("body"))
        if rec is None:
            continue
        if pr.get("state") == "closed" and str(pr.get("closed_at") or "") < since:
            continue
        # The PR number comes from GitHub, never from the body: anyone who can edit
        # a PR's body could otherwise make its card approve another PR. The head
        # stays the RECORD's — the commit that was reviewed and summarised — so a
        # push after `record` makes the approval stale instead of approving it.
        if rec.get("pr") != pr.get("number"):
            continue
        rec = rec | {
            "pr": int(pr["number"]),
            "head": str(rec.get("head", "")),
            "title": pr.get("title", ""),
            "url": pr.get("html_url", ""),
        }
        out.append(rec)
    out.sort(
        key=lambda r: (
            MARK_ORDER.get(r.get("mark", "green"), 3),
            STATE_ORDER.get(r.get("state", "open"), 9),
            r.get("pr") or 0,
        )
    )
    return out


def _counts(recs: list[dict[str, Any]]) -> str:
    by: dict[str, int] = {}
    for r in recs:
        by[r.get("state", "?")] = by.get(r.get("state", "?"), 0) + 1
    return " · ".join(
        f"{n} {s}" for s, n in sorted(by.items(), key=lambda x: STATE_ORDER.get(x[0], 9))
    )


def _status(r: dict[str, Any]) -> str:
    deps = f" · after #{', #'.join(map(str, r['deps']))}" if r.get("deps") else ""
    sz = r.get("size", {})
    return (
        f"{r.get('tier', '?')} risk · {r.get('state', '?')}"
        f" · +{sz.get('add', 0)}/-{sz.get('del', 0)}"
        f" · {r.get('rounds', 0)} review round(s){deps}"
        + (f" · ⚠ {oversize(sz)}x expected size" if oversize(sz) else "")
    )


def _detail_lines(r: dict[str, Any]) -> list[str]:
    lines = [f"Why {r.get('tier')}: {'; '.join(r.get('tier_reasons', []))}"]
    for f in r.get("findings", []):
        lines.append(f"Fixed: {f['what']} — found by {f['found_by']}; {f['fix']} ({f['commit']})")
    lines += [f"Open: {o}" for o in r.get("open", [])]
    lines += [f"Question: {q}" for q in r.get("questions", [])]
    if r.get("undo"):
        lines.append(f"Undo: {r['undo']}")
    lines.append(f"Head: {str(r.get('head', ''))[:7]}")
    return lines


def load_audit(path: str) -> dict[str, Any]:
    """A repo-audit ledger: a bare findings list, or {"findings": [...], "not_covered": [...]}."""
    raw = _load_json(path)
    if isinstance(raw, list):
        raw = {"findings": raw}
    if not isinstance(raw, dict) or not isinstance(raw.get("findings"), list):
        raise DigestError(f"{path}: expected a findings list or {{findings, not_covered}}")
    return {"findings": raw["findings"], "not_covered": list(raw.get("not_covered") or [])}


def audit_lines(audit: dict[str, Any]) -> list[str]:
    """The audit card's content: counts, the top high-severity findings, queued, not covered."""
    rows = [f for f in audit["findings"] if isinstance(f, dict)]
    by: dict[str, int] = {}
    for f in rows:
        k = f"{f.get('severity', '?')}/{f.get('confidence', '?')}"
        by[k] = by.get(k, 0) + 1
    out = [
        f"{len(rows)} finding(s): "
        + (" · ".join(f"{k} {n}" for k, n in sorted(by.items())) or "none"),
        f"Queued as tasks: {sum(1 for f in rows if f.get('status') == 'queued')}",
    ]
    high = [f for f in rows if f.get("severity") == "high"][:5]
    out += [f"High: {f.get('finding', '')} ({f.get('where', '')})" for f in high]
    if audit["not_covered"]:
        out.append("Not covered: " + ", ".join(map(str, audit["not_covered"])))
    return out


def render_md(
    recs: list[dict[str, Any]], stamp: str, metrics: str = "", audit: dict[str, Any] | None = None
) -> str:
    icon = {"red": "🔴", "amber": "🟠", "green": "🟢"}
    out = [f"# Review digest — {stamp}", "", _counts(recs) or "nothing to review", ""]
    if metrics:
        out += [f"_{metrics}_", ""]
    if audit is not None:
        out += ["### 🔎 Repo audit", "", *[f"- {ln}" for ln in audit_lines(audit)], ""]
    for r in recs:
        out += [
            f"### {icon.get(r.get('mark', ''), '')} #{r.get('pr')} {r.get('title', '')}",
            f"_{_status(r)}_",
            "",
            r.get("summary", ""),
            "",
            "<details><summary>Details</summary>",
            "",
            *[f"- {ln}" for ln in _detail_lines(r)],
            "",
            "</details>",
            "",
        ]
    out.append("Reply with one line per PR: `approve 42`, `deny 43: reason`, `question 44: ...`.")
    return "\n".join(out)


CARD_CSS = r"""
.dg-head{color:var(--muted);margin:.2em 0 1em}
.card.audit{border-left-color:#2563eb}
.card{border:1px solid var(--line);border-left:6px solid var(--line);border-radius:12px;
  background:var(--card);padding:12px 16px;margin:14px 0;max-width:var(--measure)}
.card.red{border-left-color:#dc2626}.card.amber{border-left-color:#d97706}.card.green{border-left-color:#16a34a}
.card h3{margin:.1em 0;font-size:1.05rem}.card .st{color:var(--muted);font-size:13px}
.card p{margin:.5em 0}.card details{margin:.4em 0;font-size:14px}.card details li{margin:.2em 0}
.dec{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:.5em;font-size:14px}
.dec textarea{flex:1 1 100%;min-height:2.2em;border:1px dashed var(--line);border-radius:8px;
  background:transparent;color:var(--fg);font:inherit;padding:4px 8px}
"""

CARD_JS = r"""
(function(){
  var NS='__NS__';
  function key(pr,f){return NS+pr+':'+f;}
  function store(k,v){try{localStorage.setItem(k,v);}catch(e){}}
  function load(k){try{return localStorage.getItem(k);}catch(e){return null;}}
  document.querySelectorAll('.card').forEach(function(c){
    var pr=c.dataset.pr;
    c.querySelectorAll('input[type=radio]').forEach(function(r){
      if(load(key(pr,'d'))===r.value)r.checked=true;
      r.addEventListener('change',function(){store(key(pr,'d'),r.value);});
    });
    var t=c.querySelector('textarea');var v=load(key(pr,'n'));if(v)t.value=v;
    t.addEventListener('input',function(){store(key(pr,'n'),t.value);});
  });
  document.getElementById('dg-export').addEventListener('click',function(){
    var data={},lines=['# Review decisions — __STAMP__',''];
    document.querySelectorAll('.card').forEach(function(c){
      var r=c.querySelector('input[type=radio]:checked');if(!r)return;
      var n=c.querySelector('textarea').value.trim();
      data[c.dataset.pr]={decision:r.value,head:c.dataset.head,note:n};
      lines.push('- #'+c.dataset.pr+' '+r.value+(n?': '+n:''));
    });
    if(!Object.keys(data).length){alert('No decisions yet.');return;}
    lines.push('','<!-- ARSENAL-DECISIONS '+JSON.stringify(data)+' -->');
    var text=lines.join('\n');
    try{var a=document.createElement('a');
        a.href=URL.createObjectURL(new Blob([text],{type:'text/markdown'}));
        a.download='__EXPORT__';document.body.appendChild(a);a.click();a.remove();}catch(e){}
    try{navigator.clipboard.writeText(text).catch(function(){});}catch(e){}
    var ta=document.getElementById('dg-out');ta.value=text;ta.style.display='block';
  });
})();
"""


def reader_css() -> str:
    """The annotatable reader's stylesheet, so the digest looks like the documents.

    Read from create_reader.py's source rather than imported: that module exits
    at import when the `markdown` package is missing, which the digest never needs.
    """
    src = (Path(__file__).resolve().parent / "create_reader.py").read_text(encoding="utf-8")
    m = re.search(r'^CSS = r"""\n(.*?)\n"""', src, re.DOTALL | re.MULTILINE)
    return m.group(1) if m else ""


def render_html(
    recs: list[dict[str, Any]],
    stamp: str,
    repo: str,
    metrics: str = "",
    audit: dict[str, Any] | None = None,
) -> str:
    e = html.escape
    cards = []
    for r in recs:
        pr = r.get("pr")
        decide = "".join(
            f'<label><input type="radio" name="d{pr}" value="{v}"> {v.title()}</label>'
            for v in ("approve", "deny", "question")
        )
        detail = "".join(f"<li>{e(ln)}</li>" for ln in _detail_lines(r))
        link = f' <a href="{e(r["url"])}">↗</a>' if r.get("url") else ""
        cards.append(
            f'<article class="card {e(r.get("mark", ""))}" data-pr="{pr}" '
            f'data-head="{e(str(r.get("head", "")))}">'
            f"<h3>#{pr} {e(r.get('title', ''))}{link}</h3>"
            f'<div class="st">{e(_status(r))}</div><p>{e(r.get("summary", ""))}</p>'
            f"<details><summary>Details</summary><ul>{detail}</ul></details>"
            f'<div class="dec">{decide}<textarea placeholder="Note (optional)"></textarea></div>'
            "</article>"
        )
    export = f"{repo}-digest-{stamp.replace(':', '').replace(' ', '-')}-decisions.md"
    js = (
        CARD_JS.replace("__NS__", f"{repo}-digest-{stamp}:")
        .replace("__STAMP__", stamp)
        .replace("__EXPORT__", export)
    )
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{e(repo)} — review digest</title>"
        f"<style>{reader_css()}{CARD_CSS}</style></head>"
        f'<body><div class="wrap"><div class="hero"><h1>Review digest</h1>'
        f'<p class="dg-head">{e(stamp)} · {e(_counts(recs) or "nothing to review")}</p>'
        + (f'<p class="dg-head">{e(metrics)}</p>' if metrics else "")
        + "</div>"
        + (
            '<section class="card audit"><h3>Repo audit</h3><ul>'
            + "".join(f"<li>{e(ln)}</li>" for ln in audit_lines(audit))
            + "</ul></section>"
            if audit is not None
            else ""
        )
        + "".join(cards)
        + '<p><button class="btn primary" id="dg-export">Export decisions</button></p>'
        '<textarea id="dg-out" style="display:none;width:100%;min-height:8em" readonly></textarea>'
        f"</div><script>{js}</script></body></html>"
    )


def visible_words(page: str) -> int:
    """Words a reader sees with every card folded: no scripts, styles or details."""
    text = re.sub(r"<(script|style)\b.*?</\1>", " ", page, flags=re.DOTALL)
    text = re.sub(r"<details>.*?</details>", " ", text, flags=re.DOTALL)
    text = re.sub(r"<textarea\b.*?</textarea>", " ", text, flags=re.DOTALL)
    return len(html.unescape(re.sub(r"<[^>]+>", " ", text)).split())


# --- commands --------------------------------------------------------------------
def cmd_record(args: argparse.Namespace, cfg: dict[str, Any]) -> int:
    notes = _load_json(args.notes)
    if not isinstance(notes, dict):
        raise DigestError("--notes must hold a JSON object")
    slug = None if args.pr_json else _slug()
    pr = _load_json(args.pr_json) if args.pr_json else _api("GET", f"/repos/{slug}/pulls/{args.pr}")
    if args.files_json:
        files = _load_json(args.files_json)
    elif slug:
        files = _api("GET", f"/repos/{slug}/pulls/{args.pr}/files?per_page=100")
    else:
        raise DigestError("--pr-json needs --files-json as well")
    rec = build_record(pr, files, notes, cfg, count_rounds())
    problems = size_problems(rec["summary"])
    if problems:
        print("digest: " + "; ".join(problems), file=sys.stderr)
        return 1
    body = write_block(pr.get("body"), rec)
    if slug is None:
        print(body)
        print(
            f"\ndigest: PATCH /repos/<owner>/<repo>/pulls/{args.pr} with this body", file=sys.stderr
        )
        return 5
    _api("PATCH", f"/repos/{slug}/pulls/{args.pr}", {"body": body})
    print(f"digest: #{args.pr} {rec['mark']} {rec['tier']} {rec['state']}")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    if args.record:
        rec = _load_json(args.record)
    else:
        rec = read_block(_api("GET", f"/repos/{_slug()}/pulls/{args.pr}").get("body"))
    if not isinstance(rec, dict):
        raise DigestError("no digest record found")
    problems = size_problems(str(rec.get("summary", "")))
    print("\n".join(problems) or "digest: ok")
    return 1 if problems else 0


def cmd_render(args: argparse.Namespace, cfg: dict[str, Any]) -> int:
    since = _since(args.since)
    if args.prs_json:
        prs = _load_json(args.prs_json)
        repo = "repo"
    else:
        slug = _slug()
        repo = slug.split("/")[-1]
        prs = _api("GET", f"/repos/{slug}/pulls?state=all&sort=updated&direction=desc&per_page=100")
    recs = collect(prs if isinstance(prs, list) else [], since)
    import review_metrics  # lazily: it imports this module

    metrics = review_metrics.summary(30)
    audit = load_audit(args.audit) if args.audit else None
    now = datetime.now(UTC)
    stamp = now.strftime("%Y-%m-%d %H:%M")
    # An explicit --format wins; otherwise digest-delivery decides.
    fmt = args.format or {"chat": "md", "file": "html", "both": "both"}[cfg["digest-delivery"]]
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    if fmt in ("md", "both"):
        print(render_md(recs, stamp, metrics, audit))
    if fmt in ("html", "both"):
        page = out_dir / f"{repo}-digest-{now.strftime('%Y-%m-%d-%H%M')}.html"
        page.write_text(render_html(recs, stamp, repo, metrics, audit), encoding="utf-8")
        print(f"digest: {page} ({len(recs)} PR(s))")
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(
        json.dumps(
            {
                "rendered_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "heads": {str(r["pr"]): r.get("head", "") for r in recs},
            }
        ),
        encoding="utf-8",
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=(__doc__ or "").split("\n", 1)[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record", help="write a PR's digest record into its body")
    r.add_argument("--pr", type=int, required=True)
    r.add_argument("--notes", required=True, help="JSON: summary, undo, fixes, open[, state, deps]")
    r.add_argument("--pr-json", help="PR object, instead of fetching it")
    r.add_argument("--files-json", help="PR files list, instead of fetching it")
    c = sub.add_parser("check", help="does a record's summary fit the size rule")
    c.add_argument("--pr", type=int)
    c.add_argument("--record", help="a record as JSON, instead of a PR")
    d = sub.add_parser("render", help="the digest page")
    d.add_argument("--since", default="last", help="last (default) or YYYY-MM-DD")
    d.add_argument("--format", choices=("html", "md", "both"))
    d.add_argument("--out", default="tmp/arsenal-digest", help="where the HTML goes")
    d.add_argument("--prs-json", help="list of PR objects, instead of fetching them")
    d.add_argument("--audit", help="a repo-audit ledger to show as a card above the PRs")
    args = ap.parse_args(argv)
    try:
        cfg, _ = arsenal_config.load(Path.cwd())
        if args.cmd == "record":
            return cmd_record(args, cfg)
        if args.cmd == "check":
            if not (args.pr or args.record):
                raise DigestError("check needs --pr or --record")
            return cmd_check(args)
        return cmd_render(args, cfg)
    except NoChannel as exc:
        print(
            f"digest: no scriptable GitHub channel — make this call yourself: {exc}",
            file=sys.stderr,
        )
        print("        then rerun with --pr-json/--files-json/--prs-json", file=sys.stderr)
        return 5
    except (DigestError, arsenal_config.ConfigError) as exc:
        print(f"digest: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
