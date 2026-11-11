#!/usr/bin/env python3
"""pr_audit.py — which open PR is waiting, and on what.

`query_status.py` reports the board from issues and task files. It answers
"what is claimed and what is done", and it is silent on the state a stalled
fleet actually lands in: eight sessions each open a PR, the machine goes down
mid-cycle, and three days later seven PRs are open with CI green, claims still
held and issues still assigned. Every ledger reads "in progress". Nothing is.

So this asks the other question. For each open PR it prints the head SHA and
the merge conditions **against that SHA**, plus the one next action. The SHA
matters more than it looks: a review of an earlier tree is not a review of this
one, and a check run that reported on the previous push is not evidence about
what would be merged.

It performs no network I/O. The caller hands it the payload GitHub already
returned (`--prs`), the same split `query_status.py` uses, because the surfaces
this bundle runs on do not all have a scriptable GitHub channel and a report
that only works where `gh` is installed is a report that goes missing exactly
when a fleet is in trouble. `bin/merge_ready.sh` is the fetching half; it calls
this for the verdict so the conditions are evaluated in one place instead of
being re-derived by hand in every session that merges.

Input (`--prs PATH|-`): a JSON array of PR records. Unknown keys are ignored,
so the raw GitHub shapes can be passed through; the keys read are

    number, title, draft, mergeable, mergeable_state, created_at, updated_at,
    head: {sha, ref},
    checks:  [{name, status, conclusion, head_sha}]     — for the head SHA
    reviews: [{state, commit_id, submitted_at, user: {login}}]
    threads: [{id, resolved, path}]                      — review threads
    user: {login}                                        — the PR's author
    comments: [{id, body, author_association, user: {login, type}}]
                                                         — reviewer markers
    commits: [{message}] or [{commit: {message}}]        — Claude-Session trailers

Config: merge-policy, and [review] reviewer-identity (whose marker may clear a
head; see marker_state).

Optionally `--claims PATH`: a JSON array of `{ref, task_id, created_at, pr}`
for the claim refs currently held, to name the claims nothing is working on.

Exit: 0 report produced (with `--require-ready`: the PR is mergeable under the
policy); 1 `--require-ready` and it is not; 2 bad input or bad policy;
3 the policy is `never` — ready or not, a human merges.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import arsenal_config
import review_policy

POLICIES = {"always", "after-review", "after-ci", "after-ci-and-review", "never"}

# Conclusions that are not a failure. `neutral` and `skipped` are how a matrix
# job reports "not applicable here", and a required check that legitimately did
# not apply must not read as a red PR forever.
CHECK_OK = {"success", "neutral", "skipped"}

# GitHub's own vocabulary for a review that is not a verdict. A COMMENTED review
# is somebody talking, not somebody approving, and counting it as a review is how
# `after-review` gets satisfied by a bot's "looks fine so far".
REVIEW_VERDICTS = {"APPROVED", "CHANGES_REQUESTED"}


class AuditError(Exception):
    """Bad input — distinct from a PR that is simply not ready."""


def _now() -> datetime:
    return datetime.now(UTC)


def _parse_time(raw: object) -> datetime | None:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _age_hours(raw: object) -> float | None:
    when = _parse_time(raw)
    return None if when is None else (_now() - when).total_seconds() / 3600.0


def _short(sha: object) -> str:
    return str(sha)[:7] if isinstance(sha, str) and sha else "?"


def _dig(record: dict[str, Any], *path: str) -> Any:
    cur: Any = record
    for key in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def _records(value: object) -> list[dict[str, Any]]:
    """The dict entries of a list, tolerating nulls and stray scalars."""
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def read_policy(repo_root: Path) -> str:
    """`merge-policy` from arsenal/config.toml, or the bundle default.

    Read here rather than shelled out to `arsenal_config.py` so a fleet audit of
    forty PRs is one file read and not forty subprocesses.
    """
    config = repo_root / "arsenal" / "config.toml"
    if not config.is_file():
        return "after-ci"
    try:
        raw = tomllib.loads(config.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        raise AuditError(f"cannot read {config}: {exc}") from exc
    value = raw.get("merge-policy", "after-ci")
    if value not in POLICIES:
        raise AuditError(f"merge-policy must be one of {sorted(POLICIES)}, got {value!r}")
    return str(value)


def read_reviewer_identity(repo_root: Path) -> str:
    """`[review] reviewer-identity` from arsenal/config.toml, or `distinct-session`.

    Validated as strictly as merge-policy: an unknown value is an error (exit 2),
    never quietly read as the default — a typo for `distinct-login` that fell
    back to `distinct-session` would silently loosen who may clear a PR.
    """
    config = repo_root / "arsenal" / "config.toml"
    if not config.is_file():
        return "distinct-session"
    try:
        raw = tomllib.loads(config.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        raise AuditError(f"cannot read {config}: {exc}") from exc
    table = raw.get("review", {})
    value = table.get("reviewer-identity", "distinct-session") if isinstance(table, dict) else table
    if not isinstance(value, str) or value not in IDENTITIES:
        raise AuditError(
            f"[review] reviewer-identity must be one of {sorted(IDENTITIES)}, got {value!r}"
        )
    return value


def read_review_cfg(repo_root: Path) -> dict[str, Any] | None:
    """The validated config when `review.preset` or an approval override is set, else None.

    None keeps every verdict exactly what it was before risk tiers existed: the
    `[review]` table is read on its own first, so a host with no preset is never
    held to validation of keys pr_audit did not read before.
    """
    config = repo_root / "arsenal" / "config.toml"
    if not config.is_file():
        return None
    try:
        table = tomllib.loads(config.read_text(encoding="utf-8")).get("review", {})
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        raise AuditError(f"cannot read {config}: {exc}") from exc
    keys = ("preset", "approval-low", "approval-medium", "approval-high")
    if not isinstance(table, dict) or not any(table.get(k) for k in keys):
        return None
    try:
        cfg, _ = arsenal_config.load(repo_root)
    except (arsenal_config.ConfigError, OSError) as exc:
        raise AuditError(str(exc)) from exc
    return cfg


_DECISION_RX = re.compile(
    r"<!--\s*arsenal-decision:\s*approve\s+head=([0-9a-fA-F]{40})\s+via=digest\s*-->"
)


def digest_approvals(pr: dict[str, Any], head: str) -> int:
    """Digest approvals on `head`: apply_decisions.py's marker, from a trusted commenter.

    Counted only under `[review] digest-decisions = true`. The marker is written by
    the agent from the human's exported decisions file, so the trust is in that
    file; binding it to the head SHA keeps it from approving a later commit.
    """
    # OWNER only, never a bot: the setting exists for a repo whose owner's own
    # account is the agent's, and a collaborator could otherwise approve their own
    # PR with one comment. The full head SHA, so no short-prefix collision counts.
    for c in _records(pr.get("comments")):
        if c.get("author_association") != "OWNER" or _dig(c, "user", "type") == "Bot":
            continue
        # At the start of the comment only: a comment quoting a PR body or bot
        # output that happens to contain a marker is not a decision.
        m = _DECISION_RX.match(str(c.get("body") or "").lstrip())
        if m and m.group(1).lower() == head.lower():
            return 1
    return 0


def humans_on_head(pr: dict[str, Any], head: str) -> list[str]:
    """Distinct logins of human approvals on `head`.

    A human is a non-Bot user GitHub reports as OWNER, MEMBER or COLLABORATOR,
    other than the PR's author. A bot's approval and an approval of an older
    commit count zero: an agent approval is never a human one, and an approval
    covers the tree it read.
    """
    author = _dig(pr, "user", "login")
    logins: list[str] = []
    for r in _records(pr.get("reviews")):
        login = _dig(r, "user", "login")
        if (
            r.get("state") == "APPROVED"
            and r.get("commit_id") == head
            and _dig(r, "user", "type") != "Bot"
            and r.get("author_association") in TRUSTED_ASSOCIATIONS
            and login
            and login != author
            and login not in logins
        ):
            logins.append(str(login))
    return logins


def agent_reviewed(pr: dict[str, Any], head: str, identity: str) -> bool:
    """A non-human review clears the head: a bot's approval on it, or a CLEAR marker."""
    marker = marker_state(pr, head, identity)
    if marker is not None and marker[0] == "clear":
        return True
    return any(
        r.get("state") == "APPROVED"
        and r.get("commit_id") == head
        and _dig(r, "user", "type") == "Bot"
        for r in _records(pr.get("reviews"))
    )


