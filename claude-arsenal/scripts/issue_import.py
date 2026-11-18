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

Five things this deliberately does NOT do:

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
* **It does not mint a second task for an issue it has already imported.** The
  task id is derived from the issue's own identity, so the dry run names the id
  `--apply` will use, and running `--apply` twice writes nothing the second
  time. Before this the id was random, and a second run — the ordinary reaction
  to a first one whose remote half never got applied — left two task files for
  one issue.
* **It does not touch the network.** Task files are local and written here;
  every remote change is printed for the caller to apply over whatever channel
  the surface has — the `arsenal-task:` marker to append, and the label swap
  that moves the issue onto the board. With no issues to read it does nothing,
  which is how it degrades when GitHub is unreachable.

Exit: 0 (an empty import is an answer), 2 on unreadable input.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from arsenal_config import setting
from queue_hooks import TASK_LABEL
from task_select import (
    ID_LABEL_PREFIX,
    default_tasks_dir,
    labels_of,
    load_tasks,
    read_issue_payload,
    task_id_from_issue,
)

# AGENTS.md — resident in every session — documents `import-label` as what
# changes this. It was a hardcoded string, so a consumer who set the key
# imported nothing and was told nothing.
DEFAULT_IMPORT_LABEL = setting("import-label")

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


def derive_task_id(issue: dict[str, Any]) -> str:
    """The task id for an issue — a function of the issue, never of chance.

    This used to be four random bytes, which made the one property `AGENTS.md`
    promises about this script false. The dry run announced an id, `--apply`
    minted a different one, and a second `--apply` — the ordinary thing to do
    when the first run's remote half was never applied — minted a third and left
    two task files for one issue. Two task files are one piece of work dispatched
    twice, holding two claims that cannot collide because the ids differ: exactly
    what the claim ref exists to prevent.

    Derived from `html_url`, which carries owner, repo and number, so two repos
    that both import their issue #7 do not land on the same id. `create_task.py`
    keeps minting at random on purpose — a task typed by hand has no identity to
    derive from, and hashing its title made two agents mint the same id.
    """
    identity = str(issue.get("html_url") or "").strip() or f"#{issue.get('number')}"
    return f"t-{hashlib.sha256(identity.encode()).hexdigest()[:8]}"


def importable(
    issues: list[dict[str, Any]],
    *,
    label: str,
    taken: set[str],
    notes: list[str] | None = None,
) -> list[tuple[dict[str, Any], str]]:
    """Open, labelled issues that are not a task yet, each with the id it gets.

    `taken` is every task id already on disk, `_history` included. It is the
    second half of what makes a re-run a no-op: the first run's task file is
    there, its id is derived from this same issue, so the issue is recognised as
    imported even when the run before it never got as far as marking the issue.
    """
    out: list[tuple[dict[str, Any], str]] = []
    for issue in issues:
        if str(issue.get("state", "open")).lower() != "open":
            continue
        if label not in labels_of(issue):
            continue
        # Already a handle — for a task that exists, or for one whose file was
        # deleted. Either way importing it again would mint a second task.
        if task_id_from_issue(issue):
            continue
        task_id = derive_task_id(issue)
        if task_id in taken:
            # Said out loud rather than passed over. This is the ordinary
            # second run, but it is also what an id collision looks like, and a
            # silent skip reads identically to "there was nothing to import".
            if notes is not None:
                notes.append(
                    f"issue #{issue.get('number')} is already task {task_id} — skipping. "
                    f"If {task_id} is a different task, this is an id collision: say so."
                )
            continue
        out.append((issue, task_id))
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
    parser.add_argument("--tasks-dir", type=Path, default=default_tasks_dir())
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

    issues = read_issue_payload(args.issues, "issue_import")
    if issues is None:
        return 2

    # Read only for its warnings — a malformed task file is worth naming here,
    # even though the import decision reads the issue bodies, not the board.
    _, warnings = load_tasks(args.tasks_dir)
    for warning in warnings:
        print(f"issue_import: {warning}", file=sys.stderr)

    taken = {p.stem for p in args.tasks_dir.rglob("*.md")} if args.tasks_dir.is_dir() else set()
    notes: list[str] = []
    rows = importable(issues, label=args.label, taken=taken, notes=notes)
    for note in notes:
        print(f"issue_import: {note}", file=sys.stderr)
    if not rows:
        print(
            f"issue_import: no open `{args.label}` issue is missing a task",
            file=sys.stderr,
        )
        return 0

    written_paths: list[Path] = []
    # Collected, not printed, until the whole batch lands. These rows are the
    # caller's instruction to relabel the issue and stamp `arsenal-task:` into
    # its body; printed as the loop runs, a rollback three issues later leaves
    # the caller holding instructions for task files that no longer exist, and
    # an issue marked as the handle for nothing is as broken as a task file with
    # no handle.
    emitted: list[str] = []
    for issue, task_id in rows:
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
            # Exclusive creation, never write_text. `taken` is a snapshot of the
            # directory read before the loop, so a task file that appears in the
            # gap — a concurrent import of the same issue, a worker landing its
            # own task — is invisible to it, and write_text would silently
            # overwrite somebody else's task. "x" turns that race into a
            # FileExistsError.
            try:
                args.tasks_dir.mkdir(parents=True, exist_ok=True)
                stream = path.open("x", encoding="utf-8")
            except FileExistsError:
                # Not a failure, and emphatically not a rollback: the id is
                # derived from this issue, so whatever is at that path is this
                # issue's task, written by a run that raced this one. Skipping
                # it is what idempotent means here — the row belongs to the run
                # that actually created the file.
                print(
                    f"issue_import: {path} appeared while this run was working — "
                    f"issue #{issue.get('number')} is already imported, skipping",
                    file=sys.stderr,
                )
                continue
            except OSError as exc:
                return _rollback(written_paths, f"could not create {path} — {exc}")
            # Recorded only once the exclusive create has SUCCEEDED, and before
            # the write, which can still fail with the file already in place.
            # Both halves matter: a path added earlier would put a file this run
            # never made on the rollback list, and unlinking it would destroy the
            # very task the exclusive create refused to overwrite.
            written_paths.append(path)
            try:
                with stream:
                    stream.write(rendered)
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
                    # And the id, as a label, because the marker above lives in
                    # the body and the fetch that reads the board every session
                    # does not ask for bodies. Without it this issue is paired to
                    # its task by title alone, and a retitle reports the task as
                    # having no handle — which is what a caller opens a second
                    # issue in response to.
                    "add_id_label": f"{ID_LABEL_PREFIX}{task_id}",
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
    # Windows consoles default to a legacy codepage (cp1252 and friends);
    # a non-ASCII line must degrade to "?", never take the process down.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
