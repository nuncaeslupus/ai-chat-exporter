#!/usr/bin/env python3
"""gate_evidence.py — enforce a task payload's structured numeric evidence gate.

A task file (arsenal/tasks/<id>.md) may declare a machine-checkable
gate inside its ``## Acceptance gate`` section as a fenced ``gate`` block:

    ```gate
    cpcv_sharpe >= 1.0
    evidence: data/exports/okx_cpcv.json
    key: metrics.sharpe
    ```

- line 1 is the gate in ``<metric> <op> <threshold>`` grammar (the same grammar
  the gate-check skill uses; ops: < <= > >= == !=).
- ``evidence`` is a path to a committed JSON file holding the measurement.
- ``key`` is a dotted path into that JSON to the measured number.
- ``status-key`` is optional: a dotted path to a string that may read
  ``unmeasured``, for the state "the check ran, and what it found is that this
  cannot be scored yet". That is not a pass and not a fail — a numeric gate is
  routinely in it before its prerequisite data exists — and without somewhere to
  put it, the honest evidence (a null) lands in the non-numeric branch and reads
  as a hard failure, which pressures the author into weakening the gate to
  something measurable. Exactly the pressure these gates exist to remove.

  It must be **positively asserted** in the evidence file. Treating any missing
  or null value as "unmeasured" would let a gate stop checking by omission,
  which is the vacuous-pass hole these gates were added to close, reopened
  somewhere new.

This asserts ``measured <op> threshold`` over the committed evidence file. It
exists to close the false-"done" hole (CA-12): a numeric gate can no longer pass
just because no runnable check was attached — a declared evidence gate with no
evidence file, or evidence that contradicts the threshold, is a hard failure.

Exit: 0 pass OR no evidence gate declared; 1 assertion failed; 2 evidence gate
declared but missing/unreadable file, key not found, or non-numeric value;
3 declared unmeasured via ``status-key`` — `gate_run.sh` already treats 3 as
"could not run" rather than as a verdict.

``--list-only <tasks-dir>`` prints instead the ``evidence:`` path every gate
block in a task tree declares, one per line — the set of build products in this
repo, which only these declarations know.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path
from typing import NoReturn

# Mirrors the gate-check skill's grammar so the two stay one language.
OPS = {
    "<=": lambda a, b: a <= b,
    ">=": lambda a, b: a >= b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
    "<": lambda a, b: a < b,
    ">": lambda a, b: a > b,
}
GATE_RE = re.compile(r"(<=|>=|==|!=|<|>)\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)")


def _fail(msg: str, code: int) -> NoReturn:
    print(f"gate_evidence: {msg}", file=sys.stderr)
    sys.exit(code)


def _extract_block(payload_text: str) -> str | None:
    """Return the contents of the first ```gate block in the ## Acceptance gate section."""
    section = re.search(
        r"##\s+Acceptance gate\s*\n(.*?)(?=\n##\s|\Z)",
        payload_text,
        re.DOTALL | re.IGNORECASE,
    )
    if not section:
        return None
    block = re.search(r"```gate\s*\n(.*?)```", section.group(1), re.DOTALL)
    return block.group(1) if block else None


def _dig(obj: object, dotted: str) -> object:
    cur = obj
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            _fail(f"key {dotted!r} not found in evidence JSON", 2)
        cur = cur[part]
    return cur


def _parse_block(block: str) -> tuple[dict[str, str], str]:
    """Split a gate block into its `key: value` fields and its assertion line."""
    fields: dict[str, str] = {}
    gate_line = ""
    for raw in block.splitlines():
        line = raw.strip()
        if not line:
            continue
        if ":" in line and not GATE_RE.search(line.split(":", 1)[0]):
            k, v = line.split(":", 1)
            # Tolerate quoted values (evidence: "coverage.json") — strip them.
            fields[k.strip().lower()] = v.strip().strip("'\"")
        elif GATE_RE.search(line):
            gate_line = line
    return fields, gate_line


def declared_evidence(tasks_dir: Path) -> list[str]:
    """Every path a gate block in this task tree names as `evidence:`.

    These are build products — a committed measurement of the tree, regenerated
    by the host's own gate. Which paths they are is per-repo and knowable only
    from the declarations, which is why a consumer-side script cannot generalise
    this and arsenal can. `rebase_stack.sh` reads it to tell a conflict on a
    regenerable file, where hand-merging two sides is meaningless, from a real
    one. History is included: a merged task's evidence file is still a build
    product on the branch being replayed.
    """
    paths: set[str] = set()
    if not tasks_dir.is_dir():
        return []
    for path in sorted(tasks_dir.rglob("*.md")):
        try:
            block = _extract_block(path.read_text(encoding="utf-8"))
        except OSError:
            continue
        if block is None:
            continue
        evidence = _parse_block(block)[0].get("evidence")
        if evidence:
            # `./status/x.json` and `status/x.json` are the same declaration, but
            # git names a conflicted path only the second way. An exact compare
            # against the raw string would read an evidence conflict as a real one.
            paths.add(Path(evidence).as_posix())
    return sorted(paths)


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--list-only":
        # Print the declared evidence paths of a task tree, one per line.
        for path in declared_evidence(Path(sys.argv[2])):
            print(path)
        sys.exit(0)
    if len(sys.argv) != 2:
        print(
            "usage: gate_evidence.py <payload.md> | --list-only <tasks-dir>",
            file=sys.stderr,
        )
        sys.exit(2)
    payload = Path(sys.argv[1])
    if not payload.is_file():
        _fail(f"payload not found: {payload}", 2)

    block = _extract_block(payload.read_text(encoding="utf-8"))
    if block is None:
        sys.exit(0)  # no evidence gate declared — nothing to enforce here

    fields, gate_line = _parse_block(block)

    m = GATE_RE.search(gate_line)
    if not m:
        _fail("gate block present but has no '<metric> <op> <threshold>' line", 2)
    op, threshold = m.group(1), float(m.group(2))
    # `GATE_RE` accepts an exponent, so `<= 1e999` overflows to inf here and
    # every finite measurement satisfies it. Unfailable from the threshold side
    # is the same hole as unfailable from the measurement side, checked below.
    if not math.isfinite(threshold):
        _fail(
            f"gate threshold {m.group(2)!r} is not a finite number — "
            "a gate written against it cannot be failed",
            2,
        )

    evidence = fields.get("evidence")
    key = fields.get("key")
    if not evidence or not key:
        _fail("gate block must declare both 'evidence:' (file) and 'key:' (json path)", 2)

    ev_path = Path(evidence)
    if not ev_path.is_file():
        _fail(f"evidence file not found: {ev_path} (a declared gate cannot pass without it)", 2)
    try:
        data = json.loads(ev_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        _fail(f"could not read evidence JSON {ev_path}: {exc}", 2)

    # Checked before the value is read: a metric declared unmeasured has no
    # number to read, and that is the whole point.
    status_key = fields.get("status-key")
    if status_key:
        raw_status = _dig(data, status_key)
        if isinstance(raw_status, str) and raw_status.strip().lower() == "unmeasured":
            print(
                f"gate_evidence: UNMEASURED — {status_key}={raw_status!r} in {ev_path}; "
                f"{key} cannot be scored yet",
                file=sys.stderr,
            )
            sys.exit(3)

    raw_measured = _dig(data, key)
    if isinstance(raw_measured, bool) or not isinstance(raw_measured, int | float):
        _fail(f"evidence value at {key!r} is not numeric: {raw_measured!r}", 2)
    measured = float(raw_measured)
    # `json.loads` accepts the JavaScript spellings `NaN`, `Infinity` and
    # `-Infinity`, and both are `float` — so they cleared the type check above
    # and reached the comparison, where they are the wrong kind of wrong: `NaN`
    # passes every `!=` gate (it compares unequal to everything, itself
    # included) and `Infinity` passes every directional one. A gate that cannot
    # be failed is not a gate. The threshold side is guarded where it is parsed.
    if not math.isfinite(measured):
        _fail(
            f"evidence value at {key!r} is {raw_measured!r}, which is not a finite number — "
            "a gate cannot be scored against it",
            2,
        )

    if OPS[op](measured, threshold):
        print(f"gate_evidence: PASS — {key}={measured} {op} {threshold} ({ev_path})")
        sys.exit(0)
    print(
        f"gate_evidence: FAIL — {key}={measured} violates {op} {threshold} ({ev_path})",
        file=sys.stderr,
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
