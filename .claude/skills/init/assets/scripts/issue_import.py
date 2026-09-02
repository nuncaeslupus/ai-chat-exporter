#!/usr/bin/env python3
"""issue_import.py — turn labelled GitHub issues into queue tasks.

The board knows about issues in one direction: a task file gets an issue handle
(`handle_sync.py`). Nothing goes the other way, so an issue filed between
sessions — from a phone, while noticing something, with no session open to seed
a task — is not work as far as the selector is concerned. It never appears in a
batch, never blocks anything, and never shows up on the board. Because an empty
selection is the signal for "report done or ask the user", a repository can be
reported as having no work while carrying a dozen open issues.

That is the same failure the protocol already names for spec divergences — a
record that lives somewhere the queue does not read is a record that stops
existing — one layer further out.

    issue_import.py --issues /tmp/all-issues.json          # what would be imported
    issue_import.py --issues /tmp/all-issues.json --apply  # write the task files

Four things this deliberately does NOT do:

* **It does not import every issue.** Only issues carrying the import label
  (default `arsenal:queue`). Discussion threads and questions are not work, and
  turning them into claimable tasks means a worker opens a PR against a
  question. Opting in is the conservative direction.
* **It does not make the new task claimable.** A seeded task's gate is the issue
  body, which is prose — and a gate that runs nothing passes everything. So the
  task carries `requires: [human:gate]`, a capability no surface offers, which
  makes the selector skip it until a human writes a real gate and removes the
  line. Visible on the board, not dispatchable.
* **It does not open a second issue.** The imported issue *becomes* the handle:
  the caller adds the printed `arsenal-task: <id>` marker to that issue. Opening
  a fresh one would leave two issues for one task and a board that disagrees
  with itself.
* **It does not touch the network.** Task files are local and written here;
  every remote change is printed for the caller to apply over whatever channel
  the surface has — the `arsenal-task:` marker to append, and the label swap
  that moves the issue onto the board. With no issues to read it does nothing,
  which is how it degrades when GitHub is unreachable.

Exit: 0 (an empty import is an answer), 2 on unreadable input.
"""

from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from queue_hooks import TASK_LABEL
from task_select import load_tasks, task_id_from_issue

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "queue-add" / "scripts"))

DEFAULT_IMPORT_LABEL = "arsenal:queue"

# The gate a seeded task cannot pass until a human writes one. `requires` is
# already the selector's "not eligible here" mechanism, and no surface ever
# offers this capability — so the task parks itself rather than needing a new
# state to track.
GATE_CAPABILITY = "human:gate"

TEMPLATE = """\
---
id: {task_id}
title: {title}
priority: 5
requires: [{capability}]
---

Imported from {url}

{body}

## Acceptance gate

<!-- This task came from an issue, so its "gate" is prose. Write a real check
     below, then DELETE the `requires: [{capability}]` line in the front matter.
     Until that line is gone the selector will not offer this task, which is
     deliberate: a prose gate runs nothing, and a gate that runs nothing passes
     everything. -->

```bash
# arsenal:gate-placeholder — replace with the real check; it may land in this task's own PR
false
```
"""


def labels_of(issue: dict[str, Any]) -> set[str]:
    return {
        label["name"] if isinstance(label, dict) else str(label)
        for label in (issue.get("labels") or [])
    }


def importable(issues: list[dict[str, Any]], *, label: str) -> list[dict[str, Any]]:
    """Open, labelled issues that are not already a task handle."""
    out: list[dict[str, Any]] = []
    for issue in issues:
        if str(issue.get("state", "open")).lower() != "open":
            continue
        if label not in labels_of(issue):
            continue
        # Already a handle — for a task that exists, or for one whose file was
        # deleted. Either way importing it again would mint a second task.
        existing = task_id_from_issue(issue)
        if existing:
            continue
        out.append(issue)
    return out


