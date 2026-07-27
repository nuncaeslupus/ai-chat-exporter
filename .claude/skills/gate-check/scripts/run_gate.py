#!/usr/bin/env python3
"""run_gate.py — read a task's measurable gate from status/plan.md and report PASS/FAIL.

The plan's `Implementation tasks` table carries a required `Gate` column — a
measurable acceptance condition written as `<metric> <op> <threshold>` (ops:
< <= > >= == !=), e.g. `p95_latency_ms <= 200` or `line_coverage >= 0.90`. The
`Evidence log` table records, per task: the measured value, the command run, the
commit SHA, and the environment provenance.

Three modes:
  run_gate.py                       audit every task: gate, evidence-complete?, pass?
  run_gate.py --id T3               focus one task: its gate, recorded command, evidence
  run_gate.py --id T3 0.93          also compare a measured value to the threshold

Project-agnostic: it parses the plan format the `design` skill produces and knows
nothing about any build ladder or status filename. A project specialises it with a
thin wrapper that runs its own measurement, then passes the number here.

Human-readable on stdout by default (`--json` for machine use); errors on stderr.
Exit 0 = every gated task passes with complete evidence; 1 = a gate fails, lacks
evidence, or the focused task fails; 2 = usage error (plan missing, no tables, bad id).
A task with no gate defined is grandfathered (reported, never fails the run) unless
--strict is set, which makes a missing gate a failure (new plans require one).
"""

import argparse
import json
import re
import sys
from pathlib import Path

OPS = {
    "<=": lambda a, b: a <= b,
    ">=": lambda a, b: a >= b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
    "<": lambda a, b: a < b,
    ">": lambda a, b: a > b,
}
GATE_RE = re.compile(r"(<=|>=|==|!=|<|>)\s*([+-]?\d+(?:\.\d+)?)")
DELIM_RE = re.compile(r"^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$")
EVIDENCE_FIELDS = ("measured", "command", "sha", "env")


def _norm(cell: str) -> str:
    """Lowercase, drop backticks and surrounding whitespace — for header matching."""
    return cell.strip().strip("`").strip().lower()


def _split_row(line: str) -> list[str]:
    """Split a GFM table row into trimmed cells, dropping the leading/trailing pipe."""
    parts = [c.strip() for c in line.strip().split("|")]
    if parts and parts[0] == "":
        parts = parts[1:]
    if parts and parts[-1] == "":
        parts = parts[:-1]
    return parts


def parse_tables(text: str) -> list[dict]:
    """Return every GFM table as {headers: [...], rows: [{header: cell}, ...]}."""
    lines = text.splitlines()
    tables: list[dict] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if (
            "|" in line
            and i + 1 < len(lines)
            and "|" in lines[i + 1]
            and DELIM_RE.match(lines[i + 1])
        ):
            headers = [_norm(c) for c in _split_row(line)]
            rows: list[dict] = []
            j = i + 2
            while j < len(lines) and "|" in lines[j]:
                cells = _split_row(lines[j])
                cells += [""] * (len(headers) - len(cells))
                rows.append({headers[k]: cells[k] for k in range(len(headers))})
                j += 1
            tables.append({"headers": headers, "rows": rows})
            i = j
        else:
            i += 1
    return tables


def _id_key(headers: list[str]) -> str | None:
    for cand in ("t#", "task", "id", "task id", "t"):
        if cand in headers:
            return cand
    return headers[0] if headers else None


def _looks_templated(value: str) -> bool:
    """True for unfilled template cells like `<description>` or empty."""
    v = value.strip()
    return v == "" or (v.startswith("<") and v.endswith(">"))


def extract_plan(text: str) -> tuple[dict[str, str], dict[str, dict]]:
    """Return (task_id -> gate_text, task_id -> evidence_row)."""
    tasks: dict[str, str] = {}
    evidence: dict[str, dict] = {}
    for table in parse_tables(text):
        headers = table["headers"]
        if "gate" not in headers:
            continue
        is_evidence = "measured" in headers
        key = _id_key(headers)
        if key is None:
            continue
        for row in table["rows"]:
            tid = row.get(key, "").strip().strip("`").upper()
            if not tid or _looks_templated(tid):
                continue
            if is_evidence:
                evidence[tid] = row
            elif tid not in tasks:
                tasks[tid] = row.get("gate", "").strip().strip("`")
    return tasks, evidence