def tier_state(
    pr: dict[str, Any],
    head: str,
    review: str,
    review_detail: str,
    cfg: dict[str, Any],
    identity: str = "distinct-session",
) -> dict[str, Any]:
    """What the PR's risk tier requires, and what the head has towards it.

    Files that could not be read classify as high: an unknown change is not a
    low-risk one.
    """
    files = pr.get("files")
    changed = pr.get("changed_files")
    cls: dict[str, Any]
    if not isinstance(files, list):
        cls = {"tier": "high", "reasons": ["changed files unreadable"], "human_paths": []}
    elif isinstance(changed, int) and changed > len(files):
        # A page of the file list is not the list: a risky path past it is unseen.
        cls = {
            "tier": "high",
            "reasons": [f"file list truncated ({len(files)} of {changed})"],
            "human_paths": [],
        }
    else:
        cls = review_policy.classify(_records(files), cfg)
    req = review_policy.requirement(cls["tier"], cfg, bool(cls["human_paths"]))
    humans = humans_on_head(pr, head)
    if cfg["review.digest-decisions"] and digest_approvals(pr, head):
        humans.append("via digest")
    # `human:N` is an agent review AND N humans: a human approval also turns the
    # GitHub review state clear, so the agent half is checked on its own there.
    agent_ok = review == "clear" and (
        not req["approval"].startswith("human:") or agent_reviewed(pr, head, identity)
    )
    needs_agent = req["approval"] not in ("", "auto")
    ok = (agent_ok or not needs_agent) and len(humans) >= req["humans"]
    provenance = [f"Risk-tier: {cls['tier']} ({'; '.join(cls['reasons'])})"]
    if agent_ok:
        provenance.append(f"Reviewed-by: agent {review_detail}@{_short(head)}")
    provenance += [f"Approved-by: human {h}@{_short(head)}" for h in humans]
    if req["ratify"]:
        provenance.append("Ratify: pending")
    return {
        "tier": cls["tier"],
        "tier_reasons": cls["reasons"],
        "approval": req["approval"] or "auto",
        "humans_required": req["humans"],
        "humans_on_head": humans,
        "ratify": req["ratify"],
        "tier_ok": ok,
        "provenance": provenance,
    }


