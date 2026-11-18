#!/usr/bin/env python3
"""usage_report.py — what a fleet of sessions actually spent, per session and per model.

`bin/budget_check.sh` asks the forward question: may the loop dispatch another
worker right now? It reads `rate_limits.json`, which is a *percentage of a window
remaining* and says nothing about where the tokens went. This script asks the
backward one — **what consumed the window** — out of the transcripts Claude Code
already writes, so that "the quota vanished" has a one-command answer instead of
a hand-parse after the fact.

That distinction is the reason this exists at all. A day of nine concurrent
sessions burned two five-hour windows while every visible setting read as
correct: `models.workers = "sonnet"` was set, documented, and reached no
dispatcher, so every worker ran on the orchestrator's model. Nothing in the
bundle could have shown that, because nothing in the bundle looked at what the
turns actually cost. The per-model table below is the check that would have.

## What is counted, and why it is context rather than output

Cost here is `turns x context`, not output. A turn that writes 500 tokens after
reading 400,000 is charged for the 400,000; across a fleet the ratio ran 438M
read against 1.3M written. So the headline number per turn is:

    context = input_tokens + cache_read_input_tokens + cache_creation_input_tokens

which is everything the model had to be handed to produce that turn. `output` is
reported beside it rather than added into it, because the two respond to
completely different levers: output falls when a session is asked to say less,
context falls when a session is asked to *hold* less — a smaller auto-compact
window, a narrower fetch, a reference instead of a paragraph.

## Sidechains are counted, and named

A dispatched subagent's turns are NOT in the dispatching session's transcript.
They sit a directory deeper, in `<project>/<session>/subagents/agent-*.jsonl`,
marked `isSidechain: true` and carrying the *parent's* `sessionId` — so they
belong to that session's bill and are counted into it.

They also get their own line, because they are the only direct evidence of what
model a dispatch actually ran as. `models.workers` says what should have been
used; this says what was.

## --actions: the other meter

The same backward question for GitHub Actions minutes (#463), which a private
repo on GitHub Free has 2,000 of a month and a busy review loop can spend in
days. `--actions` lists this month's workflow runs through `gh api` and sums
their jobs, each rounded up to a whole minute the way GitHub bills them, with
the runner multiplier (Windows x2, macOS x10, self-hosted free). A skipped job
never got a runner and counts zero. It is an estimate from job timings — the
repository's billing page is the authority — but it names the workflow, which
the billing page does not. Without `gh` it says so and exits 0.

Usage:
    usage_report.py                          # every project, all time
    usage_report.py --since 2026-09-14       # one day
    usage_report.py --project claude-arsenal # one project dir (substring match)
    usage_report.py --json                   # same numbers, machine-readable
    usage_report.py --actions                # Actions minutes, this repo, this month
    usage_report.py --actions --repo o/r --repo o/s --since 2026-09-01

Exit: 0 on success, 2 when the projects directory does not exist.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import urllib.parse
from collections import defaultdict
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

DEFAULT_PROJECTS_DIR = Path.home() / ".claude" / "projects"


class Turn:
    """One assistant turn's usage, flattened to the five numbers that matter."""

    __slots__ = ("cache_read", "context", "hour", "model", "output", "session", "sidechain")

    def __init__(
        self,
        session: str,
        model: str,
        hour: str,
        context: int,
        output: int,
        cache_read: int,
        sidechain: bool,
    ) -> None:
        self.session = session
        self.model = model
        self.hour = hour
        self.context = context
        self.output = output
        self.cache_read = cache_read
        self.sidechain = sidechain


def _as_int(value: Any) -> int:
    """Coerce a usage field to int, treating anything unexpected as zero.

    Usage blocks gain fields between Claude Code versions and a resumed
    transcript can carry an older shape. A missing or malformed counter should
    undercount one turn, never abort a report over a whole fleet.
    """
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _hour_bucket(timestamp: Any) -> str:
    """`2026-09-14T10:23:51.402Z` -> `2026-09-14T10:00Z`, or "" when unparseable."""
    if not isinstance(timestamp, str):
        return ""
    try:
        moment = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return ""
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:00Z")


def _day(hour: str) -> str:
    return hour.split("T", 1)[0] if hour else ""


def _project_of(path: Path, projects_dir: Path) -> str:
    """The project directory a transcript belongs to, at any nesting depth."""
    try:
        return path.relative_to(projects_dir).parts[0]
    except (ValueError, IndexError):
        return path.parent.name