def parse_gate(gate_text: str) -> tuple[str, str, float] | None:
    """Parse `<metric> <op> <threshold>` → (metric, op, threshold); None if non-numeric."""
    if not gate_text or _looks_templated(gate_text):
        return None
    m = GATE_RE.search(gate_text)
    if not m:
        return None
    metric = gate_text[: m.start()].strip().strip("`").strip() or "value"
    return metric, m.group(1), float(m.group(2))


def evaluate(gate_text: str, measured: float | None) -> dict:
    """Build a verdict dict for one gate against an optional measured value."""
    if not gate_text or _looks_templated(gate_text):
        return {"gate": gate_text, "kind": "none", "verdict": "NONE"}
    parsed = parse_gate(gate_text)
    if parsed is None:
        return {"gate": gate_text, "kind": "manual", "verdict": "MANUAL"}
    metric, op, threshold = parsed
    out = {
        "gate": gate_text,
        "kind": "numeric",
        "metric": metric,
        "op": op,
        "threshold": threshold,
        "verdict": "UNKNOWN",
    }
    if measured is not None:
        out["measured"] = measured
        out["verdict"] = "PASS" if OPS[op](measured, threshold) else "FAIL"
    return out


def missing_evidence(row: dict | None) -> list[str]:
    """Return the required evidence fields that are absent or unfilled."""
    if row is None:
        return list(EVIDENCE_FIELDS)
    return [f for f in EVIDENCE_FIELDS if _looks_templated(row.get(f, ""))]


def _measured_from_row(row: dict | None) -> float | None:
    if row is None:
        return None
    raw = re.search(r"[+-]?\d+(?:\.\d+)?", row.get("measured", "") or "")
    return float(raw.group()) if raw else None


def build_report(tasks: dict[str, str], evidence: dict[str, dict], strict: bool = False) -> dict:
    items = []
    for tid in sorted(tasks, key=lambda t: (len(t), t)):
        gate_text = tasks[tid]
        row = evidence.get(tid)
        measured = _measured_from_row(row)
        verdict = evaluate(gate_text, measured)
        check_ev = parse_gate(gate_text) is not None or measured is not None
        missing = missing_evidence(row) if check_ev else []
        has_gate = bool(gate_text and not _looks_templated(gate_text))
        items.append(
            {
                "task": tid,
                "gate": gate_text or "(none)",
                "has_gate": has_gate,
                "evidence_complete": not missing,
                "missing_evidence": missing,
                **{k: v for k, v in verdict.items() if k != "gate"},
            }
        )

    def _failing(i: dict) -> bool:
        if i["has_gate"]:
            return i["verdict"] == "FAIL" or bool(i["missing_evidence"])
        return strict  # an ungated task is a failure only under --strict

    failing = [i for i in items if _failing(i)]
    return {
        "tasks": len(items),
        "gated": sum(1 for i in items if i["has_gate"]),
        "ungated": sum(1 for i in items if not i["has_gate"]),
        "passing": sum(1 for i in items if i["verdict"] == "PASS"),
        "failing": len(failing),
        "strict": strict,
        "items": items,
    }


