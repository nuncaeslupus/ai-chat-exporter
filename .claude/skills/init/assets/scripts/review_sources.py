#!/usr/bin/env python3
"""review_sources.py — what CI and the review bots did on a PR, and what that leaves.

Reads the PR's head, its check runs and commit statuses, the bots' reviews and
comments (current bodies, so a notice edited into an old summary comment
counts), and the changed files. Classifies each source, then prints the one
decision every caller follows: how deep the local review goes and whether the
local full suite runs.

Usage:
    review_sources.py --pr N [--repo owner/name] [--json] [--trigger] [--fixture DIR]

Output, one line per source, then the decision:
    ci              ok            3 checks green on 1a2b3c4
    bot:reviewer-a  unavailable   skipped: "review skipped" (status reviewer-a)
    bot:reviewer-b  absent        no activity 24 min after head push (bot-wait-min 20)
    decision        local-review=diff  full-suite=skip  reason=ci ok, no bot review ...

States: CI ok | failing | pending | absent. Bot ok | pending | unavailable |
absent. `unavailable` is a bot that said it will not review this head — rate
limit, plan or free-tier cap, a skip ("fewer than N stars", automatic reviews
off), a pause — and is never `pending`: its own notice is the answer, so the
decision falls through to the local review instead of waiting on it. Which of
those it was is the detail's first word and `extra.reason` (rate-limited |
skipped | paused). A bot is `absent` once it has been silent on this head for
bot-wait-min after the head push. With --trigger, a skipped, paused or
first-time absent bot gets its `bot-triggers` comment once per head (recorded
under tmp/arsenal-review/pr-<N>/), and is pending for one more wait; silence
after that is final. A notice the bot posts after that trigger is its answer to
it (an acknowledgement), so it waits that one wait too; only a rate limit there
is final. A rate-limited bot is never pinged.

Head push time: GitHub does not expose it directly, so it is the earliest
check run or status reported on the head SHA (CI starts on push), never earlier
than the head commit's committer date; with no checks at all, the committer
date alone.

Config (arsenal/config.toml): verification, bot-wait-min, bot-triggers,
risk-paths, risk-lines, review-bots, bot-unavailable-notices.

--fixture DIR reads the gh JSON from files instead (pr.json, commit.json,
check_runs.json, statuses.json, reviews.json, review_comments.json,
issue_comments.json, files.json; a missing file is an empty list).
REVIEW_SOURCES_NOW (ISO time) pins the clock, for tests.

Exit: 0 on a classification, 2 on an error (no gh, unreadable config).
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import arsenal_config
import review_policy

# --- notice table --------------------------------------------------------------
# Every phrase that turns a bot's text into a state lives here, so a vendor that
# rewords its notice is one row, not a code change. Case-insensitive. A row with
# a bot login applies to that bot only; None applies to every bot. First match in
# table order wins, which is why the limit rows come before the skip rows.
# "paused" is reported as skipped (the remedy is the same: one manual command),
# with the bot's resume command used as the trigger where BOTS names one.
NOTICES: list[tuple[str, str, str | None]] = [
    # A bot rewrites its summary comment to say it is working (seen on
    # CodeRabbit right after a manual trigger); the review is on its way.
    ("in-progress", r"review in progress by", None),
    ("in-progress", r"currently processing new changes", None),
    ("rate-limited", r"rate[- ]?limit", None),
    ("rate-limited", r"\bquota\b", None),
    ("rate-limited", r"usage limit", None),
    ("rate-limited", r"try again in", None),
    ("rate-limited", r"review limit reached", None),
    ("rate-limited", r"next included review available", None),
    ("rate-limited", r"fair usage limit", None),
    ("rate-limited", r"(limit|quota)\s+(has been\s+|was\s+)?exceeded", None),
    (
        "rate-limited",
        r"free[- ](tier|plan)\b[^.\n]{0,80}\b(limit|cap|quota|reached|exhausted)",
        None,
    ),
    # A bot acknowledging an on-demand command ("Review triggered.") before the
    # review lands. Ahead of the skip rows: the acknowledgement often explains
    # when the command applies ("only when automatic reviews are paused"), and
    # that explanation is not a statement about this PR.
    ("in-progress", r"review\s+triggered", None),
    ("in-progress", r"review\s+(has\s+been\s+)?(requested|queued|started)", None),
    ("paused", r"reviews?\s+paused", None),
    ("skipped", r"does not receive automatic reviews", None),
    ("skipped", r"reviews?\s+skipped", None),
    ("skipped", r"skipping review", None),
    ("skipped", r"auto(matic)?[- ]reviews?\s+(are|is)\s+(disabled|paused|turned off)", None),
    ("skipped", r"fewer than\s+\d+\s+(github\s+)?stars", None),
]
_NOTICE_RX = [(kind, re.compile(rx, re.IGNORECASE), bot) for kind, rx, bot in NOTICES]


def extra_notices(patterns: list[str]) -> list[tuple[str, re.Pattern[str], str | None]]:
    """`bot-unavailable-notices` rows: a host's own phrases, read as a skip.

    The table above is a starting list, not a claim about every reviewer: a bot
    that words its notice differently would otherwise read as silence and hold
    the loop for bot-wait-min. Appended after the shipped rows, so an in-progress
    notice still wins, and classified `skipped` — one trigger, then final.
    """
    return [("skipped", re.compile(rx, re.IGNORECASE), None) for rx in patterns]


# --- per-bot quirks ------------------------------------------------------------
# Keyed by bare login (no "[bot]"). `checks` matches the names/contexts of the
# bot's own check runs and statuses, which are review evidence, not CI.
# `resume` replaces the configured trigger when the bot is paused.
# A trigger of "request-reviewer" asks GitHub to request the bot as a reviewer
# (Copilot's mechanism) instead of posting a comment.
@dataclass(frozen=True)
class BotInfo:
    checks: str = ""
    resume: str = ""


BOTS: dict[str, BotInfo] = {
    "coderabbitai": BotInfo(checks=r"coderabbit", resume="@coderabbitai resume"),
    "gemini-code-assist": BotInfo(checks=r"gemini"),
    "claude": BotInfo(checks=r"^claude"),
    "copilot-pull-request-reviewer": BotInfo(checks=r"copilot"),
}

# A change made only of these is docs/config-only: nothing a test can exercise.
# Kept narrow on purpose — workflow files, build config and lockfiles change
# behaviour and are NOT in it.
# What counts as docs/config only is shared with review_policy.py's low tier.
DOCS_ONLY_GLOBS = review_policy.DOCS_ONLY_GLOBS

CI_FAIL = {"failure", "timed_out", "cancelled", "action_required", "startup_failure", "error"}


class SourceError(Exception):
    """gh missing or failing, or the config unreadable — exit 2."""


def norm(login: str | None) -> str:
    """Bare login: REST keeps `[bot]`, GraphQL and `gh pr view` drop it."""
    if not login:
        return ""
    login = login.strip()
    return login[:-5] if login.endswith("[bot]") else login


def parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def now() -> datetime:
    return parse_ts(os.environ.get("REVIEW_SOURCES_NOW")) or datetime.now(UTC)


def match_notice(
    text: str, login: str, extra: list[tuple[str, re.Pattern[str], str | None]] | None = None
) -> tuple[str, str] | None:
    """(kind, matched phrase) for the first notice row that matches, else None."""
    for kind, rx, bot in [*_NOTICE_RX, *(extra or [])]:
        if bot is not None and norm(bot) != login:
            continue
        m = rx.search(text or "")
        if m:
            return kind, m.group(0)
    return None


# --- fetching ------------------------------------------------------------------
def _decode_all(out: str) -> list[Any]:
    """Concatenated JSON values (what `gh api --paginate` prints) → one list."""
    results: list[Any] = []
    decoder = json.JSONDecoder()
    pos = 0
    out = out.strip()
    while pos < len(out):
        while pos < len(out) and out[pos].isspace():
            pos += 1
        if pos >= len(out):
            break
        obj, pos = decoder.raw_decode(out, pos)
        if isinstance(obj, list):
            results.extend(obj)
        else:
            results.append(obj)
    return results


def _gh(*args: str) -> str:
    if shutil.which("gh") is None:
        raise SourceError("gh CLI not found in PATH")
    try:
        return subprocess.check_output(["gh", *args], text=True, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as exc:
        raise SourceError(f"gh {' '.join(args)} failed: {(exc.stderr or '').strip()}") from exc


class Source:
    """Where the PR data comes from: gh, or a fixture directory."""

    def __init__(self, pr: int, repo: str | None, fixture: Path | None) -> None:
        self.pr = pr
        self.fixture = fixture
        self.repo = repo

    def _file(self, name: str, default: Any) -> Any:
        assert self.fixture is not None
        path = self.fixture / name
        if not path.is_file():
            return default
        return json.loads(path.read_text(encoding="utf-8"))

    def _repo(self) -> str:
        if self.repo is None:
            data = json.loads(_gh("repo", "view", "--json", "nameWithOwner"))
            self.repo = str(data["nameWithOwner"])
        return self.repo

    def one(self, name: str, endpoint: str) -> dict[str, Any]:
        if self.fixture is not None:
            return dict(self._file(name, {}))
        return dict(json.loads(_gh("api", endpoint.format(repo=self._repo(), pr=self.pr))))

    def many(self, name: str, endpoint: str, jq: str | None = None) -> list[dict[str, Any]]:
        if self.fixture is not None:
            return list(self._file(name, []))
        args = ["api", "--paginate", endpoint.format(repo=self._repo(), pr=self.pr)]
        if jq:
            args += ["--jq", jq]
        return _decode_all(_gh(*args))

    def collect(self) -> dict[str, Any]:
        pr = self.one("pr.json", "repos/{repo}/pulls/{pr}")
        sha = str((pr.get("head") or {}).get("sha") or "")
        if not sha:
            raise SourceError(f"PR #{self.pr}: no head SHA")
        return {
            "pr": pr,
            "head": sha,
            "commit": self.one("commit.json", "repos/{repo}/commits/" + sha),
            "check_runs": self.many(
                "check_runs.json", "repos/{repo}/commits/" + sha + "/check-runs", ".check_runs"
            ),
            "statuses": self.many("statuses.json", "repos/{repo}/commits/" + sha + "/statuses"),
            "reviews": self.many("reviews.json", "repos/{repo}/pulls/{pr}/reviews"),
            "review_comments": self.many(
                "review_comments.json", "repos/{repo}/pulls/{pr}/comments"
            ),
            "issue_comments": self.many("issue_comments.json", "repos/{repo}/issues/{pr}/comments"),
            "files": self.many("files.json", "repos/{repo}/pulls/{pr}/files"),
        }


# --- classification -------------------------------------------------------------
@dataclass
class Verdict:
    state: str
    detail: str
    login: str = ""
    final: bool = True
    triggered_at: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


def _owner_of_check(name: str, app_or_creator: str, bots: list[str]) -> str:
    """The bare bot login a check run / status belongs to, or "" for CI."""
    who = norm(app_or_creator)
    for bot in bots:
        if who and who == bot:
            return bot
        pattern = BOTS.get(bot, BotInfo()).checks
        if pattern and re.search(pattern, name or "", re.IGNORECASE):
            return bot
    return ""


def head_pushed_at(data: dict[str, Any]) -> datetime:
    committed = parse_ts(
        ((data["commit"].get("commit") or {}).get("committer") or {}).get("date")
    ) or datetime.fromtimestamp(0, UTC)
    seen = [
        t
        for t in (
            *(parse_ts(c.get("started_at") or c.get("created_at")) for c in data["check_runs"]),
            *(parse_ts(s.get("created_at")) for s in data["statuses"]),
        )
        if t is not None
    ]
    return max(committed, min(seen)) if seen else committed


def classify_ci(data: dict[str, Any], bots: list[str]) -> Verdict:
    states: list[tuple[str, str]] = []
    for c in data["check_runs"]:
        if _owner_of_check(c.get("name", ""), (c.get("app") or {}).get("slug", ""), bots):
            continue
        if (c.get("status") or "").lower() != "completed":
            states.append(("pending", c.get("name", "")))
            continue
        concl = (c.get("conclusion") or "").lower()
        states.append(("failing" if concl in CI_FAIL else "ok", c.get("name", "")))
    seen_contexts: set[str] = set()
    for s in data["statuses"]:  # newest first: the first per context is current
        ctx = s.get("context", "")
        if ctx in seen_contexts:
            continue
        seen_contexts.add(ctx)
        if _owner_of_check(ctx, (s.get("creator") or {}).get("login", ""), bots):
            continue
        st = (s.get("state") or "").lower()
        states.append(("ok" if st == "success" else "failing" if st in CI_FAIL else "pending", ctx))
    short = data["head"][:7]
    if not states:
        return Verdict("absent", f"no checks reported on {short}")
    failing = [n for s, n in states if s == "failing"]
    if failing:
        return Verdict("failing", f"{', '.join(failing)} failed on {short}")
    pending = [n for s, n in states if s == "pending"]
    if pending:
        return Verdict("pending", f"{len(pending)} of {len(states)} checks running on {short}")
    return Verdict("ok", f"{len(states)} checks green on {short}")


def _trigger_file(state_dir: Path, login: str, head: str) -> Path:
    return state_dir / f"trigger-{re.sub(r'[^A-Za-z0-9._-]', '_', login)}-{head}"


def classify_bot(
    login: str,
    data: dict[str, Any],
    pushed: datetime,
    at: datetime,
    wait_min: int,
    state_dir: Path,
    extra: list[tuple[str, re.Pattern[str], str | None]] | None = None,
) -> Verdict:
    """One bot's state on this head. `login` is bare (no [bot])."""
    head = data["head"]

    # 1. A review (or line comment) on this head is the bot having looked.
    for r in data["reviews"]:
        if norm((r.get("user") or r.get("author") or {}).get("login")) == login and (
            r.get("commit_id") == head
        ):
            return Verdict("ok", f"reviewed {head[:7]} (review {r.get('id', '?')})", login)
    for c in data["review_comments"]:
        if norm((c.get("user") or {}).get("login")) == login and (
            c.get("commit_id") == head or c.get("original_commit_id") == head
        ):
            return Verdict("ok", f"commented on {head[:7]} (comment {c.get('id', '?')})", login)

    # 2. Notices: the bot's statuses/checks on this head, and its comments and
    #    review bodies as they read now. The latest notice wins. A rate limit
    #    from before this push is about an earlier head; a skip or pause holds
    #    until the bot acts again.
    notices: list[tuple[datetime, str, str, str]] = []
    own_checks: list[dict[str, Any]] = []
    for s in data["statuses"]:
        if _owner_of_check(
            s.get("context", ""), (s.get("creator") or {}).get("login", ""), [login]
        ):
            own_checks.append({"kind": "status", "name": s.get("context", ""), **s})
    for c in data["check_runs"]:
        if _owner_of_check(c.get("name", ""), (c.get("app") or {}).get("slug", ""), [login]):
            out = c.get("output") or {}
            text = f"{out.get('title') or ''}\n{out.get('summary') or ''}"
            own_checks.append({"kind": "check", "description": text.strip(), **c})
    for oc in own_checks:
        hit = match_notice(oc.get("description") or "", login, extra)
        if hit:
            ts = parse_ts(oc.get("created_at") or oc.get("started_at")) or pushed
            notices.append((ts, hit[0], hit[1], f"{oc['kind']} {oc.get('name', '')}"))
    for c in data["issue_comments"]:
        if norm((c.get("user") or {}).get("login")) != login:
            continue
        hit = match_notice(c.get("body") or "", login, extra)
        if hit:
            ts = parse_ts(c.get("updated_at") or c.get("created_at")) or pushed
            notices.append((ts, hit[0], hit[1], f"comment {c.get('id', '?')}"))
    for r in data["reviews"]:
        if norm((r.get("user") or r.get("author") or {}).get("login")) != login:
            continue
        hit = match_notice(r.get("body") or "", login, extra)
        if hit:
            ts = parse_ts(r.get("submitted_at")) or pushed
            notices.append((ts, hit[0], hit[1], f"review {r.get('id', '?')}"))
    notices = [n for n in notices if n[1] != "rate-limited" or n[0] >= pushed]

    trig = _trigger_file(state_dir, login, head)
    triggered = parse_ts(trig.read_text(encoding="utf-8").strip()) if trig.is_file() else None
    triggered_s = triggered.isoformat() if triggered else ""

    # A notice the bot posted after our own trigger on this head answers that
    # trigger: an acknowledgement, whatever its wording. Only a rate limit is
    # final there; anything else waits one bot-wait-min like an in-progress
    # notice and then ends as absent, never as a final skip (#513).
    if triggered is not None:
        notices = [
            (ts, "in-progress", phrase, f"{where}, after trigger")
            if ts > triggered and kind != "rate-limited"
            else (ts, kind, phrase, where)
            for ts, kind, phrase, where in notices
        ]

    if notices:
        ts, kind, phrase, where = max(notices, key=lambda n: n[0])
        # Working, by its own account: pending, but on the same clock as silence
        # (from the later of the notice and the trigger), so a stuck "in
        # progress" still ends as absent.
        if kind == "in-progress":
            since_notice = int((at - max(ts, triggered or ts)).total_seconds() // 60)
            if since_notice < wait_min:
                return Verdict(
                    "pending",
                    f'"{phrase}" ({where}), {since_notice} of {wait_min} min',
                    login,
                    triggered_at=triggered_s,
                )
            notices = [n for n in notices if n[1] != "in-progress"]
    if notices:
        ts, kind, phrase, where = max(notices, key=lambda n: n[0])
        if triggered is None or ts > triggered:
            # Never `pending`: the bot said it will not review this head, so
            # waiting on it is waiting for nothing (#507).
            return Verdict(
                "unavailable",
                f'{kind}: "{phrase}" ({where})',
                login,
                final=kind == "rate-limited",
                triggered_at=triggered_s,
                extra={"reason": kind, "paused": kind == "paused"},
            )

    # 3. The bot's own check finished on this head with no notice: it reviewed.
    #    Except a neutral finish with no output — a known timeout, not a review.
    for oc in own_checks:
        if oc["kind"] == "status":
            st = (oc.get("state") or "").lower()
            done, good = st != "pending", st == "success"
        else:
            done = (oc.get("status") or "").lower() == "completed"
            concl = (oc.get("conclusion") or "").lower()
            empty = not (oc.get("description") or "").strip()
            if done and concl == "neutral" and empty:
                return Verdict(
                    "absent",
                    f"check {oc.get('name', '')} finished neutral with no output",
                    login,
                    final=triggered is not None,
                    triggered_at=triggered_s,
                )
            good = concl in ("success", "neutral")
        if done and good:
            return Verdict(
                "ok", f"{oc['kind']} {oc.get('name', '')} completed on {head[:7]}", login
            )

    # 4. Silence (or still pending): bounded by bot-wait-min from the head push,
    #    and once more from a trigger.
    anchor = triggered or pushed
    waited = int((at - anchor).total_seconds() // 60)
    requested = any(
        norm(u.get("login")) == login for u in (data["pr"].get("requested_reviewers") or [])
    )
    since = "trigger" if triggered else "head push"
    if waited < wait_min:
        why = "review requested" if requested else "no review yet"
        return Verdict(
            "pending",
            f"{why}, {waited} of {wait_min} min since {since}",
            login,
            final=False,
            triggered_at=triggered_s,
        )
    return Verdict(
        "absent",
        f"no activity {waited} min after {since} (bot-wait-min {wait_min})",
        login,
        final=triggered is not None,
        triggered_at=triggered_s,
    )


# --- risk and decision ----------------------------------------------------------
def assess_risk(
    files: list[dict[str, Any]],
    risk_paths: list[str],
    risk_lines: int,
    human_paths: list[str] | None = None,
) -> tuple[bool, bool, int, list[str]]:
    """(risk_high, docs_only, changed_lines, risky_paths).

    High is review_policy's high tier, so review depth and who approves agree.
    """
    cls = review_policy.classify(
        files,
        {
            "risk-paths": risk_paths,
            "risk-lines": risk_lines,
            "review.always-human-paths": human_paths or [],
            "review.low-paths": [],
        },
    )
    names = [str(f.get("filename", "")) for f in files]
    risky = [n for n in names if any(fnmatch.fnmatch(n, g) for g in risk_paths)]
    docs_only = bool(names) and all(
        any(fnmatch.fnmatch(n, g) for g in DOCS_ONLY_GLOBS) for n in names
    )
    return cls["tier"] == "high", docs_only, cls["lines"], risky


def decide(
    profile: str, ci: str, bots: list[str], risk_high: bool, docs_only: bool
) -> tuple[str, str, str]:
    """(local_review none|diff|full, full_suite skip|run, reason). Pure.

    profile  fast | balanced | strict
    ci       ok | failing | pending | absent  (pending is decided as ok; the
             caller treats the line as provisional until CI settles)
    bots     the state of each configured bot
    """
    bot_ok = "ok" in bots
    risk = "high-risk diff" if risk_high else "low-risk diff"
    if profile == "strict":
        if docs_only:
            return "diff", "run", "strict: docs-only still gets a diff review"
        depth = "full" if risk_high else "diff"
        return depth, "run", f"strict: always a local review, {risk}"
    if docs_only:
        return "none", "skip", "docs/config-only diff"
    if ci in ("absent", "failing"):
        depth = "full" if risk_high else "diff"
        return depth, "run", f"ci {ci}: local review and full suite, {risk}"
    if bot_ok:
        if risk_high:
            return "diff", "skip", f"ci {ci}, bot reviewed, {risk}"
        return "none", "skip", f"ci {ci}, bot reviewed, {risk}"
    if profile == "fast" and not risk_high:
        return "none", "skip", f"fast: ci {ci}, no bot review, {risk}"
    depth = "full" if risk_high else "diff"
    return depth, "skip", f"ci {ci}, no bot review, {risk}"


# --- triggers ------------------------------------------------------------------
def trigger_map(entries: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for entry in entries:
        login, _, comment = entry.partition("=")
        if login.strip() and comment.strip():
            out[norm(login)] = comment.strip()
    return out


def post_triggers(
    pr: int,
    repo: str | None,
    verdicts: list[Verdict],
    triggers: dict[str, str],
    head: str,
    state_dir: Path,
    at: datetime,
) -> list[str]:
    """Send each eligible bot its trigger, once per head. Returns logins pinged.

    Eligible: unavailable because skipped or paused, or absent, with no trigger
    sent on this head yet. A rate-limited bot is not pinged — its notice is the
    answer until the window passes. The state file is written before posting,
    so a failed post is not retried every tick.
    """
    posted: list[str] = []
    for v in verdicts:
        skipped = v.state == "unavailable" and v.extra.get("reason") in ("skipped", "paused")
        if not (skipped or v.state == "absent") or v.login not in triggers:
            continue
        marker = _trigger_file(state_dir, v.login, head)
        if marker.exists():
            continue
        command = triggers[v.login]
        if v.extra.get("paused") and BOTS.get(v.login, BotInfo()).resume:
            command = BOTS[v.login].resume
        state_dir.mkdir(parents=True, exist_ok=True)
        marker.write_text(at.isoformat() + "\n", encoding="utf-8")
        # REST, not `gh pr comment`: some sandboxed sessions refuse GraphQL.
        if not repo:
            repo = json.loads(_gh("repo", "view", "--json", "nameWithOwner"))["nameWithOwner"]
        if command == "request-reviewer":
            _gh(
                "api",
                "-X",
                "POST",
                f"repos/{repo}/pulls/{pr}/requested_reviewers",
                "-f",
                f"reviewers[]={v.login}[bot]",
            )
        else:
            _gh("api", "-X", "POST", f"repos/{repo}/issues/{pr}/comments", "-f", f"body={command}")
        v.state, v.final, v.triggered_at = "pending", False, at.isoformat()
        v.detail = f"trigger sent ({command}); waiting one more bot-wait-min"
        posted.append(v.login)
    return posted


# --- entry point ----------------------------------------------------------------
@dataclass
class Report:
    pr: int
    head: str
    head_pushed_at: str
    ci: Verdict
    bots: list[Verdict]
    risk_high: bool
    docs_only: bool
    changed_lines: int
    risky_paths: list[str]
    decision: dict[str, Any]
    triggers_posted: list[str]

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def run(
    pr: int,
    repo: str | None = None,
    fixture: Path | None = None,
    trigger: bool = False,
    watch_bots: list[str] | None = None,
    repo_root: Path | None = None,
) -> Report:
    """Collect, classify, optionally trigger, decide. Raises SourceError."""
    root = repo_root or Path.cwd()
    try:
        cfg, _ = arsenal_config.load(root)
    except (arsenal_config.ConfigError, OSError) as exc:
        raise SourceError(f"config: {exc}") from exc
    bots = [norm(b) for b in (watch_bots if watch_bots is not None else cfg["review-bots"])]
    bots = [b for b in bots if b]
    wait_min = int(cfg["bot-wait-min"])
    state_dir = root / "tmp" / "arsenal-review" / f"pr-{pr}"

    data = Source(pr, repo, fixture).collect()
    at = now()
    pushed = head_pushed_at(data)
    ci = classify_ci(data, [*bots, *BOTS])  # a known bot's own check is never CI
    extra = extra_notices(cfg["bot-unavailable-notices"])
    verdicts = [classify_bot(b, data, pushed, at, wait_min, state_dir, extra) for b in bots]
    posted: list[str] = []
    if trigger:
        posted = post_triggers(
            pr, repo, verdicts, trigger_map(cfg["bot-triggers"]), data["head"], state_dir, at
        )
    risk_high, docs_only, lines, risky = assess_risk(
        data["files"], cfg["risk-paths"], int(cfg["risk-lines"]), cfg["review.always-human-paths"]
    )
    local, suite, reason = decide(
        cfg["verification"], ci.state, [v.state for v in verdicts], risk_high, docs_only
    )
    reason += f", {lines} changed lines"
    provisional = ci.state == "pending" or any(v.state == "pending" for v in verdicts)
    if provisional:
        reason += " (provisional: a source is still pending)"
    return Report(
        pr=pr,
        head=data["head"],
        head_pushed_at=pushed.isoformat(),
        ci=ci,
        bots=verdicts,
        risk_high=risk_high,
        docs_only=docs_only,
        changed_lines=lines,
        risky_paths=risky,
        decision={
            "local_review": local,
            "full_suite": suite,
            "reason": reason,
            "final": not provisional,
            "profile": cfg["verification"],
        },
        triggers_posted=posted,
    )


def render(report: Report) -> str:
    rows = [("ci", report.ci.state, report.ci.detail)]
    rows += [(f"bot:{v.login}", v.state, v.detail) for v in report.bots]
    d = report.decision
    lines = [f"{label:<15} {state:<13} {detail}" for label, state, detail in rows]
    lines.append(
        f"{'decision':<15} local-review={d['local_review']}  full-suite={d['full_suite']}  "
        f"reason={d['reason']}"
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    p.add_argument("--pr", required=True, type=int)
    p.add_argument("--repo", help="owner/name (defaults to the current repo)")
    p.add_argument("--json", action="store_true", help="print the report as JSON")
    p.add_argument("--trigger", action="store_true", help="post each due bot trigger once")
    p.add_argument("--fixture", type=Path, help="read gh JSON from this directory")
    args = p.parse_args(argv)
    try:
        report = run(args.pr, args.repo, args.fixture, args.trigger)
    except (SourceError, json.JSONDecodeError) as exc:
        print(f"review_sources: {exc}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(report.as_dict(), indent=2))
    else:
        print(render(report))
    return 0


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
