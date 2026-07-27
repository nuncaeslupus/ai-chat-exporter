#!/usr/bin/env python3
"""Snapshot the review state of a GitHub PR.

Returns one of:
  - conflicts     — PR has merge conflicts with the base (needs a rebase/merge)
  - waiting       — no review-bot signal, CI not green yet
  - bot_eyeing    — watched bot reacted :eyes:, no review submitted
  - bot_commented — watched bot left unaddressed line-level comments
  - ci_running    — at least one CI check is in progress / queued
  - ci_failed     — at least one CI check failed
  - bot_approved  — watched bot approved, quiet window not elapsed yet
  - ready_to_merge — bot approved + CI green + quiet window elapsed

Exit codes:
  0 — bot_commented (unaddressed) OR ready_to_merge (actionable)
  1 — waiting / bot_eyeing / ci_running / bot_approved (loop continues)
  2 — conflicts / ci_failed (Claude action) or error (surface to user)
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from typing import Any

DEFAULT_BOTS = ["gemini-code-assist[bot]", "coderabbitai[bot]", "claude[bot]"]


def _norm_user(name: str | None) -> str:
    """`gh pr view --json reviews` strips the `[bot]` suffix; REST keeps it.
    Normalize both sides to the bare login for comparison."""
    if not name:
        return ""
    return name[:-5] if name.endswith("[bot]") else name


def _gh(*args: str) -> Any:
    """Run a gh subcommand and parse JSON output. Exits 2 on failure."""
    if shutil.which("gh") is None:
        sys.stderr.write("gh CLI not found in PATH\n")
        sys.exit(2)
    try:
        out = subprocess.check_output(["gh", *args], text=True, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as exc:
        sys.stderr.write(f"gh failed: gh {' '.join(args)}\nstderr: {exc.stderr or ''}\n")
        sys.exit(2)
    out = out.strip()
    return json.loads(out) if out else None


def _gh_paginated(*args: str) -> list[Any]:
    """Run a ``gh api`` subcommand with ``--paginate`` to fetch all pages.

    The ``gh api --paginate`` flag follows ``Link: rel="next"`` headers
    automatically and returns every page concatenated as a JSON array.
    Without pagination, REST list endpoints default to 30 items per page,
    silently dropping any comments beyond page 1.
    """
    if shutil.which("gh") is None:
        sys.stderr.write("gh CLI not found in PATH\n")
        sys.exit(2)
    try:
        out = subprocess.check_output(
            ["gh", "api", "--paginate", *args],
            text=True,
            stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError as exc:
        sys.stderr.write(
            f"gh failed: gh api --paginate {' '.join(args)}\nstderr: {exc.stderr or ''}\n"
        )
        sys.exit(2)
    out = out.strip()
    if not out:
        return []
    results: list[Any] = []
    decoder = json.JSONDecoder()
    pos = 0
    while pos < len(out):
        while pos < len(out) and out[pos].isspace():
            pos += 1
        if pos >= len(out):
            break
        try:
            obj, end_idx = decoder.raw_decode(out, pos)
            if isinstance(obj, list):
                results.extend(obj)
            else:
                results.append(obj)
            pos = end_idx
        except json.JSONDecodeError as exc:
            sys.stderr.write(f"Failed to parse paginated JSON: {exc}\n")
            sys.exit(2)
    return results


def _default_repo() -> str:
    data = _gh("repo", "view", "--json", "nameWithOwner")
    return str(data["nameWithOwner"])


def _parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _aggregate_ci(checks: list[dict]) -> str:
    """Returns: success | failure | running | none."""
    if not checks:
        return "none"
    any_failed = any_running = False
    for c in checks:
        status = c.get("status", "")
        conclusion = c.get("conclusion", "")
        state = c.get("state", "")
        if status in ("IN_PROGRESS", "QUEUED", "PENDING"):
            any_running = True
        elif (
            conclusion in ("FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED")
            or state == "FAILURE"
        ):
            any_failed = True
    if any_failed:
        return "failure"
    if any_running:
        return "running"
    return "success"


def _fetch_review_threads(owner: str, name: str, pr_number: int) -> list[dict]:
    """Fetch PR review threads via GraphQL. Returns the threads list (possibly empty).

    Each thread has `isResolved` plus two aliased comment slices:
      - `all_comments` (first: 100) — used to collect `databaseId`s (the REST API
        integer IDs matching `bot_line_comments[].id`).
      - `latest_comment` (last: 1) — used to read the *actual* most-recent author's
        `__typename` (`Bot`, `User`, or `Mannequin`), independent of how long the
        thread is. Without the `last: 1` slice, a thread with more than 100 comments
        would silently lose the real latest author and the "human replied" heuristic
        would mis-fire on huge threads.
    """
    query = (
        "query($owner:String!, $name:String!, $pr:Int!) {"
        "  repository(owner:$owner, name:$name) {"
        "    pullRequest(number:$pr) {"
        "      reviewThreads(first:100) {"
        "        nodes {"
        "          isResolved"
        "          all_comments: comments(first:100) { nodes { databaseId } }"
        "          latest_comment: comments(last:1) { nodes { author { __typename } } }"
        "        }"
        "      }"
        "    }"
        "  }"
        "}"
    )
    data = _gh(
        "api",
        "graphql",
        "-f",
        f"query={query}",
        "-F",
        f"owner={owner}",
        "-F",
        f"name={name}",
        "-F",
        f"pr={pr_number}",
    )
    if not data:
        return []
    return (((data.get("data") or {}).get("repository") or {}).get("pullRequest") or {}).get(
        "reviewThreads", {}
    ).get("nodes") or []


def _addressed_comment_ids(threads: list[dict]) -> set[int]:
    """Return the set of REST comment IDs that belong to a thread that is either
    GH-side resolved OR has a human reply (the PR author / a maintainer posted
    'addressed in <sha>'). The remaining comments are the ones the loop still
    needs to act on.

    For threads with more than 100 comments, the `all_comments` slice covers only
    the first 100 — bot comments beyond that stay unfiltered (the safe default:
    better to leave a comment in the loop than to wrongly mark it addressed). The
    `latest_comment` slice always reflects the true most recent author, so the
    human-reply check is correct regardless of thread length.
    """
    addressed: set[int] = set()
    for thread in threads:
        all_comments = (thread.get("all_comments") or {}).get("nodes") or []
        if not all_comments:
            continue
        ids = {c["databaseId"] for c in all_comments if c.get("databaseId")}
        if thread.get("isResolved"):
            addressed.update(ids)
            continue
        latest_nodes = (thread.get("latest_comment") or {}).get("nodes") or []
        if not latest_nodes:
            continue
        latest_author = latest_nodes[0].get("author") or {}
        if latest_author.get("__typename") == "User":
            addressed.update(ids)
    return addressed


def _classify(
    args: argparse.Namespace,
    head_ts: datetime,
    ci: str,
    reactions: list[dict],
    reviews: list[dict],
    line_comments: list[dict],
    addressed_count: int = 0,
    mergeable: str = "UNKNOWN",
) -> dict:
    watched = {_norm_user(b) for b in args.watch_bots}
    bot_eye = bot_thumb = bot_changes_requested = bot_approved_review = bot_commented_review = False
    last_bot_event_ts: datetime | None = None

    def _bump(ts: datetime | None) -> None:
        nonlocal last_bot_event_ts
        if ts is None:
            return
        if last_bot_event_ts is None or ts > last_bot_event_ts:
            last_bot_event_ts = ts

    for r in reactions:
        user = _norm_user((r.get("user") or {}).get("login"))
        if user not in watched:
            continue
        _bump(_parse_ts(r.get("created_at")))
        content = r.get("content")
        if content == "eyes":
            bot_eye = True
        elif content in ("+1", "heart", "hooray", "rocket"):
            bot_thumb = True

    for rev in reviews:
        author = rev.get("author") or rev.get("user") or {}
        user = _norm_user(author.get("login"))
        if user not in watched:
            continue
        _bump(_parse_ts(rev.get("submittedAt") or rev.get("submitted_at")))
        state = rev.get("state", "")
        if state == "APPROVED":
            bot_approved_review = True
        elif state == "CHANGES_REQUESTED":
            bot_changes_requested = True
        elif state == "COMMENTED":
            bot_commented_review = True

    # By default, return ALL watched-bot line-comments and let the caller (Claude) judge
    # per-comment. The previous timestamp-only heuristic ("addressed if older than the head
    # commit") caused false ready_to_merge readings on PRs where bots commented before an
    # unrelated fix push. With --unresolved-only (filter applied in main() before this
    # function is called), comments belonging to GH-side resolved threads OR threads with a
    # human reply are dropped upstream — see _fetch_review_threads / _addressed_comment_ids.
    bot_comments = []
    for c in line_comments:
        user = _norm_user((c.get("user") or {}).get("login"))
        if user not in watched:
            continue
        ts = _parse_ts(c.get("created_at"))
        _bump(ts)
        bot_comments.append(
            {
                "id": c["id"],
                "user": user,
                "path": c.get("path"),
                "line": c.get("line"),
                "body": c.get("body"),
                "created_at": c.get("created_at"),
            }
        )

    # Did the bot ever say anything (line comments OR a review submission)? Used below to
    # decide whether "everything addressed" is a meaningful signal — a bot that never spoke
    # cannot have had everything addressed. `addressed_count > 0` already implies the bot
    # said something we filtered (count is bot-scoped — see main()), so it's a third
    # engagement signal alongside review-submission states.
    bot_engaged = (
        bot_commented_review or bot_approved_review or bot_changes_requested or addressed_count > 0
    )
    # "Everything addressed" promotes a bot_eyeing case to bot_approved-equivalent:
    # --unresolved-only filtered at least one comment AND nothing remains AND the bot did
    # engage at some point. This overrides the "eyes is a hard block" rule because the loop
    # has provably done its part — every comment the bot wrote has been resolved (GH-side)
    # or human-replied. The bot's stale :eyes: can no longer block ready_to_merge.
    everything_addressed = addressed_count > 0 and not bot_comments and bot_engaged

    if mergeable == "CONFLICTING":
        # A conflicted PR cannot merge no matter how clean CI/reviews are — surface
        # it first as a Claude action (rebase / resolve), like a CI failure.
        state, exit_code = "conflicts", 2
    elif ci == "failure":
        state, exit_code = "ci_failed", 2
    elif bot_comments:
        state, exit_code = "bot_commented", 0
    elif bot_changes_requested:
        # Explicit CHANGES_REQUESTED with no line-comments: bot wants more work.
        state, exit_code = "waiting", 1
    elif ci == "running":
        state, exit_code = "ci_running", 1
    elif bot_eye and not (bot_thumb or bot_approved_review or everything_addressed):
        # :eyes: is a "look here later" signal. Until the bot either thumbs/approves
        # OR explicitly retracts via a new review event, treat as eyeing — never
        # ready_to_merge. (A stale :eyes: from an earlier push still blocks; the bot
        # owns clearing it by acting again.) Exception: if everything_addressed is true,
        # the loop has already resolved every bot-raised concern and the eyes lose their
        # blocking force.
        state, exit_code = "bot_eyeing", 1
    elif (
        ci == "success"
        and (bot_thumb or bot_approved_review or everything_addressed or not watched)
        and mergeable == "MERGEABLE"
    ):
        # Explicit positive signal (thumb / approved review), "everything addressed"
        # equivalent, OR CI-only mode. Silent approval requires the bot to have left a
        # positive signal — not just to have once commented and then gone silent.
        # mergeable must be explicitly MERGEABLE: while GitHub is still computing it
        # (UNKNOWN) fall through to `waiting` so a pending conflict can't slip past.
        anchors = [t for t in (last_bot_event_ts, head_ts) if t is not None]
        quiet_anchor = max(anchors)
        now = datetime.now(UTC)
        if (now - quiet_anchor).total_seconds() >= args.min_quiet_seconds:
            state, exit_code = "ready_to_merge", 0
        else:
            state, exit_code = "bot_approved", 1
    else:
        state, exit_code = "waiting", 1

    return {
        "state": state,
        "exit_code": exit_code,
        "ci": ci,
        "mergeable": mergeable,
        "head_commit_at": head_ts.isoformat(),
        "bot_reactions": {"eyes": bot_eye, "thumb_or_approved": bot_thumb or bot_approved_review},
        "bot_reviews": {
            "approved": bot_approved_review,
            "commented": bot_commented_review,
            "changes_requested": bot_changes_requested,
        },
        "bot_line_comments": bot_comments,
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--pr", required=True, type=int, help="PR number")
    p.add_argument("--repo", help="owner/name (defaults to current repo)")
    p.add_argument(
        "--watch-bots",
        default=",".join(DEFAULT_BOTS),
        help="comma-separated bot usernames; empty disables bot tracking",
    )
    p.add_argument(
        "--min-quiet-seconds",
        type=int,
        default=60,
        help="seconds the bot must be quiet after approval before declaring ready_to_merge",
    )
    p.add_argument(
        "--unresolved-only",
        action="store_true",
        help=(
            "drop bot line-comments whose review thread is GH-side resolved OR has a "
            "human reply (the 'addressed in <sha>' pattern). Requires one extra GraphQL "
            "call. Recommended for /loop usage so each tick does not re-trigger on "
            "already-addressed comments."
        ),
    )
    args = p.parse_args()
    args.watch_bots = [b.strip() for b in args.watch_bots.split(",") if b.strip()]

    repo = args.repo or _default_repo()
    owner, name = repo.split("/", 1)

    pr = _gh(
        "pr",
        "view",
        str(args.pr),
        "--repo",
        repo,
        "--json",
        "state,mergedAt,closedAt,mergeable,statusCheckRollup,headRefOid,reviews,commits",
    )
    if not pr:
        sys.stderr.write(f"PR #{args.pr} not found in {repo}\n")
        return 2

    # Terminal states short-circuit the rest of the classifier — there is nothing for the
    # /loop to act on once the PR is no longer open. Returning a stable state name + exit 0
    # lets the loop's `stop on ready_to_merge|merged|closed` rubric terminate cleanly.
    pr_state = (pr.get("state") or "").upper()
    if pr_state == "MERGED":
        result = {"state": "merged", "exit_code": 0, "merged_at": pr.get("mergedAt")}
        json.dump(result, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0
    if pr_state == "CLOSED":
        result = {"state": "closed", "exit_code": 0, "closed_at": pr.get("closedAt")}
        json.dump(result, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    commits = pr.get("commits") or []
    if not commits:
        sys.stderr.write("PR has no commits\n")
        return 2
    head_ts = _parse_ts(commits[-1].get("committedDate") or commits[-1].get("authoredDate"))
    if head_ts is None:
        sys.stderr.write("could not parse head commit timestamp\n")
        return 2

    checks = pr.get("statusCheckRollup") or []
    ci = _aggregate_ci(checks)

    reactions = _gh("api", f"repos/{owner}/{name}/issues/{args.pr}/reactions") or []
    # Use paginated fetch: PRs with >30 review comments would otherwise lose page 2+.
    line_comments = _gh_paginated(f"repos/{owner}/{name}/pulls/{args.pr}/comments") or []
    reviews = pr.get("reviews") or []

    if args.unresolved_only:
        threads = _fetch_review_threads(owner, name, args.pr)
        addressed = _addressed_comment_ids(threads)
        # Count only watched-bot comments toward "everything addressed" — a thread between
        # two humans being resolved should NOT trigger the bot-stale-eyes override.
        watched_logins = {_norm_user(b) for b in args.watch_bots}
        addressed_count = sum(
            1
            for c in line_comments
            if c.get("id") in addressed
            and _norm_user((c.get("user") or {}).get("login")) in watched_logins
        )
        line_comments = [c for c in line_comments if c.get("id") not in addressed]
    else:
        addressed_count = 0

    mergeable = (pr.get("mergeable") or "UNKNOWN").upper()
    result = _classify(
        args, head_ts, ci, reactions, reviews, line_comments, addressed_count, mergeable
    )
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return int(result["exit_code"])


if __name__ == "__main__":
    sys.exit(main())