def read_turns(
    projects_dir: Path,
    since: str = "",
    until: str = "",
    project: str = "",
) -> Iterator[Turn]:
    """Yield one Turn per assistant turn carrying a usage block.

    Deduplicated on the entry `uuid`. Forking or resuming a session copies its
    history into a second transcript file verbatim, so a fleet that resumed
    anything would otherwise report the same expensive turns two or three times —
    inflating exactly the number somebody is reading in order to make a decision.
    """
    seen: set[str] = set()
    # rglob, not `*/*.jsonl`: a dispatched subagent's turns are not in the
    # dispatching session's transcript, they are a level deeper in
    # `<project>/<session>/subagents/agent-*.jsonl`. A flat glob reports a fleet
    # while omitting the fleet — the orchestrator's own turns only, which is the
    # cheap half and the half nobody was asking about.
    for path in sorted(projects_dir.rglob("*.jsonl")):
        if project and project not in _project_of(path, projects_dir):
            continue
        try:
            handle = path.open(encoding="utf-8", errors="replace")
        except OSError:
            continue
        with handle:
            for line in handle:
                try:
                    entry = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                if not isinstance(entry, dict) or entry.get("type") != "assistant":
                    continue
                message = entry.get("message")
                if not isinstance(message, dict):
                    continue
                usage = message.get("usage")
                if not isinstance(usage, dict):
                    continue

                uuid = entry.get("uuid")
                if isinstance(uuid, str):
                    if uuid in seen:
                        continue
                    seen.add(uuid)

                hour = _hour_bucket(entry.get("timestamp"))
                day = _day(hour)
                # An unparseable timestamp keeps the turn in an unfiltered report
                # and drops it from a bounded one: a turn that cannot prove it is
                # in the window must not be counted against that window.
                if (since or until) and not day:
                    continue
                if since and day < since:
                    continue
                if until and day > until:
                    continue

                cache_read = _as_int(usage.get("cache_read_input_tokens"))
                context = (
                    _as_int(usage.get("input_tokens"))
                    + cache_read
                    + _as_int(usage.get("cache_creation_input_tokens"))
                )
                session = entry.get("sessionId")
                model = message.get("model")
                yield Turn(
                    session=session if isinstance(session, str) else path.stem,
                    model=model if isinstance(model, str) else "unknown",
                    hour=hour,
                    context=context,
                    output=_as_int(usage.get("output_tokens")),
                    cache_read=cache_read,
                    sidechain=entry.get("isSidechain") is True,
                )


class Bucket:
    """Running totals for one session, model, or hour."""

    __slots__ = ("cache_read", "context", "max_context", "models", "output", "sessions", "turns")

    def __init__(self) -> None:
        self.turns = 0
        self.context = 0
        self.output = 0
        self.cache_read = 0
        self.max_context = 0
        self.models: set[str] = set()
        self.sessions: set[str] = set()

    def add(self, turn: Turn) -> None:
        self.turns += 1
        self.context += turn.context
        self.output += turn.output
        self.cache_read += turn.cache_read
        self.max_context = max(self.max_context, turn.context)
        self.models.add(turn.model)
        self.sessions.add(turn.session)

    @property
    def avg_context(self) -> int:
        return self.context // self.turns if self.turns else 0


def aggregate(turns: Iterator[Turn]) -> dict[str, Any]:
    by_session: dict[str, Bucket] = defaultdict(Bucket)
    by_model: dict[str, Bucket] = defaultdict(Bucket)
    by_hour: dict[str, Bucket] = defaultdict(Bucket)
    total = Bucket()
    sidechain = Bucket()

    for turn in turns:
        by_session[turn.session].add(turn)
        by_model[turn.model].add(turn)
        if turn.hour:
            by_hour[turn.hour].add(turn)
        total.add(turn)
        if turn.sidechain:
            sidechain.add(turn)

    peak = ""
    if by_hour:
        # Ties break on the earlier hour so repeated runs over the same data
        # name the same hour — a report that moves between runs gets distrusted.
        peak = min(by_hour, key=lambda h: (-(by_hour[h].context + by_hour[h].output), h))

    return {
        "by_session": by_session,
        "by_model": by_model,
        "by_hour": by_hour,
        "total": total,
        "sidechain": sidechain,
        "peak_hour": peak,
    }


def _short(session: str) -> str:
    return session.split("-", 1)[0][:8] if session else "?"


def _compact(n: int) -> str:
    if n >= 1_000_000_000:
        return f"{n / 1_000_000_000:.1f}B"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}k"
    return str(n)


