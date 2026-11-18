#!/usr/bin/env python3
"""branch_protection.py — protect the default branch with the checks that really report.

The PR-required flow (`claim_task.sh` → `open_task_pr.sh`) only engages for a
claimed queue task. Ad hoc conversational work never goes through it, and with
nothing on the GitHub side to stop it a repo can take a run of commits straight
to its default branch — one consumer took ten, one of them by an agent. A rule
in prose asks; branch protection refuses. So `/init` applies it once, and this
is the script it runs (re-run it by hand at any time).

What it applies on the default branch:

  * a pull request before merging (zero approvals: a solo repo cannot approve
    its own PR, and "no direct push" is the part that matters)
  * required status checks = the checks that have ACTUALLY REPORTED
  * enforce_admins, so the owner's own pushes go through a PR too

"Actually reported" is the whole design. A check that is installed but never
reports — a review bot that skips small repos, a workflow filtered to paths
nobody touches — made required means every PR waits forever for a signal
nobody will send. So a check is required only when it concluded on every one
of the recent PR heads that carried any check at all. Workflow job names are
the fallback when no PR has run anything yet, and are labelled unverified.

Idempotent: existing protection is reported and left alone, because it may be
stricter than what this would write. `--force` rewrites it, keeping every
existing required check, review count and push restriction.

Fails soft, always exit 0: no `gh`, not authenticated, no GitHub remote, or
GitHub refusing the call (403/404 — a private repo on a plan without branch
protection) prints one line of reason plus the manual step. `/init` must never
abort over a repository setting.

The last line is always `outcome: <word>` — applied, existing, unavailable,
skipped or dry-run — which is what init.py records.

Usage:
    branch_protection.py [--repo OWNER/REPO] [--repo-root PATH] [--dry-run] [--force]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

# How many recent PR heads to sample. Small on purpose: one API call per head,
# and a check that reported on the last five is one the repo actually runs.
SAMPLE_PRS = 5

# Conclusions that are a verdict. `skipped` and `cancelled` are not: a check
# that only ever skips is exactly the one that must not be required.
_REPORTED = {"success", "failure", "neutral", "timed_out", "action_required"}
_STATUS_REPORTED = {"success", "failure", "error"}

# The workflow this bundle installs itself. It reports on every task PR, but a
# repo that deletes it (a supported opt-out) would then block every PR on it.
_OWN_WORKFLOWS = {"arsenal-queue.yml"}


class GhError(Exception):
    """A `gh api` call that failed; `status` is the HTTP code when one was given."""

    def __init__(self, message: str, status: int | None) -> None:
        super().__init__(message)
        self.status = status


def _say(line: str) -> None:
    print(f"branch_protection: {line}")


def _gh_api(path: str, method: str = "GET", body: dict[str, Any] | None = None) -> Any:
    cmd = ["gh", "api", path]
    if method != "GET":
        cmd[2:2] = ["-X", method]
    if body is not None:
        cmd += ["--input", "-"]
    try:
        proc = subprocess.run(
            cmd,
            input=json.dumps(body) if body is not None else None,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GhError(str(exc), None) from exc
    if proc.returncode != 0:
        text = (proc.stderr or "") + " " + (proc.stdout or "")
        match = re.search(r"HTTP (\d{3})", text)
        message = (proc.stderr or proc.stdout or "gh api failed").strip().splitlines()
        raise GhError(
            message[0] if message else "gh api failed", int(match.group(1)) if match else None
        )
    out = proc.stdout.strip()
    return json.loads(out) if out else {}


def _slug_from_url(url: str) -> str | None:
    match = re.search(r"github\.com[:/]+([^/\s]+)/([^/\s]+?)(?:\.git)?/?$", url.strip())
    return f"{match.group(1)}/{match.group(2)}" if match else None


def _repo_slug(repo_root: Path, override: str | None) -> str | None:
    if override:
        return override
    if os.environ.get("GH_REPO"):
        return os.environ["GH_REPO"]
    return _origin_slug(repo_root)


def _origin_slug(repo_root: Path) -> str | None:
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo_root), "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return _slug_from_url(proc.stdout) if proc.returncode == 0 else None


def _reported_checks(slug: str) -> tuple[list[str], dict[str, int], int]:
    """(required names, per-name report count, heads sampled) from recent PR heads."""
    pulls = _gh_api(
        f"repos/{slug}/pulls?state=all&sort=updated&direction=desc&per_page={SAMPLE_PRS}"
    )
    heads = [p["head"]["sha"] for p in pulls if isinstance(p, dict) and p.get("head")]
    counts: dict[str, int] = {}
    sampled = 0
    for sha in heads[:SAMPLE_PRS]:
        runs = _gh_api(f"repos/{slug}/commits/{sha}/check-runs?per_page=100")
        statuses = _gh_api(f"repos/{slug}/commits/{sha}/status")
        names_any = {r.get("name") for r in runs.get("check_runs", [])} | {
            s.get("context") for s in statuses.get("statuses", [])
        }
        if not names_any - {None}:
            continue  # a head nothing ran on says nothing about which checks exist
        sampled += 1
        reported = {
            r["name"]
            for r in runs.get("check_runs", [])
            if r.get("status") == "completed" and r.get("conclusion") in _REPORTED
        } | {
            s["context"] for s in statuses.get("statuses", []) if s.get("state") in _STATUS_REPORTED
        }
        for name in names_any - {None}:
            counts.setdefault(name, 0)
        for name in reported:
            counts[name] += 1
    required = sorted(n for n, c in counts.items() if sampled and c == sampled)
    return required, counts, sampled


def _workflow_jobs(repo_root: Path) -> list[str]:
    """Job names of pull_request workflows — the unverified fallback.

    Line-based, stdlib only: a job with a matrix, a job-level `if:` or a name
    built from an expression reports under a name this cannot predict, or not at
    all, so it is left out rather than guessed.
    """
    names: list[str] = []
    wf_dir = repo_root / ".github" / "workflows"
    if not wf_dir.is_dir():
        return names
    for wf in sorted([*wf_dir.glob("*.yml"), *wf_dir.glob("*.yaml")]):
        if wf.name in _OWN_WORKFLOWS:
            continue
        text = wf.read_text(encoding="utf-8", errors="replace")
        if "pull_request" not in text:
            continue
        in_jobs = False
        job: dict[str, Any] | None = None
        jobs: list[dict[str, Any]] = []
        for line in text.splitlines():
            if re.match(r"^jobs:\s*$", line):
                in_jobs = True
                continue
            if in_jobs and re.match(r"^\S", line):
                in_jobs = False
            if not in_jobs:
                continue
            m = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
            if m:
                job = {"id": m.group(1), "name": None, "skip": False}
                jobs.append(job)
                continue
            if job is None:
                continue
            m = re.match(r"^    name:\s*(.+?)\s*$", line)
            if m:
                job["name"] = m.group(1).strip("'\"")
            if re.match(r"^    (if|strategy):", line):
                job["skip"] = True
        for j in jobs:
            name = j["name"] or j["id"]
            if not j["skip"] and "${{" not in name:
                names.append(name)
    return sorted(set(names))


def _carry_over(existing: dict[str, Any], contexts: list[str]) -> dict[str, Any]:
    """The --force payload: what exists, plus what was detected — never less."""
    rsc = existing.get("required_status_checks") or {}
    kept = set(rsc.get("contexts") or []) | set(contexts)
    reviews = existing.get("required_pull_request_reviews") or {}
    restr = existing.get("restrictions")
    payload = _payload(sorted(kept), strict=bool(rsc.get("strict")))
    payload["required_pull_request_reviews"] = {
        "required_approving_review_count": reviews.get("required_approving_review_count", 0),
        "dismiss_stale_reviews": bool(reviews.get("dismiss_stale_reviews")),
        "require_code_owner_reviews": bool(reviews.get("require_code_owner_reviews")),
        "require_last_push_approval": bool(reviews.get("require_last_push_approval")),
    }
    # The PUT replaces the whole protection: a toggle left out is switched off.
    for key in (
        "required_linear_history",
        "required_conversation_resolution",
        "lock_branch",
        "block_creations",
    ):
        if (existing.get(key) or {}).get("enabled"):
            payload[key] = True
    if restr:
        payload["restrictions"] = {
            "users": [u.get("login") for u in restr.get("users", [])],
            "teams": [t.get("slug") for t in restr.get("teams", [])],
            "apps": [a.get("slug") for a in restr.get("apps", [])],
        }
    return payload


def _payload(contexts: list[str], strict: bool = False) -> dict[str, Any]:
    return {
        "required_status_checks": {"strict": strict, "contexts": contexts} if contexts else None,
        "enforce_admins": True,
        "required_pull_request_reviews": {"required_approving_review_count": 0},
        "restrictions": None,
    }


def _manual(slug: str, branch: str, contexts: list[str]) -> str:
    checks = ", ".join(contexts) if contexts else "none"
    return (
        f"manual: GitHub → {slug} → Settings → Branches → protect `{branch}`: require a pull "
        f"request, require status checks ({checks}), include administrators. Or, with gh: "
        f"`python3 claude-arsenal/scripts/branch_protection.py --dry-run` prints the payload "
        f"for `gh api -X PUT repos/{slug}/branches/{branch}/protection --input <file>`."
    )


def run(repo_root: Path, repo: str | None, dry_run: bool, force: bool) -> str:
    """Do the work and return the outcome word; every failure is reported, not raised."""
    slug = _repo_slug(repo_root, repo)
    if not slug:
        _say("no GitHub remote (origin is not on github.com) — nothing to protect.")
        return "skipped"
    if shutil.which("gh") is None:
        _say(f"`gh` is not installed — cannot protect {slug}'s default branch from here.")
        _say(_manual(slug, "<default branch>", []))
        return "skipped"
    try:
        auth = subprocess.run(["gh", "auth", "status"], capture_output=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        auth = None
    if auth is None or auth.returncode != 0:
        _say("`gh` is not authenticated (`gh auth login`) — branch protection not applied.")
        _say(_manual(slug, "<default branch>", []))
        return "skipped"

    try:
        info = _gh_api(f"repos/{slug}")
        branch = info.get("default_branch") or "main"
    except GhError as exc:
        _say(f"cannot read {slug} ({exc}) — branch protection not applied.")
        _say(_manual(slug, "<default branch>", []))
        # 404 here is a repo not created on GitHub yet (or not visible to this
        # token): a state the next `/init` should look at again, so not recorded.
        return "unavailable" if exc.status == 403 else "skipped"
    _say(f"repository {slug}, default branch `{branch}`")
    if info.get("private"):
        # Read by init.py's merge-policy advice: a private repo's Actions minutes
        # are metered, so CI that `after-ci` waits on may simply never run.
        _say("visibility: private — Actions minutes are metered on this repo")

    existing: dict[str, Any] | None = None
    try:
        existing = _gh_api(f"repos/{slug}/branches/{branch}/protection")
    except GhError as exc:
        if exc.status == 403:
            _say(
                f"GitHub refused to read protection on `{branch}` ({exc}) — usually a private "
                "repo on a plan without branch protection, or a token without admin rights."
            )
            _say(_manual(slug, branch, []))
            return "unavailable"
        if exc.status != 404:
            _say(f"cannot read protection on `{branch}` ({exc}) — not applied.")
            _say(_manual(slug, branch, []))
            return "skipped"
        if "branch not found" in str(exc).lower():
            # An empty repository: the default branch has no commit yet. Nothing
            # to protect today, and a push away from something to protect.
            _say(f"`{branch}` does not exist on GitHub yet (nothing pushed) — not applied.")
            _say(_manual(slug, branch, []))
            return "skipped"
        if "not protected" not in str(exc).lower():
            # 404 for a repo this token cannot administer reads the same as a
            # missing rule, except for the message.
            _say(
                f"GitHub answered 404 for `{branch}` protection ({exc}) — no admin access, "
                "or protection is unavailable on this plan."
            )
            _say(_manual(slug, branch, []))
            return "unavailable"

    if existing and not force:
        rsc = existing.get("required_status_checks") or {}
        checks = ", ".join(rsc.get("contexts") or []) or "none"
        _say(
            f"`{branch}` is already protected (required checks: {checks}) — left as is. "
            "`--force` rewrites it, keeping everything it already requires."
        )
        return "existing"

    try:
        required, counts, sampled = _reported_checks(slug)
    except GhError as exc:
        _say(f"could not read recent check runs ({exc}); requiring no checks.")
        required, counts, sampled = [], {}, 0
    if sampled:
        _say(f"checks seen on the {sampled} most recent PR head(s) that ran any:")
        for name in sorted(counts):
            verdict = (
                "required" if name in required else "NOT required (did not report on every head)"
            )
            _say(f"  {name}: {counts[name]}/{sampled} — {verdict}")
    else:
        # `--repo` naming a different repository than this checkout: its workflow
        # files are not here, and requiring this checkout's job names would block
        # every PR there on checks that never run.
        origin = _origin_slug(repo_root)
        foreign = origin is not None and origin.lower() != slug.lower()
        required = [] if foreign else _workflow_jobs(repo_root)
        if required:
            _say(
                "no PR has reported a check yet; falling back to pull_request workflow job "
                f"names (UNVERIFIED — confirm on the first PR): {', '.join(required)}"
            )
        else:
            _say("no check has reported and no pull_request workflow found — requiring a PR only.")

    payload = _carry_over(existing, required) if existing else _payload(required)
    chosen = (payload["required_status_checks"] or {}).get("contexts") or []
    _say(f"chosen required checks: {', '.join(chosen) or 'none'}; PR required; admins included")

    if dry_run:
        _say(f"dry run — would PUT repos/{slug}/branches/{branch}/protection with:")
        print(json.dumps(payload, indent=2))
        return "dry-run"
    try:
        _gh_api(f"repos/{slug}/branches/{branch}/protection", method="PUT", body=payload)
    except GhError as exc:
        _say(f"GitHub refused the protection rule ({exc}).")
        _say(_manual(slug, branch, chosen))
        return "unavailable" if exc.status in (403, 404) else "skipped"
    _say(f"APPLIED: `{branch}` now refuses direct pushes, admins included.")
    return "applied"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", help="OWNER/REPO (default: GH_REPO, else the origin remote)")
    parser.add_argument("--repo-root", type=Path, default=Path(), help="The host checkout.")
    parser.add_argument("--dry-run", action="store_true", help="Detect and print; write nothing.")
    parser.add_argument(
        "--force", action="store_true", help="Rewrite existing protection (keeps what it requires)."
    )
    args = parser.parse_args(argv)
    outcome = run(args.repo_root, args.repo, args.dry_run, args.force)
    print(f"outcome: {outcome}")
    return 0


if __name__ == "__main__":
    # Windows consoles default to a legacy codepage (cp1252 and friends);
    # a non-ASCII line must degrade to "?", never take the process down.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
