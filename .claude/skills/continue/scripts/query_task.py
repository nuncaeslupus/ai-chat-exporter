#!/usr/bin/env python3
"""query_task.py - Query the next eligible task or report status for /continue.

Accepts N bare-word, order-independent tokens. Each token is resolved by
membership against the live queue:

  1. a known workspace value  -> workspace filter (at most one; two is an error)
  2. else a known tag value   -> tag filter (ANDed across tags)
  3. else                     -> fuzzy title search (unknown tokens joined)

A name that is both a workspace and a tag resolves as the workspace first.
The legacy --workspace / --search flags still work and compose with tokens.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

_QUEUE_REL = "claude-arsenal/queue/tasks.jsonl"


def _derive_queue_dir() -> str | None:
    """Path of the worktree that has the coordination branch checked out.

    ARSENAL_QUEUE_DIR is set by queue_branch.sh, but each command in the
    /continue skill runs in its own shell, so a query_task invocation may never
    inherit it. Without a fallback that lands us on the main working tree's
    committed tasks.jsonl — which drifts from the live ledger, since the
    coordination branch is never merged to mainline — and we report stale/foreign
    rows. Deriving the worktree keeps the read correct even without the env var.
    Every path `git worktree list` reports belongs to THIS repo by construction.
    """
    branch = os.environ.get("ARSENAL_QUEUE_BRANCH", "arsenal-queue")
    try:
        out = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            capture_output=True,
            text=True,
            check=False,
        ).stdout
    except OSError:
        return None
    path = None
    for line in out.splitlines():
        if line.startswith("worktree "):
            path = line[len("worktree ") :]
        elif line == f"branch refs/heads/{branch}":
            return path
    return None


# Resolve the ledger against the coordination worktree, mirroring queue_batch.sh.
# An explicit ARSENAL_QUEUE_DIR wins; if it is set but invalid, warn loudly
# rather than silently falling back (silent fallback is the hard-to-debug "queue
# looks empty" symptom). If it is unset, derive the worktree so a fresh shell
# still reads the live ledger, not the drifting main-tree seed.
_QUEUE_DIR = os.environ.get("ARSENAL_QUEUE_DIR")
if _QUEUE_DIR and not Path(_QUEUE_DIR).is_dir():
    sys.stderr.write(
        f"query_task: WARNING — ARSENAL_QUEUE_DIR={_QUEUE_DIR!r} is not a "
        f"directory; deriving the coordination worktree instead\n"
    )
    _QUEUE_DIR = None
if not _QUEUE_DIR:
    _QUEUE_DIR = _derive_queue_dir()
QUEUE_FILE = (
    str(Path(_QUEUE_DIR) / _QUEUE_REL)
    if _QUEUE_DIR and Path(_QUEUE_DIR).is_dir()
    else _QUEUE_REL
)
# queue_eval.sh -> queue_batch.sh resolves the coordination worktree itself
# (explicit ARSENAL_QUEUE_DIR, else derived), so it stays relative to CWD.
QUEUE_EVAL = "claude-arsenal/bin/queue_eval.sh"


def _load_queue(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                data = json.loads(line)
                if isinstance(data, dict):
                    rows.append(data)
            except json.JSONDecodeError:
                pass
    return rows


def _known_axes(rows: list[dict]) -> tuple[set[str], set[str]]:
    """Distinct workspace values and tag values present in the queue."""
    workspaces = {r["workspace"] for r in rows if r.get("workspace")}
    tags: set[str] = set()
    for r in rows:
        for t in r.get("tags", []) or []:
            tags.add(t)
    return workspaces, tags


def _fuzzy_match(rows: list[dict], search: str) -> dict | None:
    search_lower = search.lower()
    open_rows = [r for r in rows if r.get("status") == "open"]
    for row in open_rows:
        if search_lower in (row.get("title") or "").lower():
            return row
    return None


def _resolve_tokens(
    tokens: list[str], rows: list[dict]
) -> tuple[str | None, list[str], str | None]:
    """Classify tokens into (workspace, tags, search_text).

    Workspace wins over tag for an ambiguous name. Two distinct workspaces is an
    error. Unknown tokens mixed with workspace/tag tokens is an error; a search
    is only produced when *every* token is unknown.
    """
    workspaces, tags = _known_axes(rows)
    # Match case-insensitively but resolve to the canonical stored value so the
    # downstream LOOP_WORKSPACE/LOOP_TAGS filters compare exactly.
    ws_map = {w.lower(): w for w in workspaces}
    tag_map = {t.lower(): t for t in tags}
    workspace: str | None = None
    chosen_tags: list[str] = []
    unknown: list[str] = []

    for tok in tokens:
        key = tok.lower()
        if key in ws_map:
            resolved = ws_map[key]
            if workspace is not None and workspace != resolved:
                sys.exit(
                    f"query_task: two workspaces given ({workspace!r}, {resolved!r}); "
                    "a /continue invocation scopes to at most one workspace"
                )
            workspace = resolved
        elif key in tag_map:
            resolved = tag_map[key]
            if resolved not in chosen_tags:
                chosen_tags.append(resolved)
        else:
            unknown.append(tok)

    if unknown and (workspace is not None or chosen_tags):
        sys.exit(
            f"query_task: token(s) {unknown!r} match no known workspace or tag. "
            "Mixing a fuzzy search with workspace/tag scoping is ambiguous — "
            "use scoping tokens, or search text alone."
        )

    search = " ".join(unknown) if unknown else None
    return workspace, chosen_tags, search


def _run_eval(queue_path: Path, workspace: str | None, tags: list[str]) -> None:
    # Run queue_eval.sh with optional workspace/tag scope. Pass scope via the
    # environment, never interpolated into a shell string — a name with shell
    # metacharacters would otherwise inject commands.
    env = os.environ.copy()
    if workspace:
        env["LOOP_WORKSPACE"] = workspace
    if tags:
        env["LOOP_TAGS"] = ",".join(tags)
    result = subprocess.run(
        ["bash", QUEUE_EVAL], capture_output=True, text=True, env=env
    )
    if result.returncode != 0:
        if result.stderr:
            sys.stderr.write(result.stderr)
        exit_code = result.returncode
        if exit_code < 0:
            exit_code = 128 + abs(exit_code)
        sys.exit(exit_code)
    output = result.stdout.strip()
    if output:
        print(output)
        return
    rows = _load_queue(queue_path)
    open_count = sum(1 for r in rows if r.get("status") == "open")
    scope = []
    if workspace:
        scope.append(f"workspace {workspace!r}")
    if tags:
        scope.append(f"tags {tags!r}")
    suffix = f" in {' + '.join(scope)}" if scope else ""
    print(f"no_eligible_task{suffix}  open={open_count}", file=sys.stderr)
    sys.exit(1)


def _run_search(queue_path: Path, search: str) -> None:
    rows = _load_queue(queue_path)
    match = _fuzzy_match(rows, search)
    if match:
        print(json.dumps(match))
        return
    open_count = sum(1 for r in rows if r.get("status") == "open")
    print(f"no_match  open={open_count}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    p = argparse.ArgumentParser(description="Pick the next task for /continue.")
    p.add_argument(
        "tokens", nargs="*",
        help="Bare-word scope tokens: workspace, tag(s), or search text.",
    )
    p.add_argument("--workspace", metavar="NAME", help="Scope to a workspace.")
    p.add_argument("--search", metavar="TEXT", help="Fuzzy-match a task title.")
    p.add_argument("--queue", default=QUEUE_FILE, help="Path to queue.jsonl")
    args = p.parse_args()

    queue_path = Path(args.queue)

    # Explicit --search short-circuits (legacy contract).
    if args.search:
        _run_search(queue_path, args.search)
        return

    rows = _load_queue(queue_path)
    workspace, tags, search = _resolve_tokens(args.tokens, rows)

    # Explicit --workspace composes with / overrides token inference.
    if args.workspace:
        if workspace is not None and workspace != args.workspace:
            sys.exit(
                f"query_task: --workspace {args.workspace!r} conflicts with "
                f"token workspace {workspace!r}"
            )
        workspace = args.workspace

    if search and workspace is None and not tags:
        _run_search(queue_path, search)
        return

    _run_eval(queue_path, workspace, tags)


if __name__ == "__main__":
    main()