# --- reviewer markers ------------------------------------------------------------
# A second reader that is not a GitHub review records its verdict as a PR
# comment carrying one machine line, written by `adversarial_review.sh marker`:
#
#     <!-- arsenal-review: verdict=CLEAR head=<sha> session=<id> -->
#
# GitHub will not let a PR's author approve their own PR, so a reviewer posting
# with the author's credential — every agent fleet running on one account — can
# only ever leave a comment. This is what reads it.
#
# Who may write one: a commenter GitHub reports as OWNER, MEMBER or COLLABORATOR,
# or an App (an App can only comment where an admin installed it). Anybody else
# can comment on a public PR, so their markers are ignored outright — a CLEAR
# from a passer-by is not a review, and a BLOCK from one is not a veto.
#
# `reviewer-identity` decides when a CLEAR from the PR author's OWN login counts:
#   distinct-login    never. The reviewer must post as somebody else.
#   distinct-session  when its `session=` names a session that is not one of the
#                     implementer sessions — the `Claude-Session:` trailers on
#                     the PR's commits. No session on the marker, no trailer to
#                     compare against, or a match: `unresolvable`, never clear.
#                     KNOWN GAP: a subagent reports its parent's session id, so
#                     a reviewer spawned as a subagent of the implementing
#                     session is indistinguishable from it and is (correctly)
#                     refused. The reviewer has to run as its own session.
# A BLOCK needs no independence to count: an objection from anyone trusted
# blocks the head it names, whichever rule is set.
IDENTITIES = {"distinct-login", "distinct-session"}
TRUSTED_ASSOCIATIONS = {"OWNER", "MEMBER", "COLLABORATOR"}
_MARKER_RX = re.compile(r"<!--\s*arsenal-review:\s*(.*?)\s*-->", re.DOTALL)
_TRAILER_RX = re.compile(r"^Claude-Session:[ \t]*(\S+)[ \t]*$", re.MULTILINE)
_SHA_RX = re.compile(r"^[0-9a-fA-F]{7,40}$")


def session_key(raw: object) -> str:
    """A session id reduced to the part both spellings share.

    The trailer is a URL (`https://…/session_01AB…`); the environment variable a
    marker is filled from may be the bare id, with or without `session_`.
    """
    if not isinstance(raw, str):
        return ""
    tail = raw.strip().rstrip("/").rsplit("/", 1)[-1]
    return tail.removeprefix("session_")


