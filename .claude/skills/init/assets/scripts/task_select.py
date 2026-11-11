#!/usr/bin/env python3
"""task_select.py — decide which task to work on next. Pure function, no network.

This is the piece that used to cost the most: choosing a task meant a session
walked a protocol, ran several scripts, and reasoned over their output in
context. Ordering is a computation, not a judgement call, so it belongs in a
script that answers in one line.

Two inputs, both cheap:

* **Task files** — `<home>/tasks/*.md`, each with YAML-ish front matter
  carrying `id`, `title`, `deps`, `priority`, `requires`. These are read from
  the repository, so the dependency graph is versioned with the code and
  identical for every agent.
* **State** — a JSON object mapping task id to `open` / `claimed` / `done`,
  supplied by the caller (`--state` or stdin). Keeping state *out* of this
  script is what makes it pure: it never touches git or GitHub, so it is
  trivially testable and cannot fail because a network call did.

A task is eligible when it is `open`, every dep is `done`, and every
`requires:` capability is offered by the current surface: the capabilities in
`<session>/surface_profile.json` (what `detect_surface.sh` measured), plus any
`--capability` passed.

Output is one compact JSON object per line, best first — small on purpose,
since every byte lands in a model's context:

    {"id":"t-3f8a91c2","title":"...","path":"arsenal/tasks/t-3f8a91c2.md","priority":2,"gate":true}

`--max N` selects a batch for parallel fan-out. That batch can never contain a
task that depends on another task in it, because a dep that is not yet `done`
disqualifies its dependent outright — and it is capped at one task when the
worktree-isolation sentinel reads `unavailable`, since workers without separate
worktrees share one tree and clobber each other.

Exit: 0 always (an empty selection is an answer, not an error).
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

FRONT_MATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)
# Must accept exactly what gate_run.sh executes. When these two disagree the
# board reports "no gate" for a task whose gate runs fine, which is the
# direction that gets a working payload rewritten or the warning ignored.
GATE_BLOCK_RE = re.compile(r"^[ \t]*```(?:bash|sh)\b", re.MULTILINE)
# How an issue says which task file it is a handle for. Kept in the issue body
# rather than the task file so a task file never has to be rewritten to learn
# its issue number.
#
# This used to be an HTML comment, and load-bearing data does not belong
# anywhere a sanitizer is entitled to remove: the GitHub MCP tools a cloud
# session uses strip angle-bracketed content out of issue bodies, so the marker
# was gone before anything could read it and every board on that surface
# resolved to zero task ids. The pattern below is anchored on the visible token
# instead, which matches a plain `arsenal-task: <id>` line *and* the same text
# inside a legacy comment — so repos already carrying comments keep working
# wherever the comment survives.
TASK_MARKER_RE = re.compile(r"arsenal-task:\s*`?([A-Za-z0-9._-]+)`?")

# Second way in: the task file's path, which every issue body names and which is
# ordinary markdown. This is what rescues issues opened before the visible token
# existed, on the surface where their comment is stripped.
TASK_PATH_RE = re.compile(r"(?:arsenal|claude-arsenal)/tasks/(?:_history/)?([A-Za-z0-9._-]+)\.md")

# Third way in, and the only exact one that survives a body-less fetch. Both
# markers above live in the issue *body*, and the session-start fetch
# deliberately does not ask for bodies — ~9k tokens against ~1.2k on a 40-issue
# board. That left the title as the only path on the surface the board is
# actually read from, and a title is a heuristic: renaming a task unpaired it
# from its issue, and `handle_sync.py` then reported not "I cannot find the
# issue for this task" but "this task has no issue", which is the one sentence a
# caller acts on by opening a second one. A label is exact like the marker and
# cheap like the title — `labels` is already in the field list every fetch asks
# for, so this costs a body-less board nothing.
ID_LABEL_PREFIX = "arsenal-id:"


def labels_of(issue: dict[str, Any]) -> set[str]:
    """Label names on an issue, however the fetch spelled them.

    REST returns objects, the MCP tools and some fixtures return bare strings.
    """
    return {
        label["name"] if isinstance(label, dict) else str(label)
        for label in (issue.get("labels") or [])
    }


def task_id_from_labels(issue: dict[str, Any]) -> str | None:
    """The task id an `arsenal-id:<id>` label states, or None.

    Two of them is not a tie to break: an issue is the handle for exactly one
    task, so a second label means somebody stamped the wrong one and guessing
    would attribute a task's state to another. None sends the caller to the
    body marker, which is exact too.
    """
    found = {
        name[len(ID_LABEL_PREFIX) :].strip()
        for name in labels_of(issue)
        if name.startswith(ID_LABEL_PREFIX)
    }
    found = {f for f in found if f and re.fullmatch(r"[A-Za-z0-9._-]+", f)}
    return found.pop() if len(found) == 1 else None


def task_id_from_body(issue: dict[str, Any]) -> str | None:
    """The task id the issue body states, or None."""
    # A GitHub issue body is a string or null. Anything else is a malformed
    # payload, and the honest reading of it is "carries no marker" — searching
    # it raised a TypeError that surfaced as a traceback from whichever caller
    # happened to be reading the board.
    raw_body = issue.get("body")
    body = raw_body if isinstance(raw_body, str) else ""
    for pattern in (TASK_MARKER_RE, TASK_PATH_RE):
        if match := pattern.search(body):
            return match.group(1)
    return None


def normalise_title(text: str) -> str:
    """Fold a title to the form two sources can be compared on.

    The unescape is the whole reason this is more than a `.split()`: the two
    sources do not spell the same title the same way. The MCP `list_issues`
    tool a cloud session fetches its board with HTML-escapes `<`, `>` and `&`
    in the `title` field it returns, so a task file holding
    `annotations/<offer_id>.json` comes back as
    `annotations/&lt;offer_id&gt;.json`, and the two never compare equal. It
    is the same sanitizer `TASK_MARKER_RE` above already accounts for — it
    escapes titles where it strips bodies — and the title fallback walked
    straight into it.

    Both sides are unescaped exactly once, which assumes a title does not
    contain literal entity text. That assumption is worth stating because the
    obvious defence of the symmetry — "unescape is idempotent" — holds only
    while one pass cannot leave fresh entity text behind, and `&amp;lt;`
    unescapes to `&lt;`, which unescapes again. A canonical title spelling `&lt;` as
    *characters* arrives from the transport as `&amp;lt;`, and one unescape per
    side lands them a level apart, so they never compare equal and the task
    reads as unhandled. Unescaping to a fixed point would close that at the
    cost of making `&amp;lt;` and `<` the same title, which is the more
    dangerous direction for a comparison that attributes state.
    """
    return re.sub(r"\s+", " ", html.unescape(str(text))).strip().casefold()


def loose_title_key(text: str) -> str:
    """A deliberately lossy fold, for asking *could* these be the same title.

    Never for attributing state — only for refusing to act. `normalise_title`
    is the identity comparison and it is conservative on purpose; this one
    drops angle-bracketed spans (a sanitizer may remove them outright rather
    than escape them) and every non-alphanumeric character, so it says yes to
    pairs that differ only in punctuation. That is far too coarse to mark a
    task done on, and exactly right for `handle_sync.py` deciding whether an
    unresolved issue might already be the handle it was about to duplicate.
    """
    stripped = re.sub(r"<[^>]*>", " ", html.unescape(str(text)))
    return re.sub(r"[^0-9a-z]+", "", stripped.casefold())


def title_index(tasks: list[dict[str, Any]]) -> dict[str, str | None]:
    """Normalised title -> task id, or None where two task files share a title.

    The `None` is the point, not an omission: a title collision must resolve to
    nothing rather than to whichever file sorted first. Attributing one task's
    state to another is worse than leaving it unknown — an unknown task reads as
    `open` and gets looked at, a mis-attributed one is silently marked done.
    """
    index: dict[str, str | None] = {}
    for task in tasks:
        key = normalise_title(task.get("title") or "")
        if not key:
            continue
        index[key] = None if key in index else task["id"]
    return index


def task_id_from_issue(
    issue: dict[str, Any],
    *,
    titles: dict[str, str | None] | None = None,
    warnings: list[str] | None = None,
) -> str | None:
    """The task an issue is a handle for, or None.

    Exact evidence first and always, in the order it is cheapest to have: the
    `arsenal-id:` label, then the `arsenal-task:` line in the body. A title is a
    heuristic and must never override either.

    `titles` adds the fallback that lets a caller stop fetching bodies at all.
    Resolving from the body means the session-start fetch has to request `body`
    for every task issue, and on a surface where that fetch lands in the model's
    context — Claude Code on the web, where the GitHub MCP tools are the only
    channel — the whole board's prose is charged against the context window
    before any work is read. Measured on a 40-issue board: ~9k tokens with
    bodies, ~1.2k without, for a payload of one identifier per issue.

    The label is what makes that fallback shrink rather than grow: it is exact,
    and it arrives on the same cheap fetch, so a board whose handles have been
    stamped never reaches the title at all. Until they have been, the title
    still carries body-less boards — safely, because the titles are not
    independently written: `handle_sync.py` and `arsenal-queue.yml` both title
    the handle from the task file's `title:`, so they match verbatim. A title
    edited on GitHub but not in the task file fails to resolve, which is what
    the stamping in `sync-handles` exists to stop being possible.
    """
    if resolved := (task_id_from_labels(issue) or task_id_from_body(issue)):
        return resolved
    if not titles:
        return None
    key = normalise_title(issue.get("title") or "")
    if not key or key not in titles:
        return None
    resolved = titles[key]
    if resolved is None and warnings is not None:
        warnings.append(
            f"issue #{issue.get('number', '?')}: title matches more than one task file — "
            "left unresolved. Give the issue an `arsenal-id:<id>` label, or make the "
            "task titles distinct."
        )
    return resolved


TERMINAL = {"done", "merged"}

# Finished tasks keep their file here. They are not work — they are what makes
# a dep on completed work resolve instead of reading as unknown, and what keeps
# a finished task's gate on disk for a host check that re-asserts it.
HISTORY_DIRNAME = "_history"


# Where worktree_probe.sh and worker_postcheck.sh record whether git worktrees
# actually work on this surface.
def _session_dir() -> Path:
    """The session-state directory, resolved the way every writer resolves it.

    `worktree_probe.sh` and `worker_postcheck.sh` honour ARSENAL_SESSION_DIR and
    ARSENAL_HOME; this path was hardcoded. With a relocated host tree the probe
    wrote `unavailable` to one file while the selector read a stale `available`
    from another — and `available` is what permits ramping to N workers, so the
    disagreement dispatched parallel workers into a single checkout.
    """
    session = os.environ.get("ARSENAL_SESSION_DIR", "").strip()
    if session:
        return Path(session)
    return Path(os.environ.get("ARSENAL_HOME", "").strip() or "arsenal") / "session"


def default_tasks_dir() -> Path:
    """The board, resolved the way `_session_dir` above resolves its own path.

    Every `--tasks-dir` default in the bundle was the literal `arsenal/tasks`,
    and every canonical invocation in AGENTS.md omits the flag — so on a host
    that set ARSENAL_HOME, exactly as AGENTS.md says relocates the whole
    host-owned tree, every board reader reported `tasks: 0 — open 0, problems
    0`. Nothing errored and nothing warned: an existing queue read as an empty
    one, which is the same output a healthy empty backlog produces.

    Imported rather than repeated, because the four other readers each had
    their own copy of the literal and a fix to one would not have reached them.
    """
    return Path(os.environ.get("ARSENAL_HOME", "").strip() or "arsenal") / "tasks"


def read_issue_payload(path: Path, prog: str) -> list[dict[str, Any]] | None:
    """The issues in a `gh issue list --json …` file, or None having said why.

    A truncated or wrong-shaped fetch is valid JSON that is not an issue list —
    `null`, a bare scalar, `{"issues": null}` — and each of those raised a
    TypeError out of the comprehension that consumed it, so the operator got a
    traceback and exit 1 where every one of these scripts documents exit 2.
    `query_status.py` was hardened after a real incident, and its comment even
    claimed the siblings reading the identical payload already returned 2; they
    did not. They import this now rather than each carrying a copy that can be
    fixed alone.
    """
    try:
        text = sys.stdin.read() if str(path) == "-" else path.read_text(encoding="utf-8")
        payload = json.loads(text)
    except (OSError, UnicodeDecodeError) as exc:
        print(f"{prog}: cannot read --issues — {exc}", file=sys.stderr)
        return None
    except json.JSONDecodeError as exc:
        # Kept distinct from the read error: "the file is not there / not
        # readable" and "the fetch wrote something that is not JSON" send an
        # operator to different places.
        print(f"{prog}: --issues is not valid JSON — {exc}", file=sys.stderr)
        return None
    if isinstance(payload, dict):
        payload = payload.get("issues")
    if not isinstance(payload, list):
        print(
            f"{prog}: --issues {path} is not an issue list — expected a "
            'JSON array, or an object with an "issues" array',
            file=sys.stderr,
        )
        return None
    return [i for i in payload if isinstance(i, dict)]


ISOLATION_SENTINEL = _session_dir() / "worktree_isolation"


def isolation_verdict(sentinel: Path) -> str:
    """Return `available`, `unavailable`, or `unknown`."""
    override = os.environ.get("ARSENAL_WORKTREE_ISOLATION", "").strip()
    if override:
        return override
    try:
        return sentinel.read_text(encoding="utf-8").strip() or "unknown"
    except OSError:
        return "unknown"


def state_from_issues(
    issues: list[dict[str, Any]],
    *,
    titles: dict[str, str | None] | None = None,
    claimed_label: str = "arsenal:claimed",
    cancelled_label: str = "arsenal:cancelled",
    warnings: list[str] | None = None,
) -> dict[str, str]:
    """Derive the task state map from GitHub issues.

    Deliberately pure: the caller fetches the issues with whatever GitHub
    channel its surface offers, and this turns them into the small map the
    selector needs. That split is what lets one script call answer "what
    next", instead of a protocol the model walks step by step.

    A closed issue reads as `done` unless it says otherwise, and the portable
    way to say otherwise is the `arsenal:cancelled` label: a stray close should
    not release work that was never actually done, and a label is the only
    signal every surface can see. `state_reason` is honoured when present.
    """
    # A task can carry more than one handle — a duplicate created against a
    # stale fetch, or a board re-seeded — and last-write-wins made the answer
    # depend on the order GitHub happened to return them. `issue_number_for`
    # already resolves that by preferring an OPEN handle; this has to agree, or
    # the two disagree about the same board. A live issue therefore outranks a
    # terminal one, and among terminal ones `cancelled` outranks `done`: both
    # directions err toward "not finished", which keeps work visible rather
    # than handing out a task twice.
    precedence = {"claimed": 3, "open": 2, "cancelled": 1, "done": 0}
    state: dict[str, str] = {}
    resolved = 0
    for issue in issues:
        task_id = task_id_from_issue(issue, titles=titles, warnings=warnings)
        if not task_id:
            continue
        resolved += 1
        labels = {
            label["name"] if isinstance(label, dict) else str(label)
            for label in (issue.get("labels") or [])
        }
        derived: str
        if str(issue.get("state", "")).lower() == "closed":
            # `state_reason` is the precise signal, but not every surface can
            # return it: the GitHub MCP tools a cloud session uses have no such
            # field, so on that surface it is absent for *every* issue, closed
            # as completed or not. Reading absent as "not done" would stall the
            # queue everywhere it is unavailable; reading it as "done" silently
            # loses the distinction. So a label carries it instead — every
            # surface can read labels — and `state_reason` refines the answer
            # when it happens to be there.
            # REST spells it `state_reason`, `gh --json` spells it `stateReason`.
            reason = issue.get("state_reason") or issue.get("stateReason")
            if cancelled_label in labels:
                derived = "cancelled"
            elif not reason:
                derived = "done"
            else:
                derived = "done" if str(reason).lower() == "completed" else "cancelled"
        elif claimed_label in labels or issue.get("assignee") or issue.get("assignees"):
            derived = "claimed"
        else:
            derived = "open"

        current = state.get(task_id)
        if current is None or precedence[derived] > precedence[current]:
            state[task_id] = derived

    # An empty map is indistinguishable from a healthy new board: every task
    # defaults to `open`, so selection looks right until the first task is
    # finished and gets handed out a second time. Issues that yield no task at
    # all is never a legitimate reading of a non-empty list — it is a parse
    # failure, and it says so instead of returning quietly.
    if warnings is not None and issues and not resolved:
        warnings.append(
            f"{len(issues)} issue(s) fetched and none carries a task id — the board is "
            "being read as stateless. Check that bodies still contain their "
            "`arsenal-task: <id>` line (some GitHub tools strip HTML comments), or, if "
            "the fetch omitted `body`, that each issue title still matches its task "
            "file's `title:`."
        )
    return state


def _parse_scalar(raw: str) -> Any:
    """Coerce a front-matter scalar. Deliberately small: the subset below is
    all a task file needs, and depending on PyYAML would break consumers who
    run these scripts with a bare `python3` and no site-packages."""
    text = raw.strip()
    if len(text) >= 2 and text[0] == '"' == text[-1]:
        # A double-quoted scalar carries escapes, and arsenal's own writers put
        # them there: `issue_import.py` and `arsenal_migrate.py` render a title
        # with `json.dumps`, whose default `ensure_ascii` spells a euro sign
        # `\u20ac`. Returning the quoted text verbatim left the task's title as
        # those six literal characters while its issue carried the real one —
        # invisible until the title fallback compared the two. A real YAML
        # parser decodes here, so this does too; a scalar that is not valid
        # JSON (a lone backslash, a Windows path) falls back to the literal
        # reading rather than failing the whole file.
        try:
            decoded = json.loads(text)
        except ValueError:
            return text[1:-1]
        return decoded if isinstance(decoded, str) else text[1:-1]
    if text.startswith(("'", '"')) and text.endswith(("'", '"')) and len(text) >= 2:
        return text[1:-1]
    if text.lower() in {"true", "false"}:
        return text.lower() == "true"
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    return text


def parse_front_matter(text: str) -> dict[str, Any]:
    """Parse the `key: value` / `key: [a, b]` / `key:\\n  - a` subset."""
    match = FRONT_MATTER_RE.match(text)
    if not match:
        return {}
    data: dict[str, Any] = {}
    pending_key: str | None = None
    for line in match.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        list_item = re.match(r"^[ \t]+-[ \t]*(.*)$", line)
        if list_item and pending_key is not None:
            data.setdefault(pending_key, [])
            if isinstance(data[pending_key], list):
                data[pending_key].append(_parse_scalar(list_item.group(1)))
            continue
        key_value = re.match(r"^([A-Za-z0-9_-]+):[ \t]*(.*)$", line)
        if not key_value:
            continue
        key, value = key_value.group(1), key_value.group(2).strip()
        if value == "":
            pending_key = key
            data[key] = []
            continue
        pending_key = None
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1].strip()
            data[key] = [_parse_scalar(p) for p in inner.split(",") if p.strip()] if inner else []
        else:
            data[key] = _parse_scalar(value)
    return data


LABEL_MAX_WORDS = 5


def display_label(label: Any, title: str) -> str:
    """The short human name a task is shown by: its `label:`, else the first
    five words of the title with an ellipsis, so a bare id never stands alone."""
    if label and str(label).strip():
        return " ".join(str(label).split())
    words = title.split()
    if len(words) <= LABEL_MAX_WORDS:
        return " ".join(words)
    return " ".join(words[:LABEL_MAX_WORDS]) + "…"


def _as_list(value: Any) -> list[str]:
    """Front matter may write a single value bare: `requires: surface:cli`.

    parse_front_matter hands that back as a string, and iterating a string
    yields characters — so a bare value silently became eleven one-character
    capabilities that could never match `--capability surface:cli`. A scalar is
    therefore normalised to a one-item list before anything iterates it.
    """
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value]
    return [str(value)]


def load_tasks(tasks_dir: Path) -> tuple[list[dict[str, Any]], list[str]]:
    """Return (tasks, warnings). A malformed task file is reported rather than
    skipped in silence — a task nobody can see is work that never happens."""
    tasks: list[dict[str, Any]] = []
    warnings: list[str] = []
    if not tasks_dir.is_dir():
        return tasks, [f"no task directory at {tasks_dir}"]
    seen: dict[str, Path] = {}
    # Live tasks first, then the history dir. A finished task is loaded so its
    # id resolves — a dep pointing at completed work must not read as unknown —
    # but it carries a terminal `status`, so it is never selected.
    candidates = sorted(tasks_dir.glob("*.md"))
    candidates += sorted((tasks_dir / HISTORY_DIRNAME).glob("*.md"))
    for path in candidates:
        # `_`- and `.`-prefixed files are notes that live alongside the tasks —
        # the migration's `_migrated-history.md`, a `_README.md` — not tasks.
        # Without this they would each warn about a missing `id:` on every run,
        # and a warning that fires every time is one people stop reading.
        if path.name.startswith(("_", ".")):
            continue
        text = path.read_text(encoding="utf-8")
        meta = parse_front_matter(text)
        task_id = meta.get("id")
        if not task_id or not isinstance(task_id, str):
            warnings.append(f"{path}: no `id:` in front matter — skipped")
            continue
        if task_id in seen:
            warnings.append(f"{path}: duplicate id {task_id} (also {seen[task_id]}) — skipped")
            continue
        seen[task_id] = path
        title = str(meta.get("title", task_id))
        label = display_label(meta.get("label"), title)
        if meta.get("label") and len(label.split()) > LABEL_MAX_WORDS:
            warnings.append(
                f"{path}: `label:` has more than {LABEL_MAX_WORDS} words — "
                "keep it short enough to read at a glance"
            )
        tasks.append(
            {
                "id": task_id,
                "title": title,
                "label": label,
                "display": f"{label} ({task_id})",
                "path": str(path),
                "priority": meta.get("priority", 0)
                if isinstance(meta.get("priority", 0), int)
                else 0,
                # `_as_list`, not an isinstance check: a bare `deps: t-aaaa1111`
                # is valid front matter and the same single-value shape
                # `requires` already accepts. Dropping it to [] read as "no
                # dependencies", so the task was offered as unblocked and ran
                # before its prerequisite — the one direction this must not
                # fail in.
                "deps": _as_list(meta.get("deps")),
                "requires": _as_list(meta.get("requires")),
                "workspace": meta.get("workspace"),
                "tags": _as_list(meta.get("tags")),
                "gate": bool(GATE_BLOCK_RE.search(text)),
                # A status in the file is a fact about finished work, recorded
                # where it cannot drift: the issue may be long gone.
                "status": str(meta["status"]).lower() if meta.get("status") else None,
            }
        )
    return tasks, warnings


def effective_state(tasks: list[dict[str, Any]], state: dict[str, str]) -> dict[str, str]:
    """Merge the file-declared status of finished tasks over the issue-derived
    state. A task file that records `status: merged` is the record of work that
    is done; there may be no issue left to say so."""
    merged = dict(state)
    for task in tasks:
        if task.get("status") in TERMINAL:
            merged[task["id"]] = str(task["status"])
    return merged


def select(
    tasks: list[dict[str, Any]],
    state: dict[str, str],
    *,
    capabilities: set[str],
    workspace: str | None = None,
    tags: set[str] | None = None,
    limit: int = 1,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Choose eligible tasks, best first. Returns (selection, warnings)."""
    warnings: list[str] = []
    known = {t["id"] for t in tasks}
    state = effective_state(tasks, state)

    for task in tasks:
        for dep in task["deps"]:
            if dep not in known:
                warnings.append(
                    f"{task['id']}: depends on unknown task {dep} — treated as blocking"
                )
            elif state.get(dep) == "cancelled":
                # `cancelled` is not in TERMINAL, so this dep can never satisfy
                # and the dependent is blocked for good. Every other blocking
                # path here says why; without this one the task simply stops
                # appearing, with nothing anywhere explaining it.
                warnings.append(
                    f"{task['id']}: depends on {dep}, which is cancelled — blocked "
                    "permanently, since a cancelled task never becomes done. Drop "
                    "the dep or reopen it."
                )

    eligible: list[dict[str, Any]] = []
    # Tasks the surface profile ruled out, reported rather than silently dropped:
    # an undetected surface offers no capabilities, so a board made entirely of
    # gated tasks would otherwise read as an empty queue with no explanation.
    gated: list[str] = []
    for task in tasks:
        # Finished work is loaded to resolve deps, never to be handed back out.
        if task.get("status") in TERMINAL:
            continue
        if state.get(task["id"], "open") != "open":
            continue
        # An unknown dep blocks rather than unblocks: guessing that a missing
        # dependency is satisfied is how work gets done out of order.
        if any(state.get(dep) not in TERMINAL for dep in task["deps"]):
            continue
        if workspace and task["workspace"] != workspace:
            continue
        if tags and not tags.issubset(set(task["tags"])):
            continue
        # Last of the filters, so `gated` only ever names tasks the caller asked
        # about. Ahead of the scope filters it collected the whole board, and a
        # `--workspace FRONTEND` run with no eligible work reported a gated
        # BACKEND task — blaming capabilities for what was really an empty scope.
        if not set(task["requires"]).issubset(capabilities):
            gated.append(task["id"])
            continue
        eligible.append(task)

    if gated and not eligible:
        detail = ", ".join(sorted(gated)[:5]) + ("…" if len(gated) > 5 else "")
        warnings.append(
            f"{len(gated)} task(s) were filtered out by `requires:` against the current "
            f"capabilities ({', '.join(sorted(capabilities)) or 'none'}): {detail}. They come "
            "from surface_profile.json (`bash claude-arsenal/bin/detect_surface.sh`) plus "
            "--capability; declare a host-specific one as a probe under [capabilities] in "
            "arsenal/config.toml."
        )

    # Highest priority first, then by id so two agents reading the same graph
    # always rank it identically — ties resolved by luck would have them race
    # for the same task more often than necessary.
    eligible.sort(key=lambda t: (-int(t["priority"]), t["id"]))
    return eligible[:limit], warnings