def render(issue: dict[str, Any], task_id: str) -> str:
    # `html.unescape` on the body for the same reason it is on the title below:
    # both fields arrive through the same MCP tool, escaped the same way, and a
    # task file is data other tools compare against. Left alone, the prose a
    # human reads to write the real gate spells every apostrophe `&#39;`.
    #
    # Decode first, THEN strip: `&nbsp;` and `&#32;` survive a strip as text,
    # decode to whitespace afterwards, and land in the file as a body that is
    # blank but truthy — so the `_(no issue body)_` fallback, which exists to
    # tell a reader there is nothing here, never fires.
    raw_body = issue.get("body")
    text = html.unescape(raw_body if isinstance(raw_body, str) else "").strip()
    body = text or "_(no issue body)_"
    return TEMPLATE.format(
        task_id=task_id,
        # Two spellings to undo before this lands in the repo, because a task
        # file is data other tools compare against. `html.unescape` because the
        # GitHub MCP tools escape `<`, `>` and `&` in the `title` field, and
        # storing that is storing the transport, not the title.
        # `ensure_ascii=False` because the default spells a euro sign `\u20ac`
        # — the parser decodes that now, but a title nobody can read in a diff
        # is worse for no gain. The file is written UTF-8 either way.
        title=json.dumps(html.unescape(str(issue.get("title", task_id))), ensure_ascii=False),
        capability=GATE_CAPABILITY,
        # An autolink, not a bare URL: a task file lands in the consumer's repo
        # and `markdownlint` flags MD034 on every imported one, forever, since
        # the template never changes. The `issue #N` fallback stays unwrapped —
        # angle brackets around non-URL text read as a stray HTML tag.
        url=(
            f"<{html_url}>"
            if (html_url := issue.get("html_url"))
            else f"issue #{issue.get('number')}"
        ),
        body=body,
    )