def _print_human(report: dict) -> None:
    strict = report.get("strict", False)
    for i in report["items"]:
        if not i["has_gate"]:
            if strict:
                mark, detail = "✗", "no gate defined — required under --strict"
            else:
                mark, detail = "·", "no gate defined (grandfathered)"
        elif i["missing_evidence"]:
            mark, detail = "✗", f"evidence incomplete — missing {', '.join(i['missing_evidence'])}"
        elif i["verdict"] == "FAIL":
            mark = "✗"
            detail = f"FAIL — measured {i.get('measured')} violates {i['op']} {i['threshold']}"
        elif i["verdict"] == "PASS":
            mark = "✓"
            detail = f"PASS — measured {i.get('measured')} {i['op']} {i['threshold']}"
        elif i["verdict"] == "MANUAL":
            mark, detail = "?", "non-numeric gate — verify manually"
        else:
            mark, detail = "?", "gate recorded; no measured value to compare"
        print(f"  {mark} {i['task']:<5} {i['gate']:<32} {detail}")
    print(
        f"\n{report['tasks']} task(s) · {report['gated']} gated · "
        f"{report['passing']} passing · {report['failing']} failing/incomplete"
    )


def _focus(
    tid: str,
    tasks: dict,
    evidence: dict,
    measured: float | None,
    as_json: bool,
    strict: bool = False,
) -> int:
    tid = tid.strip().strip("`").upper()
    if tid not in tasks and tid not in evidence:
        print(f"✗ task {tid} not found in the plan's task or evidence tables", file=sys.stderr)
        return 2
    gate_text = tasks.get(tid, "")
    row = evidence.get(tid)
    if measured is None:
        measured = _measured_from_row(row)
    verdict = evaluate(gate_text, measured)
    has_gate = bool(gate_text and not _looks_templated(gate_text))
    check_ev = parse_gate(gate_text) is not None or measured is not None
    missing = missing_evidence(row) if check_ev else []
    result = {
        "task": tid,
        "command": (row or {}).get("command", "").strip().strip("`") or None,
        "sha": (row or {}).get("sha", "").strip() or None,
        "env": (row or {}).get("env", "").strip() or None,
        "evidence_complete": not missing,
        "missing_evidence": missing,
        **verdict,
    }
    if as_json:
        print(json.dumps(result, indent=2))
    else:
        if has_gate:
            gate_disp = gate_text
        elif strict:
            gate_disp = "(none defined — required under --strict)"
        else:
            gate_disp = "(none defined — grandfathered)"
        print(f"Task {tid}")
        print(f"  gate:     {gate_disp}")
        if result["command"]:
            print(f"  command:  {result['command']}")
        if verdict["kind"] == "numeric" and measured is not None:
            print(
                f"  measured: {measured}  →  {verdict['verdict']} "
                f"({measured} {verdict['op']} {verdict['threshold']})"
            )
        elif verdict["kind"] == "numeric":
            print(f"  threshold: {verdict['op']} {verdict['threshold']} (no measured value given)")
        elif verdict["kind"] == "manual":
            print("  verdict:  non-numeric gate — verify manually")
        if has_gate and verdict["kind"] != "manual":
            if missing:
                print(f"  evidence: INCOMPLETE — missing {', '.join(missing)}")
            else:
                print("  evidence: complete")
    failed = (not has_gate and strict) or (
        has_gate and (verdict["verdict"] == "FAIL" or bool(missing))
    )
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--input", default="status/plan.md", help="plan file to read (default: status/plan.md)"
    )
    parser.add_argument("--id", help="focus a single task id (e.g. T3); omit to audit all")
    parser.add_argument(
        "measured",
        nargs="?",
        type=float,
        help="measured value to compare to the focused task's threshold",
    )
    parser.add_argument("--json", action="store_true", help="emit JSON instead of text")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="treat a task with no gate as a failure (new plans require a gate)",
    )
    args = parser.parse_args()

    path = Path(args.input)
    if not path.exists():
        print(f"✗ {path} not found — pass --input <plan>", file=sys.stderr)
        return 2
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"✗ failed to read {path}: {exc}", file=sys.stderr)
        return 2

    tasks, evidence = extract_plan(text)
    if not tasks and not evidence:
        print(f"✗ no task/evidence tables with a Gate column found in {path}", file=sys.stderr)
        return 2

    if args.id:
        return _focus(args.id, tasks, evidence, args.measured, args.json, args.strict)

    report = build_report(tasks, evidence, args.strict)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        _print_human(report)
    return 1 if report["failing"] else 0


if __name__ == "__main__":
    sys.exit(main())