def implementer_sessions(pr: dict[str, Any]) -> set[str] | None:
    """Session keys from the PR's commit trailers; None when commits were not read."""
    if not isinstance(pr.get("commits"), list):
        return None
    sessions: set[str] = set()
    for commit in _records(pr.get("commits")):
        message = commit.get("message") or _dig(commit, "commit", "message") or ""
        if isinstance(message, str):
            sessions.update(session_key(m) for m in _TRAILER_RX.findall(message))
    sessions.discard("")
    return sessions


def _markers(pr: dict[str, Any]) -> list[dict[str, str]]:
    """Every well-formed marker from a trusted commenter, oldest first."""
    found = []
    for comment in _records(pr.get("comments")):
        raw_user = comment.get("user")
        user: dict[str, Any] = raw_user if isinstance(raw_user, dict) else {}
        trusted = comment.get("author_association") in TRUSTED_ASSOCIATIONS or (
            user.get("type") == "Bot"
        )
        body = comment.get("body")
        if not trusted or not isinstance(body, str):
            continue
        for match in _MARKER_RX.finditer(body):
            fields = dict(pair.split("=", 1) for pair in match.group(1).split() if "=" in pair)
            verdict = fields.get("verdict", "").upper()
            head = fields.get("head", "")
            if verdict not in {"CLEAR", "BLOCK"} or not _SHA_RX.match(head):
                continue
            found.append(
                {
                    "verdict": verdict,
                    "head": head.lower(),
                    "session": session_key(fields.get("session", "")),
                    "login": str(user.get("login") or ""),
                    "id": str(comment.get("id") or "?"),
                }
            )
    return found


def marker_state(pr: dict[str, Any], head: str, identity: str) -> tuple[str, str] | None:
    """(`clear` | `blocked` | `unresolvable`, detail) from the markers on `head`.

    None when no trusted marker names this head — the caller's GitHub-review
    answer then stands unchanged. The latest ELIGIBLE marker decides: a BLOCK
    always is; a CLEAR is when the identity rule accepts its writer. A CLEAR the
    rule refuses never clears, and is reported only when nothing eligible exists.
    """
    head = head.lower()
    on_head = [m for m in _markers(pr) if head and head.startswith(m["head"])]
    if not on_head:
        return None
    author = str(_dig(pr, "user", "login") or "")
    implementers = implementer_sessions(pr)
    refusal = ""
    for marker in reversed(on_head):
        where = f"comment {marker['id']}"
        if marker["verdict"] == "BLOCK":
            return "blocked", f"adversarial review BLOCK on {_short(head)} ({where})"
        if not author:
            refusal = refusal or f"CLEAR on {_short(head)}, but the PR author is unknown ({where})"
            continue
        if marker["login"] != author:
            return "clear", f"adversarial review CLEAR on {_short(head)} by {marker['login']}"
        if identity == "distinct-login":
            refusal = refusal or (
                f"CLEAR on {_short(head)} was written by the PR author's own login "
                f"(reviewer-identity distinct-login) ({where})"
            )
            continue
        session = marker["session"]
        if implementers is None:
            why = "the PR's commits could not be read for Claude-Session trailers"
        elif not implementers:
            why = "no Claude-Session trailer on the PR's commits to compare against"
        elif not session:
            why = "the marker names no reviewer session"
        elif session in implementers:
            why = f"reviewer session {session} is an implementer session"
        else:
            return "clear", (
                f"adversarial review CLEAR on {_short(head)}, cleared via reviewer-identity "
                f"distinct-session: session {session} is none of the {len(implementers)} "
                f"implementer session(s)"
            )
        refusal = refusal or f"CLEAR on {_short(head)} from the author's login: {why} ({where})"
    return "unresolvable", refusal


