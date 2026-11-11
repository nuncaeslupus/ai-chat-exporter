#!/usr/bin/env python3
"""apply_decisions.py — act on the decisions a human made from the review digest.

Input is the file the digest page exports (its `<!-- ARSENAL-DECISIONS {...} -->`
block), or the same thing typed in chat, one decision per line:

    approve 42
    deny 43: too big, split it
    question 44: why a new dependency?

A typed decision is bound to the head the last digest showed
(`arsenal/session/digest.json`), so "approve 42" means "approve what I saw".

What each decision does:
    approve   PR head still the one decided on → a decision marker on the PR
              (counted as a human approval under [review] digest-decisions), then
              a merge through merge_ready.sh once its deps are merged or approved.
              A merged human-after PR is ratified instead. A head that moved since
              the digest is `stale`: nothing happens, and the next digest shows it.
    deny      an open PR is closed with the note; a merged one gets a revert PR.
    question  posted on the PR and kept in its record; the next worker answers.
Merges run in dependency order (`deps` in each PR's digest record); a PR whose dep
was denied, or is neither merged nor approved, is reported and left open.

Usage:
    apply_decisions.py FILE | --text "approve 42; deny 43: why" [--dry-run]
                       [--prs-json FILE] [--method squash|merge|rebase]
Exit: 0 done, 1 something was stale or blocked (the plan says what), 2 bad input,
      5 no scriptable GitHub channel (the plan and the calls to make are printed).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import digest

BIN = Path(__file__).resolve().parent.parent / "bin"
DECISIONS_RX = re.compile(r"<!--\s*ARSENAL-DECISIONS\s*(\{.*?\})\s*-->", re.DOTALL)
LINE_RX = re.compile(r"^\s*(approve|deny|question)\s+#?(\d+)\s*(?::\s*(.*))?$", re.IGNORECASE)
KINDS = ("approve", "deny", "question")


class ApplyError(Exception):
    pass


def parse(text: str, heads: dict[str, str]) -> dict[int, dict[str, str]]:
    """{pr: {decision, head, note}} from an export block or typed lines."""
    m = DECISIONS_RX.search(text)
    out: dict[int, dict[str, str]] = {}
    if m:
        try:
            raw = json.loads(m.group(1))
        except ValueError as exc:
            raise ApplyError(f"the ARSENAL-DECISIONS block is not valid JSON — {exc}") from exc
        if not isinstance(raw, dict):
            raise ApplyError("the ARSENAL-DECISIONS block must be a JSON object")
        for pr, d in raw.items():
            if not isinstance(d, dict) or d.get("decision") not in KINDS:
                raise ApplyError(f"#{pr}: decision must be one of {', '.join(KINDS)}")
            if not str(pr).isdigit():
                raise ApplyError(f"{pr!r} is not a PR number")
            out[int(pr)] = {
                "decision": d["decision"],
                "head": str(d.get("head", "")),
                "note": str(d.get("note", "")),
            }
        return out
    # A `;` separates decisions only before the next verb, so a note may hold one.
    for line in re.split(r"\n|;\s*(?=(?:approve|deny|question)\b)", text, flags=re.IGNORECASE):
        if not line.strip():
            continue
        lm = LINE_RX.match(line)
        if not lm:
            raise ApplyError(f"cannot read {line.strip()!r} — use 'approve 42', 'deny 43: why'")
        pr = int(lm.group(2))
        out[pr] = {
            "decision": lm.group(1).lower(),
            "head": heads.get(str(pr), ""),
            "note": (lm.group(3) or "").strip(),
        }
    return out


def _deps_order(prs: list[int], deps: dict[int, list[int]]) -> list[int]:
    """`prs` with every dep before its dependent (deps outside `prs` ignored)."""
    done: list[int] = []
    seen: set[int] = set()

    def visit(n: int, path: tuple[int, ...]) -> None:
        if n in seen or n in path:
            return
        for d in deps.get(n, []):
            if d in prs:
                visit(d, (*path, n))
        seen.add(n)
        done.append(n)

    for n in sorted(prs):
        visit(n, ())
    return done


def plan(decisions: dict[int, dict[str, str]], prs: dict[int, dict[str, Any]]) -> list[tuple]:
    """The actions to take, in order. Pure: everything it needs is passed in."""
    acts: list[tuple] = []
    approved: list[int] = []
    deps: dict[int, list[int]] = {}
    for n, d in sorted(decisions.items()):
        pr = prs.get(n)
        if pr is None:
            acts.append(("missing", n, "no such PR"))
            continue
        rec = digest.read_block(pr.get("body")) or {}
        deps[n] = [int(x) for x in rec.get("deps", []) if str(x).isdigit()]
        head = str((pr.get("head") or {}).get("sha") or "")
        merged = bool(pr.get("merged") or pr.get("merged_at"))
        if d["decision"] == "approve":
            if not d["head"] or d["head"] != head:
                acts.append(("stale", n, f"decided on {d['head'][:7] or '?'}, head is {head[:7]}"))
            elif merged:
                acts.append(("ratify", n, ""))
            elif pr.get("state") == "open":
                acts.append(("mark", n, head))
                approved.append(n)
        elif d["decision"] == "deny":
            acts.append(("revert" if merged else "close", n, d["note"]))
        else:
            acts.append(("ask", n, d["note"]))
    # Decide in dependency order against what will actually merge, so a PR whose
    # dep is blocked is blocked too, not merged on top of nothing.
    will_merge: set[int] = set()
    for n in _deps_order(approved, deps):
        blocker = next(
            (
                d
                for d in deps.get(n, [])
                if not ((prs.get(d) or {}).get("merged") or (prs.get(d) or {}).get("merged_at"))
                and d not in will_merge
            ),
            None,
        )
        if blocker is None:
            will_merge.add(n)
            acts.append(("merge", n, ""))
        else:
            why = (
                "was denied"
                if decisions.get(blocker, {}).get("decision") == "deny"
                else "is not merging"
            )
            acts.append(("blocked", n, f"waits on #{blocker}, which {why}"))
    return acts


# --- execution -------------------------------------------------------------------
def _api(method: str, path: str, body: dict[str, Any] | None = None) -> Any:
    return digest._api(method, path, body)


def _merge(slug: str, n: int, head: str, method: str) -> str:
    res = subprocess.run(
        ["bash", str(BIN / "merge_ready.sh"), str(n), "--body"],
        capture_output=True,
        text=True,
        check=False,
    )
    if res.returncode != 0:
        return f"not merged — merge_ready.sh exit {res.returncode}"
    body = res.stdout.split("--- merge commit body ---", 1)[-1].strip()
    _api(
        "PUT",
        f"/repos/{slug}/pulls/{n}/merge",
        {"merge_method": method, "sha": head, "commit_message": body},
    )
    return "merged"


def _revert_range(sha: str, n: int, pr: dict[str, Any], wt: str) -> list[str] | None:
    """`git revert` arguments that undo exactly this PR, or None when that is unclear.

    A merge commit is reverted against its first parent. A one-commit PR, or a
    squash (GitHub's subject ends in `(#N)`), is the commit itself. A multi-commit
    PR landed any other way may have been rebased in, and guessing its range
    could revert other people's commits — so it is left to a human.
    """

    def git(*args: str) -> str:
        return subprocess.run(
            ["git", "-C", wt, *args], capture_output=True, text=True, check=False
        ).stdout.strip()

    if len(git("rev-list", "--parents", "-n", "1", sha).split()) > 2:
        return ["-m", "1", sha]
    if int(pr.get("commits") or 1) <= 1 or git("log", "-1", "--format=%s", sha).endswith(f"(#{n})"):
        return [sha]
    return None


def _revert(slug: str, n: int, pr: dict[str, Any], note: str) -> str:
    """Open a revert PR from a throwaway worktree, so the user's checkout is untouched."""
    sha = pr.get("merge_commit_sha")
    base = (pr.get("base") or {}).get("ref") or "main"
    if not sha:
        return "no merge commit to revert"
    branch = f"revert-pr-{n}"
    wt = tempfile.mkdtemp(prefix="arsenal-revert-")
    failed = ""
    created = False  # delete only a branch this run made, never one that existed
    try:
        for cmd in (
            ["git", "fetch", "-q", "origin", base],
            ["git", "worktree", "add", "-q", "-b", branch, wt, f"origin/{base}"],
        ):
            if subprocess.run(cmd, capture_output=True, check=False).returncode != 0:
                failed = " ".join(cmd[:4])
                break
            created = created or cmd[1] == "worktree"
        span = None if failed else _revert_range(str(sha), n, pr, wt)
        if not failed and span is None:
            failed = "a multi-commit PR not landed as a squash or merge commit"
        if not failed and span is not None:
            rev = ["git", "-C", wt, "revert", "--no-edit", *span]
            push = ["git", "-C", wt, "push", "-q", "-u", "origin", branch]
            for cmd in (rev, push):
                if subprocess.run(cmd, capture_output=True, check=False).returncode != 0:
                    failed = " ".join(cmd[2:5])
                    break
    finally:
        subprocess.run(["git", "worktree", "remove", "--force", wt], capture_output=True)
        if created:
            subprocess.run(["git", "branch", "-D", branch], capture_output=True)
    if failed:
        return f"revert PR not opened — `{failed}` failed; revert {str(sha)[:7]} by hand"
    made = _api(
        "POST",
        f"/repos/{slug}/pulls",
        {
            "title": f"Revert #{n}: {pr.get('title', '')}",
            "head": branch,
            "base": base,
            "body": f"Denied in the review digest: {note or '(no note)'}\n\nReverts #{n}.",
        },
    )
    return f"revert PR #{(made or {}).get('number', '?')} opened"


def _patch_record(slug: str, n: int, pr: dict[str, Any], change: dict[str, Any]) -> None:
    rec = digest.read_block(pr.get("body"))
    if rec is not None:
        _api(
            "PATCH",
            f"/repos/{slug}/pulls/{n}",
            {"body": digest.write_block(pr.get("body"), rec | change)},
        )


def execute(acts: list[tuple], prs: dict[int, dict[str, Any]], slug: str, method: str) -> list[str]:
    out: list[str] = []
    failed: set[int] = set()
    for kind, n, info in acts:
        pr = prs.get(n, {})
        deps = [
            int(x)
            for x in (digest.read_block(pr.get("body")) or {}).get("deps", [])
            if str(x).isdigit()
        ]
        if kind == "merge" and failed.intersection(deps):
            failed.add(n)
            out.append(f"#{n} not merged — a dependency failed above")
            continue
        try:
            out.append(_do(kind, n, info, pr, slug, method))
        except digest.DigestError as exc:
            failed.add(n)
            out.append(f"#{n} {kind} failed — {exc}")
            continue
        if kind == "merge" and not out[-1].endswith("merged"):
            failed.add(n)
    return out


def _do(kind: str, n: int, info: str, pr: dict[str, Any], slug: str, method: str) -> str:
    """Carry out one planned action; the returned line reports it."""
    comments = f"/repos/{slug}/issues/{n}/comments"
    if kind == "mark":
        marker = f"<!-- arsenal-decision: approve head={info} via=digest -->"
        _api("POST", comments, {"body": marker + "\nApproved in the review digest."})
        return f"#{n} approved on {info[:7]}"
    if kind == "ratify":
        _patch_record(slug, n, pr, {"ratified": True, "state": "merged"})
        return f"#{n} ratified"
    if kind == "close":
        _api("POST", comments, {"body": f"Denied in the review digest: {info or '(no note)'}"})
        _api("PATCH", f"/repos/{slug}/pulls/{n}", {"state": "closed"})
        return f"#{n} closed"
    if kind == "revert":
        return f"#{n} {_revert(slug, n, pr, info)}"
    if kind == "ask":
        _api("POST", comments, {"body": f"Question from the review digest: {info}"})
        rec = digest.read_block(pr.get("body")) or {}
        _patch_record(slug, n, pr, {"questions": [*rec.get("questions", []), info]})
        return f"#{n} question posted"
    if kind == "merge":
        head = str((pr.get("head") or {}).get("sha") or "")
        return f"#{n} {_merge(slug, n, head, method)}"
    return f"#{n} {kind}: {info}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=(__doc__ or "").split("\n", 1)[0])
    ap.add_argument("file", nargs="?", help="the digest's exported decisions file")
    ap.add_argument("--text", help='typed decisions, e.g. "approve 42; deny 43: why"')
    ap.add_argument("--dry-run", action="store_true", help="print the plan, change nothing")
    ap.add_argument("--prs-json", help="list of PR objects, instead of fetching them")
    ap.add_argument("--method", default="squash", choices=("squash", "merge", "rebase"))
    args = ap.parse_args(argv)
    try:
        if bool(args.file) == bool(args.text):
            raise ApplyError("give a decisions file or --text, not both")
        text = args.text or Path(args.file).read_text(encoding="utf-8")
        try:
            heads = json.loads(digest.STATE_FILE.read_text(encoding="utf-8")).get("heads", {})
        except (OSError, ValueError):
            heads = {}
        decisions = parse(text, heads)
        if args.prs_json:
            prs = {int(p["number"]): p for p in digest._load_json(args.prs_json)}
            slug = ""
        else:
            slug = digest._slug()
            prs = {n: _api("GET", f"/repos/{slug}/pulls/{n}") for n in decisions}
            # Deps outside the decisions are fetched too: a dep merged yesterday is
            # satisfied, and only its PR says so.
            for pr in list(prs.values()):
                for d in (digest.read_block(pr.get("body")) or {}).get("deps", []):
                    if str(d).isdigit() and int(d) not in prs:
                        prs[int(d)] = _api("GET", f"/repos/{slug}/pulls/{d}")
        acts = plan(decisions, prs)
        for kind, n, info in acts:
            print(f"plan: #{n} {kind}" + (f" — {info}" if info and kind != "mark" else ""))
        if args.dry_run or not slug:
            if not slug and not args.dry_run:
                print("apply_decisions: no channel — make these changes with your GitHub tools")
                return 5
        else:
            for line in execute(acts, prs, slug, args.method):
                print(line)
        return 1 if any(k in ("stale", "blocked", "missing") for k, _, _ in acts) else 0
    except digest.NoChannel as exc:
        print(
            f"apply_decisions: no scriptable GitHub channel — {exc}; rerun with --prs-json",
            file=sys.stderr,
        )
        return 5
    except (ApplyError, digest.DigestError, OSError) as exc:
        print(f"apply_decisions: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