def render(report: dict[str, Any], projects_dir: Path, window: str) -> str:
    total: Bucket = report["total"]
    if not total.turns:
        return f"usage_report: no assistant turns with usage in {projects_dir}{window}\n"

    by_session: dict[str, Bucket] = report["by_session"]
    by_model: dict[str, Bucket] = report["by_model"]
    lines = [
        f"usage report — {len(by_session)} session(s), {total.turns:,} turns{window}",
        "",
        f"{'session':<10} {'model':<22} {'turns':>7} {'ctx/turn':>12} {'max ctx':>12}",
    ]
    for session, bucket in sorted(by_session.items(), key=lambda kv: -kv[1].context):
        model = sorted(bucket.models)[0] if len(bucket.models) == 1 else "(mixed)"
        lines.append(
            f"{_short(session):<10} {model:<22} {bucket.turns:>7,} "
            f"{bucket.avg_context:>12,} {bucket.max_context:>12,}"
        )

    lines += ["", f"{'model':<24} {'turns':>7} {'output':>14} {'cache read':>16}"]
    for model, bucket in sorted(by_model.items(), key=lambda kv: -kv[1].cache_read):
        lines.append(
            f"{model:<24} {bucket.turns:>7,} {bucket.output:>14,} {bucket.cache_read:>16,}"
        )

    sidechain: Bucket = report["sidechain"]
    if sidechain.turns:
        models = ", ".join(sorted(sidechain.models))
        lines += [
            "",
            f"dispatched (subagent) turns: {sidechain.turns:,} of {total.turns:,} — {models}",
        ]

    lines += [
        "",
        f"TOTAL  {total.turns:,} turns · {_compact(total.output)} output · "
        f"{_compact(total.cache_read)} cache read · {_compact(total.context)} context",
    ]
    peak: str = report["peak_hour"]
    if peak:
        hour: Bucket = report["by_hour"][peak]
        lines.append(
            f"PEAK   {peak}  {hour.context + hour.output:,} tokens across "
            f"{len(hour.sessions)} session(s)"
        )
    return "\n".join(lines) + "\n"


def _bucket_json(bucket: Bucket) -> dict[str, Any]:
    return {
        "turns": bucket.turns,
        "context": bucket.context,
        "avg_context": bucket.avg_context,
        "max_context": bucket.max_context,
        "output": bucket.output,
        "cache_read": bucket.cache_read,
        "models": sorted(bucket.models),
        "sessions": len(bucket.sessions),
    }


# --- --actions --------------------------------------------------------------

# Pages of 100 runs per repo before the listing is called truncated. A month
# that needs more than this has a trigger problem the table will already show.
_ACTIONS_MAX_PAGES = 10


class GhUnavailable(Exception):
    """`gh` is missing, or a call failed; the message says which."""