def _profile_capabilities() -> set[str]:
    """What `detect_surface.sh` recorded for this surface, or nothing.

    The profile had no reader: capabilities arrived only through `--capability`,
    which the session-start protocol never passes, so a detected surface still
    offered `(none)` and the hint told the session to run the probe it had just
    run (#481). Unreadable or malformed reads as empty — an undetected surface
    is exactly what the gated-task warning already explains.
    """
    try:
        data = json.loads((_session_dir() / "surface_profile.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    caps = data.get("capabilities") if isinstance(data, dict) else None
    return {c for c in caps if isinstance(c, str)} if isinstance(caps, list) else set()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--tasks-dir", type=Path, default=default_tasks_dir())
    parser.add_argument("--state", type=Path, help="JSON file of {task_id: state}, or - for stdin")
    parser.add_argument(
        "--issues",
        type=Path,
        help="JSON array of GitHub issues (as your GitHub tools return them); "
        "state is derived from them, so no --state is needed",
    )
    parser.add_argument(
        "--capability",
        action="append",
        default=[],
        help="repeatable, e.g. surface:cli; adds to the surface profile",
    )
    parser.add_argument(
        "--no-profile",
        action="store_true",
        help="ignore surface_profile.json; offer only the --capability values",
    )
    parser.add_argument("--workspace")
    parser.add_argument("--tag", action="append", default=[])
    parser.add_argument("--max", type=int, default=1, dest="limit")
    parser.add_argument(
        "--isolation-sentinel",
        type=Path,
        default=ISOLATION_SENTINEL,
        help="file holding the worktree-isolation verdict; a batch is capped at "
        "one task when it reads `unavailable`",
    )
    parser.add_argument(
        "--no-isolation-clamp",
        action="store_true",
        help="return the full batch even without worktree isolation (unsafe; for tests)",
    )
    parser.add_argument(
        "--all", action="store_true", help="list every task with its computed status"
    )
    args = parser.parse_args(argv)

    # Loaded before the issues are read, not after: the title index is built
    # from the task files, and it is what lets an issue whose body was never
    # fetched still resolve to its task.
    tasks, warnings = load_tasks(args.tasks_dir)

    state: dict[str, str] = {}
    issue_warnings: list[str] = []
    if args.issues:
        # Every way this file can be absent or wrong is an error, not an empty
        # state map. `query_status.py` already returns 2 here; this path only
        # caught JSONDecodeError, so a path that did not exist raised
        # FileNotFoundError out of a documented exit contract, and a truncated
        # `{"issues": null}` raised TypeError from the comprehension below.
        # Either way the operator sees a traceback instead of the one sentence
        # that says which file was unreadable — and on the branch where the
        # exception is swallowed by a caller, an empty state map hands out a
        # task that is already finished.
        issues = read_issue_payload(args.issues, "task_select")
        if issues is None:
            return 2
        state = state_from_issues(
            issues,
            titles=title_index(tasks),
            warnings=issue_warnings,
        )
    else:
        raw_state = ""
        if args.state:
            # `-` means stdin, the spelling `issue_for_task.py` and
            # `read_issue_payload` already use. It used to be inferred instead:
            # `not sys.stdin.isatty()` then `sys.stdin.read()`. But "not a
            # terminal" is not "data is waiting" — an open pipe with no writer
            # closing it blocks forever, and that is what a harness hands a
            # subprocess whose stdin it inherited. `task_select.py` runs on the
            # session-start path, so the failure was a session that never
            # started, with nothing on any stream to say why.
            raw_state = (
                sys.stdin.read()
                if str(args.state) == "-"
                else args.state.read_text(encoding="utf-8")
            )
        elif not sys.stdin.isatty():
            # Said, not silently dropped. A caller who was piping state in gets
            # one line telling them the spelling, instead of a selection quietly
            # computed as though every task were open. Only reachable when
            # neither --issues nor --state was given, so the ordinary
            # session-start invocation never sees it.
            print(
                "task_select: stdin is not a terminal and --state was not given. State "
                "is no longer read from stdin implicitly — that blocked forever on an "
                "inherited pipe. Pass `--state -` to read it from stdin.",
                file=sys.stderr,
            )
        try:
            state = json.loads(raw_state) if raw_state.strip() else {}
        except json.JSONDecodeError as exc:
            print(f"task_select: --state is not valid JSON — {exc}", file=sys.stderr)
            return 2

    warnings += issue_warnings

    if args.all:
        merged = effective_state(tasks, state)
        for task in sorted(tasks, key=lambda t: (-int(t["priority"]), t["id"])):
            row = {
                "id": task["id"],
                "title": task["title"],
                "label": task["label"],
                "display": task["display"],
                "state": merged.get(task["id"], "open"),
            }
            print(json.dumps(row, separators=(",", ":")))
    else:
        limit = max(1, args.limit)
        # Parallel workers are only safe in separate worktrees. When the probe
        # has recorded that they do not work here, the batch is capped at one
        # task *by the selector* rather than by the caller remembering to: the
        # clamp has to be mechanical, or the round that discovers isolation is
        # missing has already dispatched two workers into one tree.
        if limit > 1 and not args.no_isolation_clamp:
            verdict = isolation_verdict(args.isolation_sentinel)
            # Anything short of a proven `available` clamps. `unknown` used to
            # pass, which made the safe default unsafe: nothing had shown that
            # workers get their own tree, and a batch went out anyway. It also
            # makes the protocol's "dispatch the first batch as a single worker"
            # mechanical rather than a step the orchestrator has to remember —
            # the first round is always unknown, so it always clamps (#147).
            if verdict != "available":
                warnings.append(
                    f"worktree isolation is {verdict} — batch capped at 1 task "
                    "(serialized in-place mode)"
                )
                limit = 1

        selection, sel_warnings = select(
            tasks,
            state,
            capabilities=set(args.capability)
            | (set() if args.no_profile else _profile_capabilities()),
            workspace=args.workspace,
            tags=set(args.tag) or None,
            limit=limit,
        )
        warnings += sel_warnings
        for task in selection:
            print(
                json.dumps(
                    {
                        "id": task["id"],
                        "title": task["title"],
                        "label": task["label"],
                        "display": task["display"],
                        "path": task["path"],
                        "priority": task["priority"],
                        "gate": task["gate"],
                    },
                    separators=(",", ":"),
                )
            )

    for warning in warnings:
        print(f"task_select: {warning}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    # Windows consoles default to a legacy codepage (cp1252 and friends);
    # a non-ASCII line must degrade to "?", never take the process down.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
