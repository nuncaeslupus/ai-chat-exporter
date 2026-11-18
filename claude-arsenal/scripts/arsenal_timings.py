#!/usr/bin/env python3
"""arsenal_timings.py — how long the loop's expensive boundaries actually take.

`usage_report.py` answers what a fleet SPENT; this answers what it WAITED on.
Nothing in the bundle recorded that, so a consumer whose loop felt slow had to
hand-instrument it for a day or give up — and "the gate feels slow" has exactly
one natural response, which is to turn the gate off. The two most actionable
reports this project has had exist only because somebody did that by hand.

Reads the TSV `bin/_timing.sh` appends to (`tmp/arsenal-metrics/metrics.tsv`),
which never leaves the machine: an event name, a caller-chosen label, a
duration and an exit code. Collection is always on and costs milliseconds;
reading is this script, and nothing enters a context window until someone runs
it.

## What it prints, and why in that order

**By event, ordered by total time.** A 90-second step that runs once a day is
not the bottleneck a 9-second one that runs 200 times is, so total is the column
to read first. Then p50 against p95: p50 says what a typical run costs and p95
says what the loop actually feels, because the slow tail is what a person sits
through.

**Rounds per change.** The round count is the multiplier. A review round that
takes four minutes is fine; four of them on one change is most of an hour, and
that is a fact about the change rather than about the reviewer. This is the
number that says which.

Exit: 0 report printed, 1 no data yet (with what to do about it), 2 usage error.
"""

from __future__ import annotations

import argparse
import math
import sys
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import NamedTuple

METRICS_RELPATH = Path("tmp") / "arsenal-metrics" / "metrics.tsv"

# What each event name means, so the table explains itself to someone who has
# never read _timing.sh. An unknown event still prints — a host may record its
# own — it just gets no gloss.
EVENT_HELP = {
    "gate": "one gate_run.sh call (the whole ## Acceptance gate block)",
    "review-round": "one adversarial review round, emit -> verdict",
    "task-pr": "open_task_pr.sh end to end: gates, review, push, PR",
    "preflight": "open_task_pr.sh --preflight: the cheap half, no PR opened",
    "merge-ready": "one merge_ready.sh check (not the whole wait)",
}


class Row(NamedTuple):
    when: datetime
    event: str
    label: str
    ms: int
    code: int
    task: str


def read_rows(path: Path, since: datetime | None) -> list[Row]:
    """Parse the TSV, skipping anything malformed.

    Skipping rather than failing is deliberate: this file is appended to by
    concurrent scripts, so a torn last line is an ordinary event and not a
    reason to refuse the other 4,999 rows.
    """
    rows: list[Row] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.split("\t")
        if len(parts) != 6:
            continue
        stamp, event, label, ms, code, task = parts
        try:
            when = datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
            row = Row(when, event, label, int(ms), int(code), task)
        except ValueError:
            continue
        if since is None or row.when >= since:
            rows.append(row)
    return rows


def pct(sorted_ms: list[int], p: float) -> int:
    """Nearest-rank percentile. No interpolation, and no numpy.

    At the sample sizes here — often single digits per event — an interpolated
    p95 is a number no observed run ever produced. Nearest-rank always reports a
    duration that actually happened, which is the one a reader can go and look
    at.
    """
    if not sorted_ms:
        return 0
    k = max(1, min(len(sorted_ms), math.ceil(p * len(sorted_ms))))
    return sorted_ms[k - 1]


def human(ms: int) -> str:
    if ms < 1000:
        return f"{ms}ms"
    if ms < 60_000:
        return f"{ms / 1000:.1f}s"
    return f"{ms // 60_000}m{(ms % 60_000) // 1000:02d}s"


