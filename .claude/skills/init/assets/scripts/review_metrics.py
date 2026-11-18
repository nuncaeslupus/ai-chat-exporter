#!/usr/bin/env python3
"""review_metrics.py — is the review a host chose keeping reverts down, and who finds the problems?

One line, per risk tier, for the last N days of the default branch:

    30d: 41 merged (low 22 · medium 14 · high 5) · 1 revert (high) · 3 fix-ups ≤7d
         · rounds 1.6 · found by: cold-reviewer 58% · ci 21% · self 15% · bot 6%

From git alone (cheap, always):
    merged    a commit on the first-parent line whose subject ends in `(#N)` (a squash)
              or starts `Merge pull request #N`; its tier is its `Risk-tier:` trailer,
              `untiered` when it has none.
    revert    a merge in the window whose subject starts `Revert` and names a merge
              landed up to 7 days before the window or inside it (`Revert #N`,
              `Reverts owner/repo#N`, `Revert "<subject>"`, `This reverts commit
              <sha>`; each tried until one matches); counted against the reverted
              merge's tier. A revert of anything older is not counted.
    fix-up    a `fix` commit (conventional subject) landing within 7 days after a merge
              that touches a file that merge touched; counted once, against the most
              recent such merge's tier.
From digest records (`--prs-json`, the PR objects): mean review rounds, and the share
of findings by `found_by`. These are a trend line, never a gate.

Usage:
    review_metrics.py [--days 30] [--ref BRANCH] [--prs-json FILE] [--json]
Exit: 0 ok, 2 not a git repository or bad input.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import digest

PR_RX = re.compile(r"\(#(\d+)\)\s*$|^Merge pull request #(\d+)")
TIER_RX = re.compile(r"^Risk-tier:\s*(\w+)", re.MULTILINE)
FIX_RX = re.compile(r"^fix(\(.*?\))?!?:", re.IGNORECASE)
REVERT_PR_RX = re.compile(r"^Revert #(\d+)")
REVERT_SUBJ_RX = re.compile(r'^Revert "(.+)"')
REVERT_SHA_RX = re.compile(r"This reverts commit ([0-9a-f]{7,40})")
REVERTS_REF_RX = re.compile(r"^Reverts \S*#(\d+)", re.MULTILINE)  # GitHub's Revert button
PR_SUFFIX_RX = re.compile(r"\s*\(#\d+\)\s*$")
# A merge-commit repo: the revert PR's branch from GitHub's Revert button.
REVERT_BRANCH_RX = re.compile(r"^Merge pull request #\d+ from \S+/revert-(\d+)-")
TIERS = ("low", "medium", "high", "untiered")


def _git(*args: str) -> str:
    res = subprocess.run(["git", *args], capture_output=True, text=True, check=False)
    if res.returncode != 0:
        raise ValueError(res.stderr.strip() or "git failed")
    return res.stdout


def commits(ref: str, days: int) -> list[dict[str, Any]]:
    """First-parent commits in the window, oldest first, with their files."""
    since = (datetime.now(UTC) - timedelta(days=days + 7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    raw = _git(
        "log", "--first-parent", f"--since={since}", "--reverse",
        "--format=%x1e%H%x1f%ct%x1f%s%x1f%b%x1f", "--name-only", ref,
    )  # fmt: skip
    out = []
    for idx, chunk in enumerate(raw.split("\x1e")[1:]):
        sha, ts, subject, body, files = chunk.split("\x1f", 4)
        out.append(
            {
                "idx": idx,  # history order; timestamps can tie
                "sha": sha,
                "time": datetime.fromtimestamp(int(ts), UTC),
                "subject": subject.strip(),
                "body": body,
                "files": {f for f in files.split("\n") if f.strip()},
            }
        )
    return out


def _is_revert(c: dict[str, Any]) -> bool:
    return c["subject"].startswith("Revert") or bool(REVERT_BRANCH_RX.search(c["subject"]))


def _reverted(c: dict[str, Any], merges: dict[int, dict[str, Any]]) -> dict[str, Any] | None:
    """The merge a revert names, trying each way of naming it until one matches."""
    if (m := REVERT_BRANCH_RX.search(c["subject"])) and int(m.group(1)) in merges:
        return merges[int(m.group(1))]
    bare = PR_SUFFIX_RX.sub("", c["subject"])
    if (m := REVERT_PR_RX.search(bare)) and int(m.group(1)) in merges:
        return merges[int(m.group(1))]
    if (m := REVERTS_REF_RX.search(c["body"])) and int(m.group(1)) in merges:
        return merges[int(m.group(1))]
    if m := REVERT_SUBJ_RX.search(bare):
        want = PR_SUFFIX_RX.sub("", m.group(1))
        # The newest earlier merge of that title: titles like "chore: bump deps" recur.
        same = [
            x
            for x in merges.values()
            if x["idx"] < c["idx"] and PR_SUFFIX_RX.sub("", x["subject"]) == want
        ]
        if same:
            return max(same, key=lambda x: x["idx"])
    if m := REVERT_SHA_RX.search(c["body"]):
        return next((x for x in merges.values() if x["sha"].startswith(m.group(1))), None)
    return None


def git_metrics(cs: list[dict[str, Any]], days: int) -> dict[str, Any]:
    start = datetime.now(UTC) - timedelta(days=days)
    merges: dict[int, dict[str, Any]] = {}
    for c in cs:
        m = PR_RX.search(c["subject"])
        if m and not _is_revert(c):
            t = TIER_RX.search(c["body"])
            c["pr"] = int(m.group(1) or m.group(2))
            c["tier"] = t.group(1).lower() if t and t.group(1).lower() in TIERS else "untiered"
            merges[c["pr"]] = c
    in_window = [c for c in merges.values() if c["time"] >= start]
    merged = {t: sum(1 for c in in_window if c["tier"] == t) for t in TIERS}

    reverts = dict.fromkeys(TIERS, 0)
    for c in cs:
        if c["time"] < start or not _is_revert(c):
            continue
        target = _reverted(c, merges)
        if target is not None:
            reverts[target["tier"]] += 1

    fixups = dict.fromkeys(TIERS, 0)
    for c in cs:
        if c["time"] < start or not FIX_RX.search(c["subject"]):
            continue
        earlier = [
            x
            for x in merges.values()
            if x["idx"] < c["idx"]
            and c["time"] <= x["time"] + timedelta(days=7)
            and x["files"] & c["files"]
        ]
        if earlier:
            fixups[max(earlier, key=lambda x: x["idx"])["tier"]] += 1
    return {"days": days, "merged": merged, "reverts": reverts, "fixups": fixups}


def record_metrics(prs: list[dict[str, Any]]) -> dict[str, Any]:
    recs = [r for r in (digest.read_block(p.get("body")) for p in prs if isinstance(p, dict)) if r]
    rounds = [r["rounds"] for r in recs if type(r.get("rounds")) is int and r["rounds"] > 0]
    sources: dict[str, int] = {}
    for r in recs:
        for f in r.get("findings") or []:
            if not isinstance(f, dict):
                continue
            src = str(f.get("found_by", "?"))
            src = "bot" if src.startswith("bot:") else src
            sources[src] = sources.get(src, 0) + 1
    return {
        "rounds": round(sum(rounds) / len(rounds), 1) if rounds else None,
        "found_by": sources,
    }


def line(m: dict[str, Any]) -> str:
    merged, reverts, fixups = m["merged"], m["reverts"], m["fixups"]
    parts = [t for t in TIERS if merged[t]]
    out = f"{m['days']}d: {sum(merged.values())} merged"
    if parts:
        out += " (" + " · ".join(f"{t} {merged[t]}" for t in parts) + ")"
    n_rev = sum(reverts.values())
    rev_tiers = ", ".join(t for t in TIERS if reverts[t])
    out += f" · {n_rev} revert{'s' if n_rev != 1 else ''}" + (f" ({rev_tiers})" if n_rev else "")
    out += f" · {sum(fixups.values())} fix-ups ≤7d"
    if m.get("rounds") is not None:
        out += f" · rounds {m['rounds']}"
    total = sum(m.get("found_by", {}).values())
    if total:
        ranked = sorted(m["found_by"].items(), key=lambda kv: -kv[1])
        out += " · found by: " + " · ".join(f"{k} {round(100 * v / total)}%" for k, v in ranked)
    return out


def default_ref() -> str:
    """origin's default branch when known, so a feature-branch checkout reports main.

    It reads the local `origin/<default>`, so it is as fresh as the last fetch.
    """
    try:
        return _git("symbolic-ref", "--short", "refs/remotes/origin/HEAD").strip() or "HEAD"
    except ValueError:
        return "HEAD"


def summary(days: int = 30, ref: str | None = None) -> str:
    """The git-only line for the digest header (origin's default branch); "" outside git."""
    try:
        return line(git_metrics(commits(ref or default_ref(), days), days))
    except (ValueError, OSError):
        return ""


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=(__doc__ or "").split("\n", 1)[0])
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--ref", help="branch to read (default: origin's default branch, else HEAD)")
    ap.add_argument("--prs-json", help="PR objects carrying digest records")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    try:
        if args.days < 1:
            raise ValueError("--days must be >= 1")
        m = git_metrics(commits(args.ref or default_ref(), args.days), args.days)
        if args.prs_json:
            prs = json.loads(Path(args.prs_json).read_text(encoding="utf-8"))
            if not isinstance(prs, list):
                raise ValueError("--prs-json must hold a JSON list of PR objects")
            m |= record_metrics(prs)
    except (ValueError, OSError) as exc:
        print(f"review_metrics: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(m, indent=2) if args.json else line(m))
    return 0


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
