#!/usr/bin/env python3
"""queue_hooks.py — the queue's state transitions, run by GitHub rather than by a session.

`Closes #<issue>` makes merging a PR close its task, and that covers the happy
path completely. What it does not cover is everything that happens when no
session is running:

* a PR closed **without** merging leaves its issue assigned and labelled
  `arsenal:claimed` — the task is not done, but no selector will ever offer it
  again, so the work silently disappears from the board;
* a task file merged to the default branch has **no issue handle** until someone
  runs `handle_sync.py`, so it is invisible work until the next session does
  chores before it can start;
* a session that crashes mid-task leaves a claim nobody releases;
* a PR opened by hand — no keyword, or a keyword pointing nowhere — merges and
  closes nothing.

Each of those used to be a line in a protocol asking an agent to remember
something at the end of a session, which is the least reliable place to put it:
the sessions that most need cleaning up are exactly the ones that ended badly.
So they run here instead, triggered by GitHub events, whether or not anybody is
watching.

    queue_hooks.py pr-closed      # on: pull_request_target [closed]
    queue_hooks.py sync-handles   # on: push to the default branch, arsenal/tasks/**
    queue_hooks.py sweep-claims   # on: schedule

Deciding and doing are split: every subcommand builds a list of actions from
its inputs with no network at all, then applies them. `--dry-run` prints the
plan as JSON and touches nothing, which is how the behaviour is tested without
a GitHub in the loop.

Exit: 0 when the plan applied (or was printed), 1 when an action failed,
2 on unusable input.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from handle_sync import missing_handles
from issue_for_task import issue_number_for
from task_select import TERMINAL, load_tasks, task_id_from_issue

CLAIMED_LABEL = "arsenal:claimed"
TASK_LABEL = "arsenal:task"
API_ROOT = "https://api.github.com"


# ---------------------------------------------------------------- pure planning


def task_id_from_branch(ref: str, known_ids: set[str]) -> str | None:
    """The task a branch belongs to, from `arsenal/<task-id>-<slug>`.

    Matched against the ids that actually exist rather than parsed, because a
    task id may itself contain hyphens (`lo-a3f8`) and splitting on the first
    one would silently address the wrong task. The longest match wins for the
    same reason: `t-3f8a` must not swallow a branch belonging to `t-3f8a91c2`.
    """
    if not ref.startswith("arsenal/"):
        return None
    tail = ref[len("arsenal/") :]
    matches = [i for i in known_ids if tail == i or tail.startswith(f"{i}-")]
    return max(matches, key=len) if matches else None


def _is_claimed(issue: dict[str, Any]) -> bool:
    labels = {
        label["name"] if isinstance(label, dict) else str(label)
        for label in (issue.get("labels") or [])
    }
    return CLAIMED_LABEL in labels or bool(issue.get("assignee") or issue.get("assignees"))


def _find_issue(number: int, issues: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next((i for i in issues if i.get("number") == number), None)


def plan_pr_closed(
    event: dict[str, Any],
    tasks: list[dict[str, Any]],
    issues: list[dict[str, Any]],
    *,
    truncated: bool = False,
) -> list[dict[str, Any]]:
    """What a closed PR means for the queue.

    A merge **into the default branch** is a completion; a close without a merge
    is a release. Both are facts GitHub already knows, so neither needs a session
    to record it.

    The default-branch condition is not a detail. A stacked PR merges into the
    previous branch in the stack, and its work has not reached the default branch
    yet — closing the task there would mark it done while the code is still one
    or more merges away from landing. GitHub's own `Closes` keyword has exactly
    this rule, and a backstop looser than the mechanism it backs up would quietly
    undo it.
    """
    pull = event.get("pull_request") or {}
    number = pull.get("number")
    url = pull.get("html_url") or f"#{number}"
    merged = bool(pull.get("merged"))

    # A PR from a fork decides nothing about this queue. Task identity is read
    # from `head.ref` and, failing that, from the PR body — and a fork author
    # controls both. The workflow that calls this runs on `pull_request_target`
    # with `issues: write`, so a fork PR closed without merging could reach
    # `release-claim` and strip a claim another session legitimately holds. An
    # `arsenal/*` head ref is not proof of anything: fork authors name their own
    # branches.
    #
    # Checked here as well as in the workflow's `if:` condition, because the
    # workflow is installed into a consumer repo by `/init` and may be an older
    # copy than this script.
    head_repo = str(((pull.get("head") or {}).get("repo") or {}).get("full_name") or "")
    base_repo = str(
        ((pull.get("base") or {}).get("repo") or {}).get("full_name")
        or (event.get("repository") or {}).get("full_name")
        or ""
    )
    # Keyed on the BASE repo, not on the head repo being present. GitHub sends
    # `head.repo: null` once the fork is deleted or made private, which is the
    # same fork with its provenance missing — and a payload an attacker can
    # produce on demand by deleting the fork after opening the PR. Once the base
    # repo is known, anything that does not match it is outside. A payload
    # carrying no repository information at all stays lenient: that is a caller
    # constructing an event by hand, not a fork.
    if base_repo and head_repo != base_repo:
        return [
            {
                "kind": "note",
                "message": (
                    f"PR {url}: opened from fork '{head_repo or '?'}' — ignored. A pull "
                    "request from outside this repository cannot close or release a task."
                ),
            }
        ]

    head_ref = str((pull.get("head") or {}).get("ref") or "")
    base_ref = str((pull.get("base") or {}).get("ref") or "")
    default_branch = str(
        (event.get("repository") or {}).get("default_branch")
        or ((pull.get("base") or {}).get("repo") or {}).get("default_branch")
        or ""
    )
    into_default = bool(default_branch) and base_ref == default_branch

    known = {t["id"] for t in tasks}
    task_id = task_id_from_branch(head_ref, known)
    if task_id is None:
        # A PR opened by hand may still name its task in the body, which is the
        # same marker an issue handle uses.
        task_id = task_id_from_issue({"body": pull.get("body") or ""})
        if task_id not in known:
            task_id = None
    if task_id is None:
        return [{"kind": "note", "message": f"PR {url}: not an arsenal task branch — ignored"}]

    issue_number = issue_number_for(task_id, issues)
    if issue_number is None:
        if truncated:
            # "Not in the listing" and "does not exist" are the same observation
            # here, and only one of them is safe to act on. The handle may simply
            # have sat past the pagination cap, in which case treating it as
            # absent leaves a merged task closing nothing and its issue open and
            # claimed forever. Unlike sync-handles and sweep-claims this command
            # cannot just refuse and run again later — it is driven by a webhook
            # that fires once — so it reports loudly instead, and the run goes red
            # with the task named for a human to finish by hand.
            return [
                {
                    "kind": "unresolved",
                    "task": task_id,
                    "message": (
                        f"PR {url}: could not resolve the issue handle for task {task_id} "
                        "because the issue listing was truncated at the pagination cap. "
                        "This PR's task may still be open and claimed — check it and close "
                        "it by hand, then narrow the board (close or re-label finished "
                        "tasks) so the listing fits."
                    ),
                }
            ]
        return [
            {
                "kind": "note",
                "message": f"PR {url}: task {task_id} has no issue handle — nothing to update",
            }
        ]
    issue = _find_issue(issue_number, issues) or {}
    is_open = str(issue.get("state", "open")).lower() == "open"

    if merged and not into_default:
        return [
            {
                "kind": "note",
                "message": (
                    f"PR {url}: merged into '{base_ref}', not the default branch "
                    f"'{default_branch or '?'}' — task {task_id} is not done until that "
                    "commit lands on the default branch"
                ),
            }
        ]

    if merged:
        actions: list[dict[str, Any]] = []
        if is_open:
            # The keyword should already have done this. Reaching here means it
            # was missing, pointed elsewhere, or the merge went into a branch
            # that does not fire it — all of which used to end as a task stuck
            # in `claimed` until a human noticed.
            actions.append(
                {
                    "kind": "close-issue",
                    "issue": issue_number,
                    "task": task_id,
                    "comment": (
                        f"Closed by {url}, which merged without a `Closes` keyword taking "
                        f"effect. Task `{task_id}` is done."
                    ),
                }
            )
        else:
            actions.append(
                {
                    "kind": "note",
                    "message": f"PR {url}: issue #{issue_number} already closed — nothing to do",
                }
            )
        task = next((t for t in tasks if t["id"] == task_id), None)
        if task and task.get("status") not in TERMINAL and "_history" not in task["path"]:
            actions.append({"kind": "archive-task", "task": task_id, "path": task["path"]})
        return actions

    if is_open and _is_claimed(issue):
        return [
            {
                "kind": "release-claim",
                "issue": issue_number,
                "task": task_id,
                "comment": (
                    f"{url} was closed without merging, so task `{task_id}` is not done. "
                    "Releasing the claim so the queue offers it again."
                ),
            }
        ]
    return [
        {
            "kind": "note",
            "message": f"PR {url}: issue #{issue_number} holds no claim — nothing to release",
        }
    ]


# `Closes #12`, `Fixes #12`, `Resolved #12` — GitHub's own closing vocabulary,
# with the number captured so it can be checked against the task's own issue.
CLOSING_REFERENCE = re.compile(
    r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b", re.IGNORECASE
)


def check_keyword(
    event: dict[str, Any],
    tasks: list[dict[str, Any]],
    issues: list[dict[str, Any]],
    commit_messages: list[str],
    *,
    truncated: bool = False,
) -> tuple[bool, str]:
    """Whether this task PR closes ITS OWN issue. Returns (ok, message).

    Accepting any `Closes #N` was the hole: a task PR could satisfy the guard
    while pointing at an unrelated issue, so the merge closed that issue and
    left the task's own one open and claimed — the exact drift the guard exists
    to prevent, now with a green check beside it.
    """
    pull = event.get("pull_request") or {}
    url = pull.get("html_url") or f"#{pull.get('number')}"
    head_ref = str((pull.get("head") or {}).get("ref") or "")

    known = {t["id"] for t in tasks}
    task_id = task_id_from_branch(head_ref, known)
    if task_id is None:
        # Same fallback `plan_pr_closed` uses: a PR opened by hand names its task
        # in the body, not in the branch name. Without this the branch name alone
        # decided whether the guard applied, so a hand-opened task PR carrying
        # `Closes #<unrelated issue>` passed — and its merge closed that issue
        # while the backstop separately closed the task's own one. That is the
        # very drift this guard exists to prevent.
        task_id = task_id_from_issue({"body": pull.get("body") or ""})
        if task_id not in known:
            task_id = None
    if task_id is None:
        return True, f"PR {url}: '{head_ref}' is not a known task branch — guard does not apply"

    issue_number = issue_number_for(task_id, issues)
    if issue_number is None:
        if truncated:
            # The fail-open below rests on "no handle exists yet". A truncated
            # listing cannot support that reading: the handle may sit past the
            # pagination cap, in which case this PR's `Closes #N` names some
            # OTHER issue and merging closes it — precisely the drift this guard
            # exists to prevent, waved through with a green check. `pr-closed` is
            # no backstop for it either, because by then the wrong issue is
            # already closed. So the one case where the answer is unknowable
            # fails, and says what a human has to do about it.
            return False, (
                f"PR {url}: the `{TASK_LABEL}` issue listing was truncated at the pagination "
                f"cap, so task {task_id}'s issue handle could not be resolved — it may exist "
                "beyond the cap. Merging now could close an unrelated issue. Confirm the task's "
                "own issue number by hand and check that this PR's closing keyword names it."
            )
        # No handle to point at yet. Failing here would block the PR on
        # something the author cannot fix from the PR, so it is a pass with a
        # note; `sync-handles` opens the issue and `plan_pr_closed` still
        # reconciles on merge.
        #
        # Only sound because the listing was WHOLE: "not in a complete listing"
        # really does mean "does not exist".
        return True, (
            f"PR {url}: task {task_id} has no issue handle yet — nothing to reference. "
            "sync-handles will open one."
        )

    referenced = {
        int(m)
        for text in [str(pull.get("body") or ""), *commit_messages]
        for m in CLOSING_REFERENCE.findall(text)
    }
    if issue_number in referenced:
        return True, f"PR {url}: closes #{issue_number}, the issue for task {task_id}."

    if referenced:
        return False, (
            f"PR {url} closes {', '.join('#' + str(n) for n in sorted(referenced))}, but task "
            f"{task_id}'s own issue is #{issue_number}. Merging this would close an unrelated "
            f"issue and leave #{issue_number} open and claimed. Point the keyword at "
            f"#{issue_number}."
        )
    return False, (
        f"PR {url} is on task branch '{head_ref}' but neither its body nor any of its commits "
        f"closes #{issue_number}, the issue for task {task_id}. Merging it would land the work "
        "and leave the task claimed forever, which is the drift the queue exists to prevent.\n"
        f"Add `Closes #{issue_number}` to the PR body, or to a commit message if this PR is "
        "stacked on another branch. `claude-arsenal/bin/open_task_pr.sh` writes both "
        "automatically — a PR missing them was opened by hand."
    )


def _refuse_on_truncation(api: Api | None, command: str) -> bool:
    """Stop a state-changing command that was handed a partial listing.

    Both of these commands write to the board from what they read. Acting on a
    truncated view is not a smaller version of the right answer — it is the
    wrong one, and it writes: a duplicate issue for a task whose handle sat past
    the cap, or a released claim whose open PR was never seen. Refusing costs a
    delayed run; proceeding costs queue state.
    """
    if api is None or not api.truncated:
        return False
    print(
        f"queue_hooks: refusing to run {command} — a GitHub listing was truncated at the "
        "pagination cap, so the plan would be built from an incomplete board. Narrow the "
        "query (close or re-label finished tasks) and re-run.",
        file=sys.stderr,
    )
    return True


def plan_sync_handles(
    tasks: list[dict[str, Any]], issues: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """An issue for every task file that has none. One-directional and idempotent.

    The warnings are collected rather than dropped: this is the caller that runs
    unattended, and `missing_handles` holds a task back — or proposes it marked
    `ambiguous`, which this caller reports and does not create — when an
    unresolved issue is a near-match for it. Without them the workflow reported "nothing to do"
    for a task that has no handle and is therefore invisible to the board — the
    diagnostic existed, and was reachable only from the interactive path.
    """
    warnings: list[str] = []
    rows = missing_handles(tasks, issues, label=TASK_LABEL, warnings=warnings)
    return [
        {"kind": "note", "message": f"handle_sync: {warning}"} for warning in warnings
    ] + [
        {
            "kind": "create-issue",
            "task": row["task"],
            "title": row["title"],
            "body": row["body"],
            "labels": row["labels"],
        }
        # A row marked ambiguous names a collision the id resolution cannot
        # settle: an unresolved issue that is the handle for at most one of
        # several tasks. Creating it here would put a second issue on the board
        # for whichever one it already covered, unattended and unreviewed. The
        # warning above already carries the row, so nothing is hidden — the
        # decision is just left to someone who can make it (#239).
        for row in rows
        if not row.get("ambiguous")
    ]


def plan_sweep_claims(
    issues: list[dict[str, Any]],
    open_prs: list[dict[str, Any]],
    *,
    now: datetime,
    max_age_hours: int,
    known_ids: set[str],
) -> list[dict[str, Any]]:
    """Release claims held by sessions that are never coming back.

    A claim ref cannot be deleted from a sandboxed session, so a crashed session
    leaves its `arsenal:claimed` label behind forever. The retry path already
    handles the ref (attempt *n* claims a new one); this handles the label, which
    is what actually hides the task from the board.

    An open PR on the task's branch is proof the work is still live, so age alone
    never releases a claim — only age with nothing to show for it.
    """
    cutoff = now - timedelta(hours=max_age_hours)
    busy = {
        task_id
        for pr in open_prs
        if (task_id := task_id_from_branch(str((pr.get("head") or {}).get("ref") or ""), known_ids))
    }

    actions: list[dict[str, Any]] = []
    for issue in issues:
        if str(issue.get("state", "open")).lower() != "open" or not _is_claimed(issue):
            continue
        task_id = task_id_from_issue(issue)
        if not task_id or task_id in busy:
            continue
        updated = _parse_ts(issue.get("updated_at"))
        if updated is None or updated > cutoff:
            continue
        actions.append(
            {
                "kind": "release-claim",
                "issue": issue["number"],
                "task": task_id,
                "comment": (
                    f"Claim on `{task_id}` has been held for over {max_age_hours}h with no open "
                    "PR. The session that took it is not coming back, so the claim is released "
                    "and the task is on the board again."
                ),
            }
        )
    return actions


def _parse_ts(raw: Any) -> datetime | None:
    if not isinstance(raw, str):
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


# ---------------------------------------------------------------- applying


class Api:
    """The smallest GitHub REST client that covers these actions."""

    # GitHub's own listing cap for this client: 10 pages of 100. The
    # eleventh request paginate() may make is a probe, never collected.
    MAX_PAGES = 10

    def __init__(self, repo: str, token: str) -> None:
        self.repo = repo
        self.token = token
        # Set by paginate() when a listing hits the page cap. A warning alone was
        # not enough: every command acts on what it was handed, so a partial view
        # makes sync-handles open a duplicate issue for a task whose handle sat
        # past the cap, sweep-claims release a claim whose PR it never saw, and
        # pr-closed read a merged task as having no handle at all. The flag is
        # what lets the first two refuse and the third report.
        self.truncated = False


    def request(self, method: str, path: str, body: Any = None) -> Any:
        url = path if path.startswith("http") else f"{API_ROOT}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        req.add_header("Accept", "application/vnd.github+json")
        if data:
            req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=30) as response:
            payload = response.read()
        return json.loads(payload) if payload else None

    def paginate(self, path: str) -> list[dict[str, Any]]:
        """Up to `MAX_PAGES` pages, with one extra request to prove truncation.

        A tenth page that comes back exactly full is ambiguous: it is what a list
        of 1,001 records looks like, and equally what a list of exactly 1,000
        looks like. Inferring truncation from it declared every board of exactly
        1,000 incomplete, and `_refuse_on_truncation` then refused sync-handles
        and sweep-claims on a board that was whole. Page 11 settles it — empty
        means the listing simply ended, and it costs one request only in the case
        that was previously guessed at.
        """
        out: list[dict[str, Any]] = []
        page = 1
        while page <= self.MAX_PAGES + 1:
            sep = "&" if "?" in path else "?"
            chunk = self.request("GET", f"{path}{sep}per_page=100&page={page}")
            if not isinstance(chunk, list) or not chunk:
                break
            if page > self.MAX_PAGES:
                # The probe came back with records, so the list really does run
                # past the cap. They are deliberately not collected: returning a
                # partial eleventh page would make the truncation harder to see,
                # not smaller.
                self.truncated = True
                print(
                    f"queue_hooks: {path} returned more than {len(out)} records — the list "
                    "is truncated, so plans built from it are incomplete",
                    file=sys.stderr,
                )
                break
            out.extend(chunk)
            if len(chunk) < 100:
                break
            page += 1
        return out

    def issues(self, label: str, state: str = "all") -> list[dict[str, Any]]:
        quoted = urllib.parse.quote(label, safe="")
        # /issues returns pull requests too; a PR is not a handle.
        return [
            i
            for i in self.paginate(f"/repos/{self.repo}/issues?labels={quoted}&state={state}")
            if "pull_request" not in i
        ]

    def open_prs(self) -> list[dict[str, Any]]:
        return self.paginate(f"/repos/{self.repo}/pulls?state=open")

    def pr_commit_messages(self, number: int) -> list[str]:
        """Commit messages on one PR — where a stacked PR carries its keyword."""
        return [
            str((c.get("commit") or {}).get("message") or "")
            for c in self.paginate(f"/repos/{self.repo}/pulls/{number}/commits")
        ]


def apply_action(action: dict[str, Any], api: Api | None, *, tasks_dir: Path) -> bool:
    """Perform one planned action. Returns False when it failed."""
    kind = action["kind"]
    if kind == "note":
        print(f"queue_hooks: {action['message']}")
        return True

    # Not a failed action — an action that could not be planned. It returns False
    # so the run exits non-zero, which is the only way a once-only webhook makes
    # itself visible to a human.
    if kind == "unresolved":
        print(f"queue_hooks: {action['message']}", file=sys.stderr)
        return False

    if kind == "archive-task":
        return _archive(action, tasks_dir)

    if api is None:
        print(f"queue_hooks: no API token — cannot apply {kind}", file=sys.stderr)
        return False

    # `create-issue` is the one action with no issue number — it is what creates
    # one. Validating the number before dispatching by kind made that branch
    # unreachable, so `sync-handles` could plan a handle and never open it.
    number = -1
    if kind != "create-issue":
        raw_number = action.get("issue")
        if not isinstance(raw_number, int):
            print(f"queue_hooks: {kind} carries no issue number — skipped", file=sys.stderr)
            return False
        number = raw_number
    try:
        if kind == "close-issue":
            comment = {"body": action["comment"]}
            api.request("POST", f"/repos/{api.repo}/issues/{number}/comments", comment)
            api.request(
                "PATCH",
                f"/repos/{api.repo}/issues/{number}",
                {"state": "closed", "state_reason": "completed"},
            )
            _drop_claim(api, number)
            print(f"queue_hooks: closed #{number} as completed ({action['task']})")
        elif kind == "release-claim":
            _drop_claim(api, number)
            # No assignee is the desired end state, so a refusal to unassign is
            # not worth failing the release over — the label is what hides the
            # task from the selector.
            with contextlib.suppress(urllib.error.HTTPError):
                api.request(
                    "DELETE",
                    f"/repos/{api.repo}/issues/{number}/assignees",
                    {"assignees": [a["login"] for a in _assignees(api, number)]},
                )
            api.request(
                "POST",
                f"/repos/{api.repo}/issues/{number}/comments",
                {"body": action["comment"]},
            )
            print(f"queue_hooks: released the claim on #{number} ({action['task']})")
        elif kind == "create-issue":
            created = api.request(
                "POST",
                f"/repos/{api.repo}/issues",
                {"title": action["title"], "body": action["body"], "labels": action["labels"]},
            )
            print(f"queue_hooks: opened #{(created or {}).get('number')} for {action['task']}")
        else:
            print(f"queue_hooks: unknown action {kind}", file=sys.stderr)
            return False
    except urllib.error.HTTPError as exc:
        print(
            f"queue_hooks: {kind} on #{number} failed — HTTP {exc.code} {exc.reason}",
            file=sys.stderr,
        )
        return False
    except urllib.error.URLError as exc:
        print(f"queue_hooks: {kind} on #{number} failed — {exc.reason}", file=sys.stderr)
        return False
    return True


def _assignees(api: Api, number: int) -> list[dict[str, Any]]:
    issue = api.request("GET", f"/repos/{api.repo}/issues/{number}")
    return (issue or {}).get("assignees") or []


def _drop_claim(api: Api, number: int) -> None:
    quoted = urllib.parse.quote(CLAIMED_LABEL, safe="")
    try:
        api.request("DELETE", f"/repos/{api.repo}/issues/{number}/labels/{quoted}")
    except urllib.error.HTTPError as exc:
        if exc.code != 404:  # the label was not there; that is the desired state
            raise


def _archive(action: dict[str, Any], tasks_dir: Path) -> bool:
    """Move a merged task's file into `_history/` and push it.

    Normally the PR carries this itself (`open_task_pr.sh` does the rename as
    part of the diff), so this only fires for a PR opened by hand. Failing to
    push is not fatal: the issue is already closed, which is what the board
    reads, and a task file left live shows up as a `done but still live` problem
    on the next `query_status.py` run rather than as silent drift.
    """
    live = Path(action["path"])
    if not live.is_file():
        print(f"queue_hooks: {live} already archived")
        return True
    history = tasks_dir / "_history"
    history.mkdir(parents=True, exist_ok=True)
    target = history / live.name

    text = live.read_text(encoding="utf-8")
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end != -1:
            front = text[4:end]
            front = (
                "\n".join(
                    line for line in front.splitlines() if not line.startswith("status:")
                )
                + "\nstatus: merged"
            )
            text = f"---\n{front}\n---\n" + text[end + 5 :]
    target.write_text(text, encoding="utf-8")
    live.unlink()

    commands = [
        ["git", "config", "user.name", "github-actions[bot]"],
        ["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
        ["git", "add", "-A", str(tasks_dir)],
        ["git", "commit", "-m", f"chore(queue): archive {action['task']} after merge"],
        ["git", "push"],
    ]
    for command in commands:
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0 and command[1] == "push":
            print(
                f"queue_hooks: archived {live.name} but could not push "
                f"({result.stderr.strip()}) — the issue is closed, so the board is correct; "
                "the file will be archived by the next PR that touches it",
                file=sys.stderr,
            )
            return True
    print(f"queue_hooks: archived {live.name} to _history/")
    return True


# ---------------------------------------------------------------- cli


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", choices=["pr-closed", "sync-handles", "sweep-claims", "keyword-guard"]
    )
    parser.add_argument(
        "--commits", type=Path, default=None,
        help="JSON array of commit messages, for keyword-guard instead of fetching",
    )
    parser.add_argument("--tasks-dir", type=Path, default=Path("arsenal/tasks"))
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", ""))
    parser.add_argument(
        "--event", type=Path, default=None, help="event JSON (default $GITHUB_EVENT_PATH)"
    )
    parser.add_argument("--issues", type=Path, default=None, help="issue JSON, instead of fetching")
    parser.add_argument("--prs", type=Path, default=None, help="open-PR JSON, instead of fetching")
    parser.add_argument("--max-age-hours", type=int, default=24)
    parser.add_argument("--now", default=None, help="ISO timestamp, for tests")
    parser.add_argument("--dry-run", action="store_true", help="print the plan, change nothing")
    args = parser.parse_args(argv)

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
    api = Api(args.repo, token) if (token and args.repo) else None

    tasks, warnings = load_tasks(args.tasks_dir)
    for warning in warnings:
        print(f"queue_hooks: {warning}", file=sys.stderr)

    try:
        if args.issues is not None:
            issues = [i for i in _load_json(args.issues) if isinstance(i, dict)]
        elif api is not None:
            issues = api.issues(TASK_LABEL)
        else:
            print("queue_hooks: no --issues and no usable token", file=sys.stderr)
            return 2
        # Read HERE, before anything else paginates. `Api.truncated` is one
        # sticky flag across every listing, and keyword-guard goes on to page
        # through the PR's commits: a long enough commit list would raise the
        # flag and make the guard reject a PR whose ISSUE listing was complete
        # and whose handle is simply absent — turning a deliberate fail-open
        # into a rejection the author cannot act on. Only the completeness of
        # the issue listing says anything about whether a handle exists.
        issues_truncated = bool(args.issues is None and api is not None and api.truncated)

        if args.command == "keyword-guard":
            # Returns straight from here: this command reports a verdict on
            # stdout and exits, rather than producing queue actions to apply.
            event_path = args.event or Path(os.environ.get("GITHUB_EVENT_PATH", ""))
            if not event_path or not event_path.is_file():
                print("queue_hooks: no event payload to read", file=sys.stderr)
                return 2
            event = _load_json(event_path)
            if args.commits is not None:
                commits = [str(m) for m in _load_json(args.commits)]
            elif api is not None:
                number = (event.get("pull_request") or {}).get("number")
                commits = api.pr_commit_messages(int(number)) if number else []
            else:
                commits = []
            # Narrower than refusing on any truncation: a handle that resolved
            # within the cap is the right issue number whether or not the listing
            # ran past it, and failing those PRs too would block every task PR on
            # a board large enough to truncate. Only the unresolvable case is
            # actually unknowable, and that is where check_keyword fails.
            ok, message = check_keyword(
                event,
                tasks,
                issues,
                commits,
                truncated=issues_truncated,
            )
            print(message, file=sys.stdout if ok else sys.stderr)
            return 0 if ok else 1

        if args.command == "pr-closed":
            event_path = args.event or Path(os.environ.get("GITHUB_EVENT_PATH", ""))
            if not event_path or not event_path.is_file():
                print("queue_hooks: no event payload to read", file=sys.stderr)
                return 2
            actions = plan_pr_closed(
                _load_json(event_path),
                tasks,
                issues,
                truncated=issues_truncated,
            )
        elif args.command == "sync-handles":
            if _refuse_on_truncation(api, "sync-handles"):
                return 2
            actions = plan_sync_handles(tasks, issues)
        else:
            if args.prs is not None:
                prs = [p for p in _load_json(args.prs) if isinstance(p, dict)]
            elif api is not None:
                prs = api.open_prs()
            else:
                prs = []
            if _refuse_on_truncation(api, "sweep-claims"):
                return 2
            now = _parse_ts(args.now) or datetime.now(UTC)
            actions = plan_sweep_claims(
                issues,
                prs,
                now=now,
                max_age_hours=args.max_age_hours,
                known_ids={t["id"] for t in tasks},
            )
    except (OSError, json.JSONDecodeError) as exc:
        print(f"queue_hooks: unusable input — {exc}", file=sys.stderr)
        return 2

    if args.dry_run:
        for action in actions:
            print(json.dumps(action, separators=(",", ":"), sort_keys=True))
        return 0

    if not actions:
        print("queue_hooks: nothing to do")
        return 0

    ok = True
    for action in actions:
        ok = apply_action(action, api, tasks_dir=args.tasks_dir) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