def report(rows: list[Row]) -> None:
    by_event: dict[str, list[Row]] = defaultdict(list)
    for r in rows:
        by_event[r.event].append(r)

    print(f"{len(rows)} measurements, {rows[0].when:%Y-%m-%d} to {rows[-1].when:%Y-%m-%d}\n")

    width = max(len(e) for e in by_event)
    print(f"{'event':<{width}}  {'n':>4}  {'p50':>8}  {'p95':>8}  {'total':>8}  {'fail':>4}")
    order = sorted(by_event.items(), key=lambda kv: -sum(r.ms for r in kv[1]))
    for event, group in order:
        ms = sorted(r.ms for r in group)
        fails = sum(1 for r in group if r.code != 0)
        print(
            f"{event:<{width}}  {len(group):>4}  {human(pct(ms, 0.5)):>8}  "
            f"{human(pct(ms, 0.95)):>8}  {human(sum(ms)):>8}  {fails:>4}"
        )
    print()
    for event, _ in order:
        if event in EVENT_HELP:
            print(f"  {event}: {EVENT_HELP[event]}")
    # Without this line the table double-counts to a reader: a `task-pr` of
    # 13m26s and a `task-pr:host-gate` of 13m25s are one 13m26s wait, not two.
    if any(":" in e for e in by_event):
        print("  a:b rows are phases INSIDE a, not time on top of it")

    # The multiplier. Only closed rounds are recorded, so this counts reviews
    # rather than attempts.
    rounds: dict[str, int] = defaultdict(int)
    for r in rows:
        if r.event == "review-round" and r.task:
            rounds[r.task] += 1
    if rounds:
        counts = sorted(rounds.values())
        print(
            f"\nreview rounds per change: {len(rounds)} changes, "
            f"median {pct(counts, 0.5)}, worst {counts[-1]}"
        )
        for task, n in sorted(rounds.items(), key=lambda kv: -kv[1])[:5]:
            if n > 1:
                print(f"  {n} rounds  {task}")

    # The slowest single runs, by label. A p95 says the tail is long; this says
    # which run it was, so there is something concrete to go and look at.
    worst = sorted(rows, key=lambda r: -r.ms)[:5]
    if worst and worst[0].ms >= 1000:
        print("\nslowest single runs:")
        for r in worst:
            label = f"  {r.event} {r.label}".rstrip()
            print(f"{label:<40}  {human(r.ms):>8}  {r.when:%Y-%m-%d %H:%M}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--repo-root", type=Path, default=Path.cwd())
    p.add_argument("--days", type=int, default=30, help="only rows this recent (0 = all)")
    args = p.parse_args(argv)

    if args.days < 0:
        print("arsenal_timings: --days cannot be negative", file=sys.stderr)
        return 2

    path = args.repo_root / METRICS_RELPATH
    if not path.is_file():
        print(
            f"arsenal_timings: nothing recorded yet ({path} does not exist).\n"
            "  The bundle's scripts write it as they run — gate_run.sh, open_task_pr.sh,\n"
            "  adversarial_review.sh, merge_ready.sh — so run the loop once and re-read.\n"
            "  If ARSENAL_METRICS=off is set, nothing is collected at all.",
            file=sys.stderr,
        )
        return 1

    since = None if args.days == 0 else datetime.now(UTC) - timedelta(days=args.days)
    rows = read_rows(path, since)
    if not rows:
        print(
            f"arsenal_timings: {path} holds no rows from the last {args.days} days — try --days 0.",
            file=sys.stderr,
        )
        return 1
    rows.sort(key=lambda r: r.when)
    report(rows)
    return 0


def _selfcheck() -> None:
    """Runnable check for the two things here that can silently be wrong."""
    # Nearest-rank never invents a value, and both ends are reachable.
    assert pct([1, 2, 3, 4, 5], 0.5) == 3, pct([1, 2, 3, 4, 5], 0.5)
    assert pct([1, 2, 3, 4, 5], 0.95) == 5
    assert pct([7], 0.95) == 7
    assert pct([], 0.5) == 0
    # A p95 below the max on a bigger sample, and still an observed value.
    tail = list(range(1, 101))
    assert pct(tail, 0.95) == 95
    assert human(999) == "999ms" and human(1500) == "1.5s" and human(125_000) == "2m05s"
    # A torn line is skipped, not fatal — the file is appended to concurrently.
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / "m.tsv"
        f.write_text(
            "2026-01-01T00:00:00Z\tgate\ta\t100\t0\tt1\n"
            "garbage\n"
            "2026-01-01T00:00:01Z\tgate\tb\tNaN\t0\tt1\n"
            "2026-01-02T00:00:00Z\treview-round\tCLEAR\t200\t0\tt1\n",
            encoding="utf-8",
        )
        rows = read_rows(f, None)
        assert len(rows) == 2, rows
        assert [r.ms for r in rows] == [100, 200]
    print("arsenal_timings: selfcheck ok")


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    if "--selfcheck" in sys.argv:
        _selfcheck()
        raise SystemExit(0)
    raise SystemExit(main())
