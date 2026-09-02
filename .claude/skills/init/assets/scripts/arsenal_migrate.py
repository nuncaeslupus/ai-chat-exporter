#!/usr/bin/env python3
"""arsenal_migrate.py — move a repo from the coordination-branch queue to task files.

What changes, and why it is safe to run:

* `claude-arsenal/queue/tasks.jsonl` + `<id>.md` payloads  →  `arsenal/tasks/<id>.md`,
  one file per task, front matter carrying the fields the selector needs and
  the payload kept as the body. Task ids are preserved so `deps` keep resolving.
* `claude-arsenal/session/` and `claude-arsenal/project/`  →  `arsenal/`,
  because host-owned state living inside the vendored prefix is what stopped
  the bundle being consumable as a subtree.
* `arsenal/config.toml` is created if absent.

Tasks in a terminal state are **not** recreated as work — they are recorded in
`arsenal/tasks/_migrated-history.md` so the record survives without
resurrecting finished tasks into the queue.

Nothing is deleted. The coordination branch and its worktree are reported for
you to remove by hand, because a sandboxed session cannot delete refs and a
half-done automatic cleanup is worse than an explicit instruction.

Runs read-only by default — pass `--apply` to write. Re-running is safe: a task
file that already exists is left alone, so an interrupted migration can simply
be run again.

Exit: 0 on success, 1 if nothing to migrate, 2 on error.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import secrets
import shutil
import sys
from pathlib import Path
from typing import Any

TERMINAL = {"done", "merged"}
HISTORY_DIRNAME = "_history"
DEFAULT_QUEUE = Path("claude-arsenal/queue/tasks.jsonl")

# `init.py` owns the config template; this script reads it rather than keeping a
# copy. The copy that used to live here drifted, and because `init.py` will not
# rewrite a `config.toml` that already exists, every repo migrated before
# running `/init` was left permanently without `host-gate` and `[models]` — with
# no ordering of the two scripts that produced a complete file.
_MERGE_POLICY_LINE = re.compile(r'^merge-policy = ".*"$', re.MULTILINE)


def config_template(repo_root: Path) -> str | None:
    """`init.py`'s `_CONFIG_TEMPLATE`, or None when no `init.py` can be found.

    None means this script writes no config at all, which is the honest answer:
    a partial one is worse than none, because its existence is exactly what
    stops `init.py` writing the complete one.
    """
    here = Path(__file__).resolve()
    candidates = [
        # Inside the plugin tree: assets/scripts/ → ../../scripts/init.py
        *here.parents[2].glob("scripts/init.py"),
        # Vendored into a consumer: .claude/skills/init/scripts/init.py
        *sorted(repo_root.glob(".claude/skills/*/scripts/init.py")),
    ]
    for candidate in candidates:
        if candidate.name != "init.py":
            continue
        spec = importlib.util.spec_from_file_location("_arsenal_init_template", candidate)
        if spec is None or spec.loader is None:
            continue
        module = importlib.util.module_from_spec(spec)
        sys.modules["_arsenal_init_template"] = module
        try:
            spec.loader.exec_module(module)
            template = getattr(module, "_CONFIG_TEMPLATE", None)
        except Exception:  # a bundle we cannot read is not a reason to crash
            continue
        finally:
            sys.modules.pop("_arsenal_init_template", None)
        if isinstance(template, str) and "merge-policy" in template:
            return template
    return None


def new_task_id() -> str:
    """Random, not derived from the title.

    The old scheme was `"lo-" + sha256(title)[:4]`: deterministic on the title
    and only four hex characters wide, with uniqueness checked against the
    local file only. Two agents adding a task with the same title produced the
    *same* id, and neither could see the other's row. Random ids need no
    coordination to mint, which is what lets several agents create tasks at
    once.
    """
    return f"t-{secrets.token_hex(4)}"


class MigrateError(Exception):
    """A queue row this migration refuses to guess at."""


# A task id becomes a FILENAME, so it is validated before it is joined to a
# path. The charset matches `task_select.TASK_MARKER_RE`; `.` is in it, so the
# separator and `..` checks below are the part that actually contains a
# traversal — `../../etc/x` is all legal characters.
_TASK_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def _safe_id(raw: object, *, where: str) -> str:
    task_id = str(raw)
    if (
        not _TASK_ID_RE.match(task_id)
        or ".." in task_id
        or "/" in task_id
        or "\\" in task_id
        or task_id in {".", ""}
        # `create_task.py` and `task_select.py` both skip `.`/`_` names when
        # they collect the task set, so migrating one writes a file the queue
        # can never select and no dependency can ever be satisfied by — while
        # reporting success.
        or task_id.startswith((".", "_"))
    ):
        raise MigrateError(f"{where}: task id {task_id!r} is not a usable filename")
    return task_id


def _contained(path: Path, root: Path, *, where: str) -> Path:
    """`path`, proven to be inside `root`. Raises rather than reading or writing out."""
    resolved = path.resolve()
    root_resolved = root.resolve()
    if resolved != root_resolved and root_resolved not in resolved.parents:
        raise MigrateError(f"{where}: {path} resolves outside {root}")
    return resolved


def read_rows(queue_path: Path) -> list[dict[str, Any]]:
    """Every row in the legacy queue, or a refusal naming the line that is wrong.

    Skipping a malformed line and reporting success was the dangerous half: a
    user who trusts that report and deletes the old queue has destroyed the only
    record of that task. A migration that stops on the line it cannot read costs
    one edit; one that quietly drops it costs the task.
    """
    if not queue_path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    for lineno, line in enumerate(queue_path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError as exc:
            raise MigrateError(f"{queue_path}:{lineno}: not valid JSON — {exc}") from exc
        if not isinstance(data, dict):
            raise MigrateError(
                f"{queue_path}:{lineno}: expected an object, got {type(data).__name__}"
            )
        if not data.get("id"):
            raise MigrateError(
                f"{queue_path}:{lineno}: row has no 'id' — cannot become a task file"
            )
        _safe_id(data["id"], where=f"{queue_path}:{lineno}")
        rows.append(data)
    return rows


_PLAIN_SCALAR_RE = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_./-]*")
# Strings a YAML reader resolves to something that is not a string. `true`,
# `null`, `123` and `2026-09-02` all satisfy _PLAIN_SCALAR_RE, so matching that
# pattern is necessary but not sufficient: emitted bare, each would come back as
# a bool, None, an int or a date and silently change the field's type.
_YAML_RESOLVES_NONSTRING_RE = re.compile(
    r"""(?xi)
    ^(?:
        y|n|yes|no|true|false|on|off        # booleans, in every YAML 1.1 spelling
      | null|~|                             # nulls, the empty scalar included
      | [-+]?0b[01_]+                       # binary
      | [-+]?0o?[0-7_]+                     # octal, both spellings
      | [-+]?(?:[0-9][0-9_]*)               # decimal int
      | [-+]?0x[0-9a-f_]+                   # hex
      | [-+]?(?:[0-9][0-9_]*)?\.[0-9_]*     # float
      | [-+]?\.(?:inf|nan)                  # specials
      | [0-9]{4}-[0-9]{1,2}-[0-9]{1,2}.*    # date / timestamp
    )$"""
)


def _yaml_scalar(value: Any) -> str:
    """Quote only what needs it, so the common case stays byte-identical.

    `open_task_pr.sh` stamps `status: merged` bare, and these files are read back
    by both producers — emitting `status: "merged"` here would put the two out of
    step for no gain. Two kinds of value are quoted: one that is not a plain
    scalar at all (it carries ": ", opens with "#" or "-", or is empty), and one
    that *looks* plain but that a YAML reader resolves to something other than a
    string — `true`, `null`, `123`, `2026-09-02`. Both rewrite the meaning of the
    front matter; the second does it silently, by changing the field's type.
    """
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, int):
        return str(value)
    plain = _PLAIN_SCALAR_RE.fullmatch(value) and not _YAML_RESOLVES_NONSTRING_RE.match(value)
    return value if plain else json.dumps(value, ensure_ascii=False)


def _yaml_list(values: list[str]) -> str:
    """A YAML flow sequence whose items survive being read back.

    Each item is serialised, not concatenated. These values arrive as arbitrary
    JSON strings, so joining them raw turned the single tag `"needs, review"`
    into two items, and `"type: bug"` into a mapping nested inside the list —
    changing what the migrated file means, or making it unparseable.
    """
    return "[" + ", ".join(json.dumps(v, ensure_ascii=False) for v in values) + "]"


def task_markdown(row: dict[str, Any], payload_body: str, *, terminal: bool = False) -> str:
    deps = [str(d.get("id")) for d in row.get("deps", []) if isinstance(d, dict) and d.get("id")]
    # `ensure_ascii=False`: the default escapes every non-ASCII character to
    # `\uXXXX`, which a reader has to decode and a human cannot skim.
    title = json.dumps(str(row.get("title", row["id"])), ensure_ascii=False)
    lines = ["---", f"id: {row['id']}", f"title: {title}"]
    priority = row.get("priority", 0)
    lines.append(f"priority: {priority if isinstance(priority, int) else 0}")
    if deps:
        lines.append(f"deps: {_yaml_list(deps)}")
    if row.get("requires"):
        lines.append(f"requires: {_yaml_list([str(r) for r in row['requires']])}")
    if row.get("workspace"):
        lines.append(f"workspace: {json.dumps(str(row['workspace']), ensure_ascii=False)}")
    if row.get("tags"):
        lines.append(f"tags: {_yaml_list([str(t) for t in row['tags']])}")
    # Emitted through _yaml_scalar for the same reason `title` and `workspace` are
    # json.dumps'd: a legacy queue value carrying ": ", a leading "#" or a leading
    # "-" would otherwise change the meaning of the front matter — or make the file
    # unparseable — while the migration still reported success.
    if row.get("issue"):
        lines.append(f"issue: {_yaml_scalar(row['issue'])}")
    if terminal:
        # The status is what makes a dep on this task resolve as satisfied
        # rather than unknown, and it is recorded in the file because the issue
        # that once carried it may be closed, pruned, or never have existed.
        lines.append(f"status: {_yaml_scalar(row.get('status'))}")
        if row.get("pr"):
            lines.append(f"pr: {_yaml_scalar(row['pr'])}")
    max_attempts = row.get("max_attempts")
    if isinstance(max_attempts, int) and max_attempts != 3:
        lines.append(f"max-attempts: {max_attempts}")
    lines.append("---")
    lines.append("")
    body = payload_body.strip()
    if body:
        # Strip a leading H1 that just repeats the title — it is noise in a
        # file whose front matter already carries it.
        body = re.sub(r"\A#\s+.*\r?\n+", "", body)
        lines.append(body)
    else:
        lines.append(f"# {row.get('title', row['id'])}")
        lines.append("")
        lines.append("## Acceptance gate")
        lines.append("")
        lines.append("<!-- No gate was recorded for this task. Add a fenced bash block")
        lines.append("     below so completion can be checked mechanically. -->")
    lines.append("")
    return "\n".join(lines)


def migrate(
    repo_root: Path,
    queue_path: Path,
    home: Path,
    *,
    apply: bool,
    merge_policy: str,
) -> tuple[int, list[str]]:
    """Return (exit code, report lines)."""
    report: list[str] = []
    rows = read_rows(queue_path)
    queue_dir = queue_path.parent

    tasks_dir = home / "tasks"
    live = [r for r in rows if r.get("status") not in TERMINAL]
    finished = [r for r in rows if r.get("status") in TERMINAL]

    if not rows and not (repo_root / "claude-arsenal").exists():
        report.append("nothing to migrate: no queue file and no claude-arsenal/ tree")
        return 1, report

    report.append(f"queue: {len(rows)} row(s) — {len(live)} live, {len(finished)} terminal")

    def payload_for(row: dict[str, Any]) -> str:
        # `payload` is a path out of the legacy queue file, so it is contained
        # before it is read: a row carrying `../../.ssh/id_rsa` would otherwise
        # have its contents copied into a task file under `arsenal/tasks/`.
        payload_path = queue_dir / str(row.get("payload") or f"{row['id']}.md")
        try:
            resolved = _contained(payload_path, queue_dir, where=f"row {row['id']} payload")
        except MigrateError as exc:
            report.append(f"payload: {exc} — skipped")
            return ""
        return resolved.read_text(encoding="utf-8") if resolved.is_file() else ""

    created = skipped = 0
    for row in live:
        # `read_rows` already refused an unusable id; contained again here
        # because this is the write, and a write is where a traversal lands.
        target = tasks_dir / f"{_safe_id(row['id'], where='live row')}.md"
        _contained(target, tasks_dir, where=f"task file for {row['id']}")
        if target.exists():
            skipped += 1
            continue
        if apply:
            tasks_dir.mkdir(parents=True, exist_ok=True)
            target.write_text(task_markdown(row, payload_for(row)), encoding="utf-8")
        created += 1
    report.append(f"task files: {created} to create, {skipped} already present → {tasks_dir}/")

    # Finished tasks keep their files too. Recording them only as prose meant a
    # dep on completed work resolved as *unknown*, and the selector blocks on
    # unknown deps by design — so on a real board every task whose prerequisites
    # had just been finished became permanently unselectable. It also dropped
    # the payloads, and with them each finished task's gate, so a host check
    # that re-asserts them found nothing to check and passed in silence.
    history_dir = tasks_dir / HISTORY_DIRNAME
    kept = 0
    for row in finished:
        target = history_dir / f"{_safe_id(row['id'], where='terminal row')}.md"
        _contained(target, history_dir, where=f"history file for {row['id']}")
        if target.exists():
            continue
        if apply:
            history_dir.mkdir(parents=True, exist_ok=True)
            target.write_text(
                task_markdown(row, payload_for(row), terminal=True), encoding="utf-8"
            )
        kept += 1
    if finished:
        report.append(
            f"history files: {kept} terminal task(s) → {history_dir}/ "
            "(ids resolve, gates preserved)"
        )

    if finished:
        history = tasks_dir / "_migrated-history.md"
        if apply and not history.exists():
            tasks_dir.mkdir(parents=True, exist_ok=True)
            lines = [
                "# Completed before the migration",
                "",
                "Recorded so the history survives; these are not queue entries.",
                "",
            ]
            lines += [
                f"- `{r['id']}` — {r.get('title', '')} ({r.get('status')})"
                + (f" — {r['pr']}" if r.get("pr") else "")
                for r in finished
            ]
            history.write_text("\n".join(lines) + "\n", encoding="utf-8")
        report.append(f"history: {len(finished)} terminal task(s) → {history}")

    # Host-owned state out of the vendored prefix.
    for name in ("session", "project"):
        src = repo_root / "claude-arsenal" / name
        dst = home / name
        if not src.is_dir():
            continue
        if dst.exists():
            report.append(f"state: {dst} already exists — left alone")
            continue
        if apply:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
        report.append(f"state: {src} → {dst}")

    config = home / "config.toml"
    if not config.exists():
        template = config_template(repo_root)
        if template is None:
            report.append(
                f"config: {config} NOT created — init.py was not found, and it owns the "
                "template. Run /init; then set merge-policy = "
                f'"{merge_policy}" to keep the policy this queue was using.'
            )
        else:
            body = _MERGE_POLICY_LINE.sub(f'merge-policy = "{merge_policy}"', template, count=1)
            if apply:
                home.mkdir(parents=True, exist_ok=True)
                config.write_text(body, encoding="utf-8")
            report.append(f"config: create {config} (merge-policy = {merge_policy})")
    else:
        report.append(f"config: {config} already exists — left alone")

    report.append("")
    report.append("Then, by hand — a sandboxed session cannot delete refs:")
    report.append("  git push origin --delete arsenal-queue")
    report.append("  git worktree remove ../<repo>-arsenal-queue-wt   # if one exists")
    report.append("  rm -rf claude-arsenal/queue")
    report.append("")
    report.append(
        "Each live task also needs its issue handle; run handle_sync.py "
        "(in claude-arsenal/scripts/) to list the ones still missing."
    )

    if not apply:
        report.append("")
        report.append("(dry run — nothing written. Re-run with --apply.)")
    return 0, report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--queue", type=Path, help=f"default: {DEFAULT_QUEUE}")
    parser.add_argument("--home", type=Path, help="default: <repo-root>/arsenal")
    parser.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    parser.add_argument(
        "--merge-policy",
        default="after-ci",
        choices=["always", "after-review", "after-ci", "after-ci-and-review", "never"],
        help="seed value for the new config file",
    )
    args = parser.parse_args(argv)

    repo_root = args.repo_root
    queue_path = args.queue or (repo_root / DEFAULT_QUEUE)
    home = args.home or (repo_root / "arsenal")

    try:
        code, report = migrate(
            repo_root, queue_path, home, apply=args.apply, merge_policy=args.merge_policy
        )
    except MigrateError as exc:
        # Exit 2 and write nothing. A migration that skipped the row it could
        # not read and still reported success is how the only record of a task
        # gets deleted along with the old queue.
        print(f"arsenal_migrate: {exc}", file=sys.stderr)
        print("arsenal_migrate: nothing was written — fix the row and re-run.", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"arsenal_migrate: {exc}", file=sys.stderr)
        return 2

    for line in report:
        print(line)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
