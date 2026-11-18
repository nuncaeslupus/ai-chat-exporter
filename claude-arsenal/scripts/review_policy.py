#!/usr/bin/env python3
"""review_policy.py — a PR's risk tier, and who has to approve it at that tier.

One module owns both answers so `explain` and the merge verdict cannot disagree:
pr_audit.py imports `classify` and `requirement`, review_sources.py imports
`classify` for its review depth.

Tiers, from the PR's changed files and `arsenal/config.toml`:
    high    any file matches risk-paths or review.always-human-paths, or the diff
            changes more than risk-lines lines
    low     every file matches review.low-paths (empty = the built-in docs/config set)
    medium  everything else

Approval per tier (review.approval-low / review.approval-medium /
review.approval-high, else the review.preset row):
    auto         CI/gates per merge-policy; no review required
    agent        a review clear on the head (bot review or adversarial CLEAR marker)
    human:<N>    an agent review, then N human approvals on the head
    human-after  an agent review; the merge is flagged for the human to ratify

With review.preset empty nothing here is consulted at merge time and
merge-policy alone decides, exactly as before the key existed.

Usage:
    review_policy.py tier --files FILE|-      # PR-files JSON: [{filename, additions, deletions}]
    review_policy.py require --tier high [--human-paths]
    review_policy.py explain                  # the effective flow, at most 12 lines
Exit: 0 ok, 2 config or input error.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import arsenal_config

TIERS = ("low", "medium", "high")

# A PR touching only these is low-risk unless review.low-paths names others.
# review_sources.py treats the same set as "docs/config only".
DOCS_ONLY_GLOBS = (
    "*.md",
    "*.mdx",
    "*.rst",
    "*.txt",
    "docs/*",
    "LICENSE*",
    "CODEOWNERS",
    ".github/CODEOWNERS",
    ".gitignore",
    ".editorconfig",
    ".github/ISSUE_TEMPLATE/*",
    ".github/PULL_REQUEST_TEMPLATE*",
)

# The starting rows of each preset; review.approval-<tier> overrides one row.
PRESETS: dict[str, dict[str, str]] = {
    "solo-trust": {"low": "auto", "medium": "agent", "high": "human-after"},
    "solo-gated": {"low": "auto", "medium": "human:1", "high": "human:1"},
    "team": {"low": "agent", "medium": "human:1", "high": "human:2"},
    "manual": {"low": "human:1", "medium": "human:1", "high": "human:1"},
}

# The merge-policy each preset implies, printed by `explain` so a host can see
# when the two disagree. `manual` means no agent merges at all.
PRESET_POLICY = {
    "solo-trust": "after-ci-and-review",
    "solo-gated": "after-ci-and-review",
    "team": "after-ci-and-review",
    "manual": "never",
}


def _match(name: str, globs: list[str] | tuple[str, ...]) -> bool:
    return any(fnmatch.fnmatch(name, g) for g in globs)


def classify(files: list[dict[str, Any]], cfg: dict[str, Any]) -> dict[str, Any]:
    """{tier, reasons, lines, human_paths} for a PR's files. Pure and deterministic."""
    names = sorted(str(f.get("filename", "")) for f in files)
    lines = sum(int(f.get("additions", 0)) + int(f.get("deletions", 0)) for f in files)
    human = [n for n in names if _match(n, cfg["review.always-human-paths"])]
    risky = [n for n in names if _match(n, cfg["risk-paths"])]
    reasons = [f"always-human path: {n}" for n in human]
    reasons += [f"risk path: {n}" for n in risky if n not in human]
    if lines > cfg["risk-lines"]:
        reasons.append(f"lines {lines} > {cfg['risk-lines']}")
    if reasons:
        tier = "high"
    elif names and all(_match(n, cfg["review.low-paths"] or DOCS_ONLY_GLOBS) for n in names):
        tier, reasons = "low", ["docs/config only"]
    else:
        tier, reasons = "medium", [f"{len(names)} file(s), {lines} line(s)"]
    return {"tier": tier, "reasons": reasons, "lines": lines, "human_paths": human}


def requirement(tier: str, cfg: dict[str, Any], human_paths: bool = False) -> dict[str, Any]:
    """{tier, approval, humans, ratify} — what a PR at `tier` waits for.

    Precedence: always-human-paths > review.approval-<tier> > preset row.
    With no preset and no override, `approval` is "" and the caller falls back
    to merge-policy alone.
    """
    preset = cfg["review.preset"]
    approval = cfg[f"review.approval-{tier}"] or PRESETS.get(preset, {}).get(tier, "")
    humans = int(approval.split(":")[1]) if approval.startswith("human:") else 0
    if human_paths and humans < 1:
        approval, humans = "human:1", 1
    return {
        "tier": tier,
        "approval": approval,
        "humans": humans,
        "ratify": approval == "human-after",
    }


def explain(cfg: dict[str, Any]) -> list[str]:
    preset = cfg["review.preset"]
    if not preset:
        return [
            "review.preset: (unset) — merge-policy alone decides every merge",
            f"merge-policy: {cfg['merge-policy']}",
        ]
    out = [f"review.preset: {preset} (implies merge-policy {PRESET_POLICY[preset]})"]
    if cfg["merge-policy"] != PRESET_POLICY[preset]:
        policy = cfg["merge-policy"]
        out.append(f"  note: merge-policy is {policy}; an agent merges only when both agree")
    low = ", ".join(cfg["review.low-paths"]) or "built-in docs/config set"
    out.append(f"low:    every file in [{low}]")
    out.append(f"high:   risk-paths {cfg['risk-paths'] or '[]'}, > {cfg['risk-lines']} lines,")
    human = cfg["review.always-human-paths"] or "[]"
    out.append(f"        or always-human-paths {human} (+1 human)")
    out.append("medium: everything else")
    if any(requirement(t, cfg)["humans"] for t in TIERS):
        out.append("  note: a human approval counts only from a login other than the PR author,")
        out.append("        so the agent needs its own GitHub identity for a human to approve")
    for tier in TIERS:
        req = requirement(tier, cfg)
        src = "config" if cfg[f"review.approval-{tier}"] else "preset"
        out.append(f"{tier:<7} → {req['approval']} ({src})")
    return out


def _load_cfg() -> dict[str, Any]:
    try:
        cfg, _ = arsenal_config.load(Path.cwd())
    except (arsenal_config.ConfigError, OSError) as exc:
        print(f"review_policy: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
    return cfg


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("tier", help="classify a PR's files")
    t.add_argument("--files", required=True, help="GitHub PR-files JSON, or - for stdin")
    r = sub.add_parser("require", help="approval needed at a tier")
    r.add_argument("--tier", required=True, choices=TIERS)
    r.add_argument("--human-paths", action="store_true", help="an always-human path matched")
    sub.add_parser("explain", help="the effective review flow")
    args = ap.parse_args(argv)
    cfg = _load_cfg()

    if args.cmd == "tier":
        try:
            raw = sys.stdin.read() if args.files == "-" else Path(args.files).read_text()
            files = json.loads(raw)
            if not isinstance(files, list):
                raise ValueError("expected a JSON list of files")
        except (OSError, ValueError) as exc:
            print(f"review_policy: --files: {exc}", file=sys.stderr)
            return 2
        print(json.dumps(classify(files, cfg)))
    elif args.cmd == "require":
        print(json.dumps(requirement(args.tier, cfg, args.human_paths)))
    else:
        print("\n".join(explain(cfg)))
    return 0


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
