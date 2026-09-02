#!/usr/bin/env python3
"""arsenal_config.py — read the host-owned `arsenal/config.toml`.

The point of this file is that a consumer configures behaviour **without
editing a skill**. Skills are vendored build output: an upgrade overwrites
them, so a preference stored in one is a preference that silently disappears.
`arsenal/config.toml` is host-owned and upstream never rewrites it.

Every key has a default, so a repo with no config file behaves sensibly and a
repo with a partial file only overrides what it names.

Keys are flat, except that a TOML table reads as dotted keys — `[models]`
with `workers = "sonnet"` is the key `models.workers`. Grouping the model
choices under one header is what lets a consumer state them the way they think
of them, rather than as two unrelated top-level strings.

Usage:
    arsenal_config.py                      # print the effective config as JSON
    arsenal_config.py --get merge-policy   # print one value, bare
    arsenal_config.py --get models.workers # dotted key: a value inside a table
    arsenal_config.py --explain            # show each value and where it came from

Exit: 0 on success, 2 on an invalid value (a typo in a policy name is a
configuration bug worth failing loudly for, not silently defaulting past).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tomllib
from pathlib import Path
from typing import Any

# Defaults live here rather than being scattered through the scripts that read
# them, so `--explain` can always say what the fallback is.
DEFAULTS: dict[str, Any] = {
    # How far a task PR must get before it may be merged. Read at the merge
    # step itself — `AGENTS.md` § Completion, expanded in
    # `references/github-automation.md`, which maps each value to a check.
    # It pointed at the `github` skill for six versions while nothing there,
    # or anywhere else in the bundle, ever read the key (#192): a policy
    # nothing consults decides nothing, and the cost is quiet — every merge
    # stops to ask a question the host already answered.
    "merge-policy": "after-ci",
    # Shell command run by open_task_pr.sh before a task PR is opened, refusing
    # on non-zero. Empty by default: a repo with no gate is unaffected. This is
    # what gives worker.md's "run the host lint gate" a data path — the prose
    # named `make lint` as its example, so a repo whose real gate is five
    # commands had four of them enforced by nobody.
    "host-gate": "",
    # Shell command run by bin/host_setup.sh in a fresh worktree, before the
    # first gate. Empty by default. A worktree carries tracked files and nothing
    # an install produces, so the first gate in one fails on a missing tool
    # rather than on the change under test — and every worker rediscovers that
    # separately. Naming the command here is what turns it from a diagnosis
    # into a step.
    "host-setup": "",
    # How hard the pre-PR adversarial review binds ON THE TASK-PR PATH. Read by
    # open_task_pr.sh and nowhere else, via bin/adversarial_review.sh, whose
    # `check` asks whether a reviewer that never saw this work cleared THIS
    # tree. It is not a global switch: `execution`, `github` and `ship` run the
    # same gate as a step of their own workflow, and a session following those
    # skills does not consult this key.
    #   warn      (default) open the PR either way, and record the outcome —
    #             cleared, blocked, stale, or never run — in the PR body, where
    #             the human merging it looks. Chosen as the default because a
    #             gate that breaks every existing worker loop on upgrade gets
    #             turned off, and one that says nothing gets forgotten.
    #   required  refuse to open the PR without a CLEAR receipt for this tree.
    #   off       skip the check and write no line.
    "pre-pr-review": "warn",
    # test-first writes a failing test before the change; test-after writes
    # tests alongside it. Read by `execution`.
    "test-discipline": "test-first",
    # What /session-end writes when a session closes.
    "session-end": "handoff",
    # The skills-listing character budget the auditor enforces. It is a real
    # constraint, but its value differs by surface and has changed over time,
    # so a consumer whose budget differs can set it here instead of being
    # unable to pass the audit at all (#143).
    "listing-budget": 8000,
    # Whether `/init` keeps .github/workflows/arsenal-queue.yml installed. Set
    # to `true` on first install and to `false` when the file is found deleted,
    # so removing it is a real opt-out rather than something the next session's
    # `init --silent` quietly undoes.
    "queue-automation": True,
    # The label an issue must carry before `issue_import.py` turns it into a
    # task. Opt-in on purpose: every open issue becoming claimable work means a
    # worker opens a PR against a question someone asked.
    "import-label": "arsenal:queue",
    # Where host-owned project content lives, relative to the repo root.
    "home": "arsenal",
    # The label that marks an issue as a machine-managed task handle. Anything
    # without it is never treated as claimable work, which is what keeps
    # ordinary issues people file out of the queue.
    "task-label": "arsenal:task",
    # Ref namespace for atomic claim refs.
    "claim-prefix": "arsenal/claims",
    # Which skill sections /init vendors into .claude/skills/, on top of the
    # always-installed core. Registered here so `--explain` can report them and
    # so the loader keeps them; the values are written by init.py from the
    # profile chosen at install, not hand-seeded into the config template —
    # one writer, so the shipped defaults and the recorded answer cannot drift.
    # The defaults here are what a FRESH install gets; an upgrade preserves
    # whatever the repo already had (init.py:_resolve_sections).
    "skills.workflow": True,
    "skills.python": False,
    # Which model runs the session that dispatches work. Advisory, and the one
    # key here nothing can enforce from inside a session: a session cannot
    # change the model it is already running as, so this is read and reported
    # at session start for the person launching it (`claude --model <value>`).
    # Empty means "whatever the session was launched with" — no opinion.
    "models.orchestrator": "",
    # Which model runs worker subagents. This one has a data path: the
    # orchestrator exports it as CLAUDE_CODE_SUBAGENT_MODEL before any Task
    # dispatch, so it governs every worker in the session. It used to be a
    # model id hardcoded in the protocol prose, which meant a consumer who
    # wanted a different one had to edit a vendored file an upgrade overwrites.
    "models.workers": "sonnet",
}

ENUMS: dict[str, set[str]] = {
    # `after-review` is not a weaker `after-ci-and-review` — it is the other
    # axis. `after-ci` is "the machines agree"; `after-review` is "a reader
    # agrees"; a repo should be able to require either, both, or neither.
    # Without it, a repo whose CI is structurally unavailable — out of runner
    # minutes, or no CI at all — can only choose between a policy that blocks
    # every merge indefinitely and one that everybody learns to wave through.
    "merge-policy": {"always", "after-review", "after-ci", "after-ci-and-review", "never"},
    "test-discipline": {"test-first", "test-after"},
    "session-end": {"handoff", "ticket", "none"},
    # open_task_pr.sh compares this against the literal "required", so anything
    # else — "Required", "requried", "on" — takes the warn path: the PR opens,
    # its body says no review ran, and the consumer who wrote the value believes
    # a binding gate is in place. A misspelled opt-out fails the other way,
    # writing a line into the body of someone who switched the check off.
    "pre-pr-review": {"warn", "required", "off"},
}

CONFIG_RELPATH = "config.toml"


class ConfigError(Exception):
    """An invalid configuration value — loud on purpose."""


def _config_path(repo_root: Path, home: str) -> Path:
    return repo_root / home / CONFIG_RELPATH


# A model may be an alias Claude Code resolves (`opus`, `sonnet`, `haiku`) or a
# full model id. Deliberately not an enum: model names change every few months,
# and a closed set here would reject the model a consumer is actually running
# — the vendored file would have to ship a new version to allow a name that
# already works everywhere else. So the check is on shape, not membership: a
# bare token, because the value ends up inside an exported environment
# variable, and anything with quotes, spaces or shell metacharacters in it is a
# typo at best.
MODEL_VALUE_REGEX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")

MODEL_KEYS = ("models.orchestrator", "models.workers")


def _flatten(raw: dict[str, Any]) -> dict[str, Any]:
    """One level of TOML table → dotted keys: `[models] workers=` → `models.workers`.

    Only one level, because the config is a flat list of settings that happens
    to group two of them. Recursing would invite a nesting depth nobody reading
    `--explain` output could hold in their head.
    """
    flat: dict[str, Any] = {}
    for key, value in raw.items():
        if isinstance(value, dict):
            for sub, subvalue in value.items():
                flat[f"{key}.{sub}"] = subvalue
        else:
            flat[key] = value
    return flat


def load(repo_root: Path | None = None) -> tuple[dict[str, Any], dict[str, str]]:
    """Return (effective config, source-of-each-value).

    Sources are reported so `--explain` can print "8000 (default)" versus
    "12000 (arsenal/config.toml)". A threshold whose value is invisible in the
    output is one nobody can tell has been quietly raised.
    """
    root = repo_root or Path.cwd()
    values: dict[str, Any] = dict(DEFAULTS)
    sources: dict[str, str] = dict.fromkeys(DEFAULTS, "default")

    # ARSENAL_HOME may relocate the whole host-owned tree; it also decides
    # where we look for the config itself, so it is resolved first.
    home = os.environ.get("ARSENAL_HOME", DEFAULTS["home"])
    if home != DEFAULTS["home"]:
        values["home"] = home
        sources["home"] = "ARSENAL_HOME"

    path = _config_path(root, home)
    if path.is_file():
        try:
            raw = tomllib.loads(path.read_text(encoding="utf-8"))
        except tomllib.TOMLDecodeError as exc:
            raise ConfigError(f"{path}: not valid TOML — {exc}") from exc
        for key, value in _flatten(raw).items():
            if key not in DEFAULTS:
                # Unknown keys are tolerated rather than fatal: a consumer on
                # an older bundle should not break when a newer one adds a key,
                # and vice versa.
                continue
            values[key] = value
            sources[key] = str(path)

    for key, allowed in ENUMS.items():
        if values[key] not in allowed:
            raise ConfigError(
                f"{key}: {values[key]!r} is not one of {sorted(allowed)} (from {sources[key]})"
            )
    # Same strictness init.py applies when it reads this table: a non-boolean
    # here decides whether skills are installed or pruned, so a typo must stop
    # rather than be coerced.
    for key in (k for k in DEFAULTS if k.startswith("skills.")):
        if not isinstance(values[key], bool):
            raise ConfigError(
                f"{key} must be true or false, got {values[key]!r} (from {sources[key]})"
            )
    # `type(...) is int`, not `isinstance`: `bool` subclasses `int` in Python, so
    # `listing-budget = true` passed validation and produced `True` — which then
    # behaves as the number 1 everywhere downstream, capping the skills listing
    # at one character rather than being refused as the wrong type.
    if type(values["listing-budget"]) is not int or values["listing-budget"] <= 0:
        raise ConfigError(
            f"listing-budget must be a positive integer, got {values['listing-budget']!r}"
        )
    for key in MODEL_KEYS:
        value = values[key]
        if not isinstance(value, str):
            raise ConfigError(f"{key} must be a string, got {value!r} (from {sources[key]})")
        # Empty is meaningful for the orchestrator ("no opinion, use whatever
        # the session was launched with") and meaningless for workers, which
        # would export an empty CLAUDE_CODE_SUBAGENT_MODEL and silently get the
        # default — a setting that looks configured and is not.
        if value == "":
            if key == "models.workers":
                raise ConfigError(
                    "models.workers cannot be empty — name a model, or remove the key "
                    f"to get the default {DEFAULTS['models.workers']!r}"
                )
            continue
        if not MODEL_VALUE_REGEX.match(value):
            raise ConfigError(
                f"{key}: {value!r} is not a model name — expected an alias like "
                f"'opus' or a model id like 'claude-sonnet-4-6' (from {sources[key]})"
            )

    return values, sources


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--get", metavar="KEY", help="print a single value, bare")
    parser.add_argument("--explain", action="store_true", help="show each value and its source")
    args = parser.parse_args(argv)

    try:
        values, sources = load(args.repo_root)
    except ConfigError as exc:
        print(f"arsenal_config: {exc}", file=sys.stderr)
        return 2

    if args.get:
        if args.get not in values:
            print(f"arsenal_config: unknown key {args.get!r}", file=sys.stderr)
            return 2
        print(values[args.get])
        return 0

    if args.explain:
        width = max(len(k) for k in values)
        for key in sorted(values):
            src = "default" if sources[key] == "default" else sources[key]
            print(f"{key:<{width}}  {values[key]}   ({src})")
        return 0

    print(json.dumps(values, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