def check_state(pr: dict[str, Any], head: str) -> tuple[str, str]:
    """(state, detail) for CI on `head`.

    States: `green`, `failing`, `pending`, `absent`, `stale`.

    `absent` is deliberately not `green`. A repo out of runner minutes, with no
    workflows, or whose jobs die before a runner is assigned has produced no
    evidence — and "no failures" is not a pass. Whoever wrote that shortcut into
    a one-line `--jq` got a fleet that merges during a CI outage.
    """
    checks = _records(pr.get("checks"))
    # A check that reported on an earlier push is evidence about that push.
    for_head = [c for c in checks if not c.get("head_sha") or c.get("head_sha") == head]
    if checks and not for_head:
        return "stale", f"{len(checks)} check(s), none on {_short(head)}"
    if not for_head:
        return "absent", "no checks reported"

    failing = [
        str(c.get("name") or "?")
        for c in for_head
        if c.get("status") == "completed" and c.get("conclusion") not in CHECK_OK
    ]
    if failing:
        return "failing", ", ".join(sorted(failing)[:3])
    pending = [c for c in for_head if c.get("status") != "completed"]
    if pending:
        return "pending", f"{len(pending)} of {len(for_head)} still running"
    return "green", f"{len(for_head)} check(s)"


def review_state(
    pr: dict[str, Any], head: str, identity: str = "distinct-session"
) -> tuple[str, str]:
    """(state, detail) for review on `head`: GitHub's reviews, then the markers.

    States: `clear`, `unresolved`, `changes-requested`, `stale`, `absent`, and,
    from a reviewer marker (see marker_state), `blocked` and `unresolvable`.

    The GitHub answer is computed first and is unchanged by markers whenever the
    PR has none on its head. An open thread or a CHANGES_REQUESTED on the head
    still wins over any marker; a BLOCK marker on the head wins over an
    approval; a CLEAR marker stands in for a GitHub review that is absent or
    stale — the second reader that cannot approve because it shares a login.
    """
    github = _github_review_state(pr, head)
    marker = marker_state(pr, head, identity)
    if marker is None or github[0] in {"unresolved", "changes-requested"}:
        return github
    if marker[0] == "blocked":
        return marker
    if github[0] == "clear":
        return github
    open_threads = [t for t in _records(pr.get("threads")) if not t.get("resolved")]
    if marker[0] == "clear" and open_threads:
        return "unresolved", f"{len(open_threads)} open thread(s)"
    return marker


def _github_review_state(pr: dict[str, Any], head: str) -> tuple[str, str]:
    """(state, detail) from GitHub's own reviews and threads on `head`.

    States: `clear`, `unresolved`, `changes-requested`, `stale`, `absent`.

    Two rules from the merge-policy prose are enforced here because prose is
    where they kept being lost. A summary line is not the finding list: a bot can
    report "review completed" while leaving open threads, so unresolved threads
    beat any approval. And a review of an earlier tree is not a review of this
    one — the same rule `adversarial_review.sh check` applies to its receipts.

    Thread resolution is GraphQL-only, so on a REST-or-nothing surface the caller
    cannot supply it. An ABSENT `threads` key therefore says so in the detail and
    does not block, which is the opposite of how an absent check run is treated —
    deliberately. A missing check is a fetchable fact about a repo that produced
    no CI; a missing thread list is a field this channel cannot return, and a
    condition that cannot be satisfied anywhere is not a gate, it is a wall. An
    EMPTY list is a real answer and means no thread is open.
    """
    known = pr.get("threads") is not None
    threads = _records(pr.get("threads"))
    open_threads = [t for t in threads if not t.get("resolved")]
    caveat = "" if known else "; thread state unavailable on this channel"

    reviews = [r for r in _records(pr.get("reviews")) if r.get("state") in REVIEW_VERDICTS]
    if not reviews:
        # Open threads with no verdict is still "nobody has reviewed this": the
        # unresolved count is the more useful thing to say about it.
        if open_threads:
            return "unresolved", f"{len(open_threads)} open thread(s), no verdict"
        return "absent", f"no review{caveat}"

    on_head = [r for r in reviews if not r.get("commit_id") or r.get("commit_id") == head]
    if not on_head:
        latest = _short(reviews[-1].get("commit_id"))
        return "stale", f"reviewed {latest}, head is {_short(head)}"
    if open_threads:
        return "unresolved", f"{len(open_threads)} open thread(s)"
    if any(r.get("state") == "CHANGES_REQUESTED" for r in on_head):
        return "changes-requested", "changes requested on the head"
    return "clear", f"{len(on_head)} review(s) on the head{caveat}"


# GitHub's `mergeable_state` values that block a merge. `blocked` and `unstable`
# are branch protection's and the checks' verdicts, already read on their own.
UNMERGEABLE_STATES = frozenset({"behind", "dirty", "unknown"})