def _rollback(written: list[Path], reason: str) -> int:
    """Undo a partial `--apply` and say honestly how far the undo got.

    A half-applied import is worse than none: the files that landed carry no
    `arsenal-task:` marker on their issues yet, so the next handle sync proposes
    a second issue for each. Cleanup failures are reported rather than
    suppressed — telling the caller re-running is safe when a file is still
    there is the one message that turns a recoverable state into duplicates.
    """
    stranded: list[Path] = []
    for created in written:
        try:
            created.unlink(missing_ok=True)
        except OSError:
            stranded.append(created)
    if stranded:
        listed = ", ".join(str(s) for s in stranded)
        print(
            f"issue_import: {reason}. The rollback was INCOMPLETE — remove these by "
            f"hand before re-running, or the next handle sync will open duplicate "
            f"issues for them: {listed}",
            file=sys.stderr,
        )
        return 1
    print(
        f"issue_import: {reason}. Rolled back {len(written)} task file(s) written by "
        "this run; no issue was relabelled, so re-running is safe.",
        file=sys.stderr,
    )
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tasks-dir", type=Path, default=Path("arsenal/tasks"))
    parser.add_argument("--issues", type=Path, required=True, help="JSON array of issues")
    parser.add_argument("--label", default=DEFAULT_IMPORT_LABEL)
    parser.add_argument("--apply", action="store_true", help="write the task files")
    args = parser.parse_args(argv)

    if args.label == TASK_LABEL:
        # Otherwise `add_label` and `remove_label` below are the same string,
        # and a caller applying the row faithfully strips the very label
        # session-start step 2 uses to find the board — leaving the task
        # invisible again, which is the failure the labels were added to fix.
        print(
            f"issue_import: --label {args.label!r} is the board label. An issue already "
            "carrying it is already a handle; pick the label you file NEW work under "
            f"(default {DEFAULT_IMPORT_LABEL!r}).",
            file=sys.stderr,
        )
        return 2

    try:
        payload = json.loads(args.issues.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"issue_import: cannot read --issues — {exc}", file=sys.stderr)
        return 2
    if isinstance(payload, dict):
        payload = payload.get("issues", [])
    issues = [i for i in payload if isinstance(i, dict)]

    # Read only for its warnings — a malformed task file is worth naming here,
    # even though the import decision reads the issue bodies, not the board.
    _, warnings = load_tasks(args.tasks_dir)
    for warning in warnings:
        print(f"issue_import: {warning}", file=sys.stderr)

    rows = importable(issues, label=args.label)
    if not rows:
        print(
            f"issue_import: no open `{args.label}` issue is missing a task",
            file=sys.stderr,
        )
        return 0

    try:
        from create_task import new_task_id
    except ImportError:  # standalone bundle without the queue-add skill beside it
        import secrets

        def new_task_id() -> str:
            return f"t-{secrets.token_hex(4)}"

    # Minted ids are checked against what is already on disk AND against what
    # this run has already handed out. `new_task_id()` is four random bytes, so
    # a collision is unlikely rather than impossible — and the consequence is
    # that `--apply` overwrites an existing task file, which is the one outcome
    # an importer must never produce. `create_task.py` already resolves this
    # the same way; when it is not importable the fallback needs the check too.
    taken = {p.stem for p in args.tasks_dir.rglob("*.md")} if args.tasks_dir.is_dir() else set()

    def mint() -> str | None:
        for _ in range(64):
            candidate = new_task_id()
            if candidate not in taken:
                taken.add(candidate)
                return candidate
        return None

    written_paths: list[Path] = []
    # Collected, not printed, until the whole batch lands. These rows are the
    # caller's instruction to relabel the issue and stamp `arsenal-task:` into
    # its body; printed as the loop runs, a rollback three issues later leaves
    # the caller holding instructions for task files that no longer exist, and
    # an issue marked as the handle for nothing is as broken as a task file with
    # no handle.
    emitted: list[str] = []
    for issue in rows:
        task_id = mint()
        if task_id is None:
            return _rollback(
                written_paths,
                "could not mint an unused task id after 64 attempts — stopping before "
                f"issue #{issue.get('number')} rather than overwriting a task file",
            )
        path = args.tasks_dir / f"{task_id}.md"
        if args.apply:
            # A half-applied import is worse than none: the files that did land
            # carry no `arsenal-task:` marker on their issues yet (the caller
            # applies those from the rows printed below), so the next
            # handle_sync proposes a second issue for each of them. Anything
            # this invocation created is therefore removed if a later write
            # fails, and the failure is reported rather than raised.
            # Rendering happens BEFORE the path joins the rollback list, because
            # it is the one step here that can fail without having touched the
            # filesystem — a body or title that is not a string reaches
            # `html.unescape` and raises. Inside the write `try` it escaped the
            # rollback entirely (only OSError was caught) and left every earlier
            # file behind, which is the half-applied import this guards against.
            try:
                rendered = render(issue, task_id)
            except Exception as exc:  # a malformed issue payload, not a fault here
                return _rollback(
                    written_paths,
                    f"could not render issue #{issue.get('number')} — {exc}",
                )
            # Recorded BEFORE the write, because write_text creates and truncates
            # before it can fail: a path that raised halfway is a file this run
            # made, and leaving it out of the rollback list is what leaves the
            # partial behind.
            written_paths.append(path)
            try:
                args.tasks_dir.mkdir(parents=True, exist_ok=True)
                path.write_text(rendered, encoding="utf-8")
            except (OSError, UnicodeError) as exc:
                # UnicodeError alongside OSError: a GitHub body can carry a lone
                # surrogate, which survives JSON decoding and fails only here, on
                # the UTF-8 encode. It is a ValueError, so `except OSError` let it
                # past the rollback with the file already created and truncated.
                return _rollback(written_paths, f"could not write {path} — {exc}")
        emitted.append(
            json.dumps(
                {
                    "issue": issue.get("number"),
                    "task": task_id,
                    "path": str(path),
                    "written": bool(args.apply),
                    # The caller appends this to the issue body, which turns that
                    # issue into the task's handle. Without it the import is only
                    # half done: the task file exists and nothing can claim it.
                    "add_to_issue_body": f"`arsenal-task: {task_id}`",
                    # And the labels, for the same reason. Session-start step 2
                    # fetches the board by `arsenal:task` specifically, so an
                    # imported issue left carrying only the import label is
                    # invisible to it — `handle_sync.py` then reports the task
                    # as having no handle and proposes a *second* issue, which
                    # already carries the marker below. Two issues for one task,
                    # and a board that disagrees with itself.
                    "add_label": TASK_LABEL,
                    "remove_label": args.label,
                },
                separators=(",", ":"),
            )
        )

    for row in emitted:
        print(row)

    if not args.apply:
        print(
            f"issue_import: {len(rows)} issue(s) would be imported — re-run with --apply",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
