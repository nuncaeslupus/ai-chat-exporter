#!/usr/bin/env python3
"""sync_plan_graph.py — draw a plan's dependency graph from its task table.

The graph is a ```drawspec fence (nodes = tasks, edges = the Depends column)
under the plan's `### Dependency graph` heading. It is generated, not drawn by
hand, so it cannot drift from the table: `validate_plan.py` compares the two and
names every dependency one has and the other lacks.

Edges are the Depends column's transitive reduction: T1 → T3 is left out when
T1 → T2 → T3 already says it, and the validator reads a path as the dependency.
A plan still past what drawspec draws in one flow (15 nodes, 16 edges) is split
into phases: an overview of the phases, then one graph per phase, each within
the budget. A phase's graph also shows the earlier-phase tasks its tasks depend
on, so every edge is drawn exactly once across the phase graphs.

    sync_plan_graph.py --input status/plan.md           print the drawspec block
    sync_plan_graph.py --input status/plan.md --apply   replace the block in the plan
                                                        (adds the section after the
                                                        task table when it is missing)

Imported by validate_plan.py for `task_edges` / `graph_problems`.

Exit 0 = printed or written, 1 = no task table with T# and Depends columns,
2 = usage error (file missing).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

TASK_ID_RE = re.compile(r"\bT\d+\b")
DELIM_CELL = re.compile(r"^:?-+:?$")
GRAPH_HEADING_RE = re.compile(r"^(#{2,4})\s+.*dependency graph", re.IGNORECASE)
FENCE_OPEN_RE = re.compile(r"^(?P<fence>`{3,}|~{3,})[ \t]*(?P<lang>[\w-]*)[ \t]*$")
# drawspec's readability budget for one flow; past it the document is refused.
FLOW_NODE_BUDGET, FLOW_EDGE_BUDGET = 15, 16
DETAIL_CHARS = 36


def _cells(line: str) -> list[str]:
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|"):
        body = body[:-1]
    return [c.strip() for c in body.split("|")]


def task_table(text: str) -> list[dict[str, str]]:
    """Rows of the first table whose header has a T# and a Depends column."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if "|" not in line:
            continue
        header = [c.strip("`").lower() for c in _cells(line)]
        if "t#" not in header or not any(h.startswith("depend") for h in header):
            continue
        rows = []
        for row_line in lines[i + 1 :]:
            if "|" not in row_line:
                break
            cells = _cells(row_line)
            if all(DELIM_CELL.match(c) for c in cells if c):
                continue
            rows.append(dict(zip(header, cells, strict=False)))
        return rows
    return []


def task_edges(text: str) -> tuple[list[tuple[str, str]], set[tuple[str, str]]] | None:
    """([(task id, description)] in table order, {(dependency, task)}), or None without a table."""
    rows = task_table(text)
    if not rows:
        return None
    depends_col = next(k for k in rows[0] if k.startswith("depend"))
    tasks: list[tuple[str, str]] = []
    edges: set[tuple[str, str]] = set()
    for row in rows:
        m = TASK_ID_RE.search(row.get("t#", ""))
        if not m:
            continue
        tid = m.group(0)
        tasks.append((tid, row.get("description", "")))
        for dep in TASK_ID_RE.findall(row.get(depends_col, "")):
            edges.add((dep, tid))
    return tasks, edges


def _detail(description: str) -> str:
    plain = re.sub(r"[`*_]", "", description).strip()
    if len(plain) > DETAIL_CHARS:
        plain = plain[: DETAIL_CHARS - 1].rstrip() + "…"
    return plain


def _reach(edges: set[tuple[str, str]]) -> dict[str, set[str]]:
    """Every node each node reaches through one or more edges."""
    succ: dict[str, set[str]] = {}
    for a, b in edges:
        succ.setdefault(a, set()).add(b)
    reach: dict[str, set[str]] = {}
    for start in succ:
        seen: set[str] = set()
        stack = list(succ[start])
        while stack:
            n = stack.pop()
            if n not in seen:
                seen.add(n)
                stack.extend(succ.get(n, ()))
        reach[start] = seen
    return reach


def transitive_reduction(edges: set[tuple[str, str]]) -> set[tuple[str, str]]:
    """The edges no longer path already implies. An edge on a cycle is kept as written."""
    reach = _reach(edges)
    kept = set()
    for a, b in edges:
        if a in reach.get(b, set()):  # a cycle: there is no unique reduction; keep it
            kept.add((a, b))
            continue
        implied = any(c != b and b in reach.get(c, set()) for x, c in edges if x == a)
        if not implied:
            kept.add((a, b))
    return kept