def _gh(path: str) -> Any:
    if shutil.which("gh") is None:
        raise GhUnavailable("`gh` is not installed")
    try:
        proc = subprocess.run(
            ["gh", "api", path],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GhUnavailable(str(exc)) from exc
    if proc.returncode != 0:
        lines = (proc.stderr or proc.stdout or "gh api failed").strip().splitlines()
        raise GhUnavailable(lines[0] if lines else "gh api failed")
    try:
        return json.loads(proc.stdout or "{}")
    except ValueError as exc:
        raise GhUnavailable(f"gh api returned non-JSON for {path}") from exc


def _current_repo() -> str:
    if shutil.which("gh") is None:
        raise GhUnavailable("`gh` is not installed")
    proc = subprocess.run(
        ["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )
    name = proc.stdout.strip()
    if proc.returncode != 0 or not name:
        raise GhUnavailable("no GitHub repository here — pass --repo OWNER/REPO")
    return name


def _ts(raw: Any) -> datetime | None:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _multiplier(labels: list[str]) -> int:
    joined = " ".join(labels).lower()
    if "self-hosted" in joined:
        return 0
    if "macos" in joined:
        return 10
    if "windows" in joined:
        return 2
    return 1


def job_minutes(job: dict[str, Any]) -> int:
    """Billed minutes for one job: whole minutes, rounded up, times the runner rate."""
    if job.get("conclusion") == "skipped":
        return 0
    start, end = _ts(job.get("started_at")), _ts(job.get("completed_at"))
    if start is None or end is None:
        return 0
    seconds = (end - start).total_seconds()
    if seconds <= 0:
        return 0
    return math.ceil(seconds / 60) * _multiplier([str(x) for x in job.get("labels") or []])


def actions_usage(repo: str, since: str) -> dict[str, Any]:
    """Per-workflow run counts and estimated billed minutes for one repo."""
    workflows: dict[str, dict[str, int]] = {}
    created = urllib.parse.quote(f">={since}")
    truncated = False
    for page in range(1, _ACTIONS_MAX_PAGES + 1):
        data = _gh(f"repos/{repo}/actions/runs?created={created}&per_page=100&page={page}")
        runs = data.get("workflow_runs") or []
        for run in runs:
            name = str(run.get("name") or run.get("path") or "?")
            row = workflows.setdefault(name, {"runs": 0, "billed_runs": 0, "minutes": 0})
            row["runs"] += 1
            jobs = _gh(f"repos/{repo}/actions/runs/{run.get('id')}/jobs?per_page=100")
            minutes = sum(job_minutes(j) for j in jobs.get("jobs") or [])
            row["minutes"] += minutes
            row["billed_runs"] += 1 if minutes else 0
        if len(runs) < 100:
            break
    else:
        truncated = True
    return {"repo": repo, "since": since, "truncated": truncated, "workflows": workflows}


def render_actions(reports: list[dict[str, Any]]) -> str:
    since = reports[0]["since"] if reports else ""
    lines = [
        f"actions usage since {since} — estimated billed minutes "
        "(each job rounded up to a minute; skipped jobs are free)",
        "",
        f"{'repo':<28} {'workflow':<28} {'runs':>6} {'billed':>7} {'minutes':>8}",
    ]
    total = 0
    for rep in reports:
        rows = sorted(rep["workflows"].items(), key=lambda kv: -kv[1]["minutes"])
        for name, row in rows:
            total += row["minutes"]
            lines.append(
                f"{rep['repo'][:28]:<28} {name[:28]:<28} {row['runs']:>6} "
                f"{row['billed_runs']:>7} {row['minutes']:>8}"
            )
        if rep["truncated"]:
            lines.append(f"{rep['repo']}: more than {_ACTIONS_MAX_PAGES * 100} runs — truncated")
    lines += ["", f"TOTAL  {total} minute(s). The repository's billing page is the authority."]
    return "\n".join(lines) + "\n"


def main_actions(repos: list[str], since: str, as_json: bool) -> int:
    since = since or datetime.now(UTC).strftime("%Y-%m-01")
    try:
        targets = repos or [_current_repo()]
    except GhUnavailable as exc:
        print(f"usage_report: --actions needs gh: {exc}", file=sys.stderr)
        return 0
    reports = []
    for repo in targets:
        try:
            reports.append(actions_usage(repo, since))
        except GhUnavailable as exc:
            print(f"usage_report: {repo}: {exc}", file=sys.stderr)
    if as_json:
        print(json.dumps(reports, separators=(",", ":"), sort_keys=True))
    elif reports:
        print(render_actions(reports), end="")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--projects-dir", type=Path, default=DEFAULT_PROJECTS_DIR)
    parser.add_argument("--since", default="", metavar="YYYY-MM-DD", help="inclusive lower bound")
    parser.add_argument("--until", default="", metavar="YYYY-MM-DD", help="inclusive upper bound")
    parser.add_argument("--project", default="", help="only project dirs containing this substring")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument(
        "--actions", action="store_true", help="GitHub Actions minutes per workflow, via gh"
    )
    parser.add_argument(
        "--repo", action="append", default=[], help="OWNER/REPO for --actions (repeatable)"
    )
    args = parser.parse_args(argv)

    if args.actions:
        return main_actions(args.repo, args.since, args.json)

    if not args.projects_dir.is_dir():
        print(f"usage_report: no such directory: {args.projects_dir}", file=sys.stderr)
        return 2

    report = aggregate(
        read_turns(args.projects_dir, since=args.since, until=args.until, project=args.project)
    )

    if args.json:
        print(
            json.dumps(
                {
                    "total": _bucket_json(report["total"]),
                    "sidechain": _bucket_json(report["sidechain"]),
                    "peak_hour": report["peak_hour"],
                    "by_session": {k: _bucket_json(v) for k, v in report["by_session"].items()},
                    "by_model": {k: _bucket_json(v) for k, v in report["by_model"].items()},
                },
                separators=(",", ":"),
                sort_keys=True,
            )
        )
        return 0

    window = ""
    if args.since or args.until:
        window = f" [{args.since or '...'} .. {args.until or '...'}]"
    print(render(report, args.projects_dir, window), end="")
    return 0


if __name__ == "__main__":
    # Windows consoles default to a legacy codepage (cp1252 and friends);
    # a non-ASCII line must degrade to "?", never take the process down.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