def _next_action(pr: dict[str, Any], audit: dict[str, Any], policy: str) -> str:
    """The single thing to do next. Ordered by what blocks what."""
    if pr.get("draft"):
        return "mark ready for review (it is a draft)"
    if pr.get("mergeable") is False or pr.get("mergeable_state") == "dirty":
        return "merge the base branch in and resolve the conflict"
    if pr.get("mergeable_state") == "behind":
        return "update the branch from base — CI ran on an old base, so the merge is untested"
    if pr.get("mergeable_state") == "unknown":
        return "wait — GitHub has not computed mergeability yet; re-run"

    ci, ci_detail = audit["ci"], audit["ci_detail"]
    if policy in {"after-ci", "after-ci-and-review"}:
        if ci == "failing":
            return f"fix the failing check: {ci_detail}"
        if ci == "pending":
            return f"wait — {ci_detail}"
        if ci == "stale":
            return f"push or re-run: {ci_detail}"
        if ci == "absent":
            return "no checks reported on the head — absent is not green, so this is blocked"

    review, review_detail = audit["review"], audit["review_detail"]
    if policy in {"after-review", "after-ci-and-review"}:
        if review == "unresolved":
            return f"answer or fix {review_detail}"
        if review == "changes-requested":
            return "address the requested changes, then re-request review"
        if review == "stale":
            return (
                f"re-read the head: claim_review.sh {pr.get('number')} <head-sha> ({review_detail})"
            )
        if review == "absent":
            # No bot or human review on the head: a clearing adversarial review
            # published for it is the review (#507).
            return (
                f"dispatch a second reader: claim_review.sh {pr.get('number')} <head-sha>, "
                f"then adversarial_review.sh marker --post {pr.get('number')}"
            )
        if review == "blocked":
            return "fix the adversarial review's BLOCK findings, then have the new head re-read"
        if review == "unresolvable":
            return (
                f"the review marker cannot clear this head ({review_detail}) — have a reviewer "
                f"running as its own session read it: claim_review.sh {pr.get('number')} <head-sha>"
            )

    if "tier_ok" in audit and not audit["tier_ok"]:
        if audit["approval"] not in ("auto",) and review != "clear":
            return (
                f"{audit['tier']}-risk PR needs an agent review first: "
                f"claim_review.sh {pr.get('number')} <head-sha>"
            )
        missing = audit["humans_required"] - len(audit["humans_on_head"])
        return f"{audit['tier']}-risk PR waits on {missing} human approval(s) on the head"

    if policy == "never":
        return "ready — merge-policy is `never`, so a human merges"
    return "merge"


