#!/usr/bin/env python3
"""gate_evidence.py — enforce a task payload's structured numeric evidence gate.

A task payload (claude-arsenal/queue/<id>.md) may declare a machine-checkable
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

This asserts ``measured <op> threshold`` over the committed evidence file. It
exists to close the false-"done" hole (CA-12): a numeric gate can no longer pass
just because no runnable check was attached — a declared evidence gate with no
evidence file, or evidence that contradicts the threshold, is a hard failure.

Exit: 0 pass OR no evidence gate declared; 1 assertion failed; 2 evidence gate
declared but missing/unreadable file, key not found, or non-numeric value.
"""

from __future__ import annotations

import json
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


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: gate_evidence.py <payload.md>", file=sys.stderr)
        sys.exit(2)
    payload = Path(sys.argv[1])
    if not payload.is_file():
        _fail(f"payload not found: {payload}", 2)

    block = _extract_block(payload.read_text(encoding="utf-8"))
    if block is None:
        sys.exit(0)  # no evidence gate declared — nothing to enforce here

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

    m = GATE_RE.search(gate_line)
    if not m:
        _fail("gate block present but has no '<metric> <op> <threshold>' line", 2)
    op, threshold = m.group(1), float(m.group(2))

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

    raw_measured = _dig(data, key)
    if isinstance(raw_measured, bool) or not isinstance(raw_measured, int | float):
        _fail(f"evidence value at {key!r} is not numeric: {raw_measured!r}", 2)
    measured = float(raw_measured)

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