def _flow(title: str, nodes: list[tuple[str, str]], edges: list[tuple[str, str]]) -> str:
    node_lines = ["  " + json.dumps({"id": i, "text": t}, ensure_ascii=False) for i, t in nodes]
    edge_lines = ["  " + json.dumps({"from": a, "to": b}) for a, b in edges]
    out = [
        "```drawspec",
        "{" + f'"version": 1, "kind": "flow", "title": {json.dumps(title, ensure_ascii=False)},',
    ]
    out.append(' "nodes": [')
    out.append(",\n".join(node_lines))
    if edge_lines:
        out.append(" ],")
        out.append(' "edges": [')
        out.append(",\n".join(edge_lines))
    out.append(" ]}")
    out.append("```")
    return "\n".join(out)


def _node_text(tid: str, desc: str) -> str:
    detail = _detail(desc)
    return f"{tid}\n{detail}" if detail else tid


def _ordered(edges: set[tuple[str, str]], order: dict[str, int]) -> list[tuple[str, str]]:
    return sorted(edges, key=lambda e: (order.get(e[1], 1e9), order.get(e[0], 1e9), e))


def drawspec_block(tasks: list[tuple[str, str]], edges: set[tuple[str, str]]) -> str:
    """One ```drawspec flow for these tasks: a node per task, the reduced Depends edges."""
    order = {tid: n for n, (tid, _) in enumerate(tasks)}
    nodes = [(tid, _node_text(tid, desc)) for tid, desc in tasks]
    return _flow("Task dependencies", nodes, _ordered(transitive_reduction(edges), order))


def _within(nodes: int, edges: int) -> bool:
    return nodes <= FLOW_NODE_BUDGET and edges <= FLOW_EDGE_BUDGET


def _phase_cost(members: list[str], reduced: set[tuple[str, str]]) -> tuple[int, int]:
    """(nodes, edges) of one phase's graph: its tasks, the outside tasks they depend on."""
    inside = set(members)
    incoming = [(a, b) for a, b in reduced if b in inside]
    outside = {a for a, _ in incoming if a not in inside}
    return len(inside) + len(outside), len(incoming)