def audit_pr(
    pr: dict[str, Any],
    policy: str,
    identity: str = "distinct-session",
    review_cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    head = _dig(pr, "head", "sha") or ""
    ci, ci_detail = check_state(pr, str(head))
    review, review_detail = review_state(pr, str(head), identity)

    ci_ok = ci == "green"
    review_ok = review == "clear"
    needs_ci = policy in {"after-ci", "after-ci-and-review"}
    needs_review = policy in {"after-review", "after-ci-and-review"}

    ready = (
        not pr.get("draft")
        and pr.get("mergeable") is not False
        and pr.get("mergeable_state") not in UNMERGEABLE_STATES
        and (ci_ok or not needs_ci)
        and (review_ok or not needs_review)
    )

    result = {
        "number": pr.get("number"),
        "title": pr.get("title") or "",
        "head": str(head),
        "branch": _dig(pr, "head", "ref") or "",
        "draft": bool(pr.get("draft")),
        "mergeable": pr.get("mergeable"),
        "mergeable_state": pr.get("mergeable_state"),
        "age_hours": _age_hours(pr.get("created_at")),
        "idle_hours": _age_hours(pr.get("updated_at") or pr.get("created_at")),
        "ci": ci,
        "ci_detail": ci_detail,
        "review": review,
        "review_detail": review_detail,
        "ready": ready,
    }
    if review_cfg is not None:
        result.update(tier_state(pr, str(head), review, review_detail, review_cfg, identity))
        result["ready"] = ready and result["tier_ok"]
    result["next_action"] = _next_action(pr, result, policy)
    return result


def stale_claims(
    claims: Iterable[dict[str, Any]], audits: list[dict[str, Any]], stale_hours: float
) -> list[dict[str, Any]]:
    """Claims held longer than `stale_hours` with no open PR behind them.

    A claim ref cannot be deleted from a sandboxed session, which is the right
    trade — a crashed session blocks nothing, because the next attempt takes the
    next ref. The cost is that the ref outlives the work, so nothing anywhere
    says "this task is claimed and no session is on it". This does.
    """
    open_tasks = {a.get("branch", "").rsplit("/", 1)[-1] for a in audits}
    open_prs = {a.get("number") for a in audits}
    stale = []
    for claim in claims:
        task_id = str(claim.get("task_id") or claim.get("ref", "").rsplit("/", 1)[-1])
        age = _age_hours(claim.get("created_at"))
        if claim.get("pr") in open_prs or task_id in open_tasks:
            continue
        if age is None or age < stale_hours:
            continue
        stale.append({"task_id": task_id, "ref": claim.get("ref", ""), "age_hours": age})
    return stale


def _load(path: str) -> Any:
    text = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise AuditError(f"{path}: not JSON ({exc})") from exc


def _hours(value: float | None) -> str:
    return "?" if value is None else (f"{value:.0f}h" if value < 96 else f"{value / 24:.0f}d")


def render(audits: list[dict[str, Any]], stale: list[dict[str, Any]], policy: str) -> str:
    lines = [f"pr_audit: {len(audits)} open PR(s), merge-policy `{policy}`", ""]
    if not audits:
        lines.append("  (nothing open)")
    for a in audits:
        flag = "READY" if a["ready"] else "WAIT "
        lines.append(
            f"  {flag} #{a['number']} {_short(a['head'])} {_hours(a['age_hours'])} "
            f"{a['title'][:52]}"
        )
        lines.append(f"        ci: {a['ci']} ({a['ci_detail']})")
        lines.append(f"        review: {a['review']} ({a['review_detail']})")
        if "tier" in a:
            humans = f"{len(a['humans_on_head'])}/{a['humans_required']} human"
            lines.append(f"        tier: {a['tier']} → {a['approval']} ({humans})")
        if a["mergeable"] is False:
            lines.append("        mergeable: CONFLICT")
        elif a.get("mergeable_state") in UNMERGEABLE_STATES:
            lines.append(f"        mergeable: {a['mergeable_state'].upper()}")
        lines.append(f"        → {a['next_action']}")
    if stale:
        lines.append("")
        lines.append(f"  {len(stale)} claim(s) with no open PR:")
        for claim in stale:
            lines.append(
                f"    {claim['task_id']} held {_hours(claim['age_hours'])} ({claim['ref']})"
            )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit open PRs against the merge policy.")
    parser.add_argument("--prs", default="-", help="JSON array of PR records, or - for stdin")
    parser.add_argument("--claims", help="JSON array of held claim refs")
    parser.add_argument("--repo-root", type=Path, default=Path())
    parser.add_argument("--policy", choices=sorted(POLICIES), help="override arsenal/config.toml")
    parser.add_argument("--pr", type=int, help="narrow the report to one PR")
    parser.add_argument("--stale-hours", type=float, default=24.0)
    parser.add_argument(
        "--require-ready",
        action="store_true",
        help="exit 1 unless every reported PR is ready to merge",
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    try:
        policy = args.policy or read_policy(args.repo_root)
        identity = read_reviewer_identity(args.repo_root)
        review_cfg = read_review_cfg(args.repo_root)
        payload = _load(args.prs)
        claims = _records(_load(args.claims)) if args.claims else []
    except AuditError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    prs = _records(payload)
    if not isinstance(payload, list):
        print("error: --prs must hold a JSON array of PR records", file=sys.stderr)
        return 2
    if args.pr is not None:
        prs = [p for p in prs if p.get("number") == args.pr]
        if not prs:
            print(f"error: no PR #{args.pr} in the payload", file=sys.stderr)
            return 2

    audits = [audit_pr(pr, policy, identity, review_cfg) for pr in prs]
    stale = stale_claims(claims, audits, args.stale_hours)

    if args.json:
        print(json.dumps({"policy": policy, "prs": audits, "stale_claims": stale}, indent=2))
    else:
        print(render(audits, stale, policy))

    if args.require_ready:
        # `never` is not a verdict about the PR: it is the host saying no agent
        # merges here. Reporting it as "not ready" would send a session off to
        # fix conditions that are already met.
        if policy == "never":
            return 3
        return 0 if all(a["ready"] for a in audits) else 1
    return 0


if __name__ == "__main__":
    # Windows consoles default to a legacy codepage (cp1252 and friends);
    # a non-ASCII line must degrade to "?", never take the process down.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