def phases(tasks: list[tuple[str, str]], edges: set[tuple[str, str]]) -> list[list[str]]:
    """Tasks grouped so each group's graph is within the drawspec budget.

    One group when the whole plan fits. Otherwise tasks are taken in dependency
    order (longest path from a root, then table order) and cut into consecutive
    groups, a new one starting whenever the next task would push the current
    group's graph past the budget. Every edge then runs within a group or from
    an earlier group to a later one.
    """
    ids = [tid for tid, _ in tasks]
    reduced = transitive_reduction(edges)
    if _within(len(ids), len(reduced)):
        return [ids]
    order = {tid: n for n, tid in enumerate(ids)}
    preds: dict[str, set[str]] = {}
    for a, b in reduced:
        preds.setdefault(b, set()).add(a)
    depth: dict[str, int] = {}

    def level(tid: str, stack: frozenset[str] = frozenset()) -> int:
        if tid in depth:
            return depth[tid]
        if tid in stack:  # a cycle: break it here
            return 0
        d = 1 + max((level(p, stack | {tid}) for p in preds.get(tid, ())), default=-1)
        depth[tid] = d
        return d

    topo = sorted(ids, key=lambda t: (level(t), order[t]))

    def cut(cap: int) -> list[list[str]]:
        groups: list[list[str]] = []
        current: list[str] = []
        for tid in topo:
            if current and (
                len(current) >= cap or not _within(*_phase_cost([*current, tid], reduced))
            ):
                groups.append(current)
                current = []
            current.append(tid)
        if current:
            groups.append(current)
        return groups

    fewest = cut(len(topo))
    # As few phases as the budget allows, but evened out: the smallest cap per
    # phase that still needs no more phases than filling each to the budget.
    for cap in range(-(-len(topo) // len(fewest)), len(topo)):
        groups = cut(cap)
        if len(groups) <= len(fewest):
            return groups
    return fewest


def graph_section(tasks: list[tuple[str, str]], edges: set[tuple[str, str]]) -> str:
    """The dependency graph's fences: one flow, or an overview plus one flow per phase."""
    groups = phases(tasks, edges)
    if len(groups) == 1:
        return drawspec_block(tasks, edges)
    desc = dict(tasks)
    order = {tid: n for n, (tid, _) in enumerate(tasks)}
    reduced = transitive_reduction(edges)
    phase_of = {tid: n for n, group in enumerate(groups, 1) for tid in group}
    overview_nodes = [
        (f"P{n}", f"Phase {n}\n{_detail(', '.join(group))}") for n, group in enumerate(groups, 1)
    ]
    cross = {
        (f"P{phase_of[a]}", f"P{phase_of[b]}")
        for a, b in reduced
        if a in phase_of and b in phase_of and phase_of[a] != phase_of[b]
    }
    p_order = {f"P{n}": n for n in range(1, len(groups) + 1)}
    out = [
        _flow(
            "Task dependencies — phases",
            overview_nodes,
            _ordered(transitive_reduction(cross), p_order),
        )
    ]
    for n, group in enumerate(groups, 1):
        inside = set(group)
        incoming = {(a, b) for a, b in reduced if b in inside}
        outside = sorted(
            {a for a, _ in incoming if a not in inside}, key=lambda t: order.get(t, 1e9)
        )
        nodes = [(t, f"{t}\nphase {phase_of.get(t, '?')}") for t in outside]
        nodes += [(t, _node_text(t, desc.get(t, ""))) for t in group]
        out.append("")
        out.append(
            f"**Phase {n}** — {', '.join(group)}"
            + (f" (with {', '.join(outside)} from earlier phases)" if outside else "")
        )
        out.append("")
        out.append(_flow(f"Task dependencies — phase {n}", nodes, _ordered(incoming, order)))
    return "\n".join(out)


def _section_fences(text: str) -> tuple[int, int, list[tuple[int, int, str, str]]] | None:
    """(heading line, section end, [(start, end, language, body)]) of the dependency graph.

    The section runs from the `Dependency graph` heading to the next heading;
    each fence in it is lines [start, end). None when the plan has no such heading.
    """
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if not GRAPH_HEADING_RE.match(line):
            continue
        fences: list[tuple[int, int, str, str]] = []
        j = i + 1
        while j < len(lines) and not lines[j].startswith("#"):
            m = FENCE_OPEN_RE.match(lines[j].strip())
            if not m:
                j += 1
                continue
            fence = m.group("fence")
            k = j + 1
            while k < len(lines) and not (
                lines[k].strip()
                and set(lines[k].strip()) == {fence[0]}
                and len(lines[k].strip()) >= len(fence)
            ):
                k += 1
            fences.append(
                (j, k + 1, m.group("lang").lower() or "plain", "\n".join(lines[j + 1 : k]))
            )
            j = k + 1
        return i, j, fences
    return None


def find_graph(text: str) -> tuple[int, int, str, str] | None:
    """(start line, end line, fence language, fence body) of the dependency graph.

    Lines [start, end) run from the section's first fence to its last, so a
    split graph (an overview and one fence per phase) is replaced as a whole;
    the language and body are the first fence's. A heading with no fence under
    it gives start == end == where its section ends, an empty language and an
    empty body. None when the plan has no such heading.
    """
    found = _section_fences(text)
    if found is None:
        return None
    i, j, fences = found
    if fences:
        return fences[0][0], fences[-1][1], fences[0][2], fences[0][3]
    lines = text.splitlines()
    while j > i + 1 and not lines[j - 1].strip():
        j -= 1
    return j, j, "", ""


def graph_docs(text: str) -> list[tuple[str, str]]:
    """(language, body) of every fence in the dependency-graph section."""
    found = _section_fences(text)
    return [(lang, body) for _, _, lang, body in found[2]] if found else []


FIX_HINT = "regenerate it: sync_plan_graph.py --input <plan> --apply"


def _is_task_graph(doc: dict[str, Any]) -> bool:
    """A graph of tasks, as opposed to the overview of phases a split graph opens with."""
    return any(
        isinstance(n, dict) and TASK_ID_RE.fullmatch(str(n.get("id", "")))
        for n in doc.get("nodes") or []
    )


def graph_warnings(text: str) -> list[str]:
    """Advisories about the plan's dependency graph that should not fail validation.

    A graph that is not a drawspec fence (the ASCII art earlier templates seeded)
    cannot be checked against the table, but a plan written before the drawspec
    graph is still a valid plan: it is flagged with the fix, not refused. A
    drawspec graph past what one flow can draw is flagged too: the plan is still
    right, but `create_reader.py` will refuse to draw it.
    """
    found = find_graph(text)
    if found is None or task_edges(text) is None:
        return []
    lang = found[2]
    if lang != "drawspec":
        what = f"a ```{lang} block" if lang and lang != "plain" else "no ```drawspec block"
        return [f"dependency graph is {what}, not a ```drawspec fence — {FIX_HINT}"]
    return [
        f"dependency graph {title!r} has {n} nodes / {e} edges, past what drawspec draws "
        f"in one flow ({FLOW_NODE_BUDGET} nodes, {FLOW_EDGE_BUDGET} edges), so the reader "
        f"cannot be built — {FIX_HINT} (it reduces the edges and splits the graph by phase)"
        for title, n, e in over_budget(graph_docs(text))
    ]


def over_budget(docs: list[tuple[str, str]]) -> list[tuple[str, int, int]]:
    """(title, nodes, edges) of every drawspec fence past the one-flow budget."""
    out = []
    for lang, body in docs:
        try:
            doc = json.loads(body) if lang == "drawspec" else None
        except ValueError:
            continue
        if not isinstance(doc, dict):
            continue
        n, e = len(doc.get("nodes") or []), len(doc.get("edges") or [])
        if not _within(n, e):
            out.append((str(doc.get("title") or ""), n, e))
    return out


def graph_problems(text: str) -> list[str]:
    """Where a drawspec dependency graph disagrees with the Depends column; [] when it agrees.

    A dependency is drawn when the graph has a path from it to its task, not
    only a direct edge — the generated graph leaves out edges a longer path
    implies, and a split graph spreads them over one fence per phase, so the
    edges of every task fence are read as one graph. An edge is extra when the
    Depends column neither declares nor implies it.

    A plan without a dependency-graph section has nothing to disagree with, and
    one whose graph is not a drawspec fence is a warning (graph_warnings), not a
    problem. Only a real drawspec graph is held to the table.
    """
    found = find_graph(text)
    table = task_edges(text)
    if found is None or table is None:
        return []
    fix = FIX_HINT
    if found[2] != "drawspec":
        return []
    have: set[tuple[str, str]] = set()
    nodes: set[str] = set()
    for lang, body in graph_docs(text):
        if lang != "drawspec":
            continue
        try:
            doc = json.loads(body)
        except ValueError as exc:
            return [f"dependency graph is not valid JSON ({exc}) — {fix}"]
        if not isinstance(doc, dict):
            return [f"dependency graph is not a drawspec document — {fix}"]
        if not _is_task_graph(doc):
            continue
        have |= {
            (str(e.get("from")), str(e.get("to")))
            for e in doc.get("edges") or []
            if isinstance(e, dict)
        }
        nodes |= {str(n.get("id")) for n in doc.get("nodes") or [] if isinstance(n, dict)}
    tasks, want = table
    drawn, declared = _reach(have), _reach(want)
    problems = []
    for a, b in sorted(want):
        if b not in drawn.get(a, set()):
            problems.append(
                f"dependency graph is missing edge {a} → {b} (Depends of {b}; "
                f"no path from {a} to {b}) — {fix}"
            )
    for a, b in sorted(have):
        if b not in declared.get(a, set()):
            problems.append(
                f"dependency graph has edge {a} → {b}, which no Depends cell declares "
                f"or implies — {fix}"
            )
    for tid in [t for t, _ in tasks if t not in nodes]:
        problems.append(f"dependency graph has no node for task {tid} — {fix}")
    return problems


def write_graph(text: str, block: str) -> str:
    """The plan with its dependency-graph fence replaced by `block` (or the section added)."""
    lines = text.splitlines()
    found = find_graph(text)
    if found is not None:
        start, end, _, _ = found
        new = [*lines[:start], *([""] if start == end else []), block, *lines[end:]]
    else:
        # After the task table and whatever directly follows it, before the next ## section.
        anchor = len(lines)
        seen_table = False
        for i, line in enumerate(lines):
            if not seen_table and "|" in line and "t#" in line.lower():
                seen_table = True
            elif seen_table and line.startswith("## "):
                anchor = i
                break
        new = [*lines[:anchor], "### Dependency graph", "", block, "", *lines[anchor:]]
    return "\n".join(new) + ("\n" if text.endswith("\n") else "")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--input", default="status/plan.md", help="plan file (default: status/plan.md)"
    )
    parser.add_argument(
        "--apply", action="store_true", help="replace the plan's dependency-graph block in place"
    )
    args = parser.parse_args()
    path = Path(args.input)
    if not path.is_file():
        print(f"✗ {path} not found — pass --input <plan>", file=sys.stderr)
        return 2
    text = path.read_text(encoding="utf-8")
    table = task_edges(text)
    if table is None:
        print(f"✗ {path}: no task table with T# and Depends columns", file=sys.stderr)
        return 1
    tasks, edges = table
    reduced = transitive_reduction(edges)
    groups = phases(tasks, edges)
    block = graph_section(tasks, edges)
    for title, n, e in over_budget(graph_docs(f"### Dependency graph\n\n{block}\n")):
        print(
            f"⚠  {title!r}: {n} nodes / {e} edges is past what drawspec draws in one flow "
            f"({FLOW_NODE_BUDGET} nodes, {FLOW_EDGE_BUDGET} edges) even after reduction and "
            "splitting — one task depends on too many others; split it",
            file=sys.stderr,
        )
    if not args.apply:
        print(block)
        return 0
    path.write_text(write_graph(text, block), encoding="utf-8")
    split = f", split into {len(groups)} phases" if len(groups) > 1 else ""
    print(
        f"✓ {path}: dependency graph drawn from {len(tasks)} task(s), "
        f"{len(reduced)} of {len(edges)} edge(s) after reduction{split}"
    )
    return 0


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
