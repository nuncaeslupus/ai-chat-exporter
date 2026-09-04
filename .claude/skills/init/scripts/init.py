#!/usr/bin/env python3
"""init.py - Bootstrap or update claude-arsenal/ in a host repository."""
import argparse
import contextlib
import hashlib
import json
import os
import re
import shutil
import sys
import tomllib
from pathlib import Path
from typing import Any

CLAUDE_MD_MARKER = "<!-- claude-arsenal: auto-managed -->"
CLAUDE_MD_END_MARKER = "<!-- /claude-arsenal: auto-managed -->"
# How the block ended before it had a closing marker.
LEGACY_BLOCK_TAIL = "@claude-arsenal/AGENTS.md"

# `{home}` is substituted with the resolved host tree — the block is
# auto-managed and rewritten on every init, so a hand-corrected path would be
# overwritten anyway; it has to be generated right instead.
_CLAUDE_MD_TEMPLATE = """\
<!-- claude-arsenal: auto-managed -->
## Automatic session protocol

**Were you spawned by another session, with a task already assigned?** Then skip
straight to that task. Steps 2-5 below need the GitHub API, and a spawned session
has no `mcp__*` tools — implement, run the gate, and let
`claude-arsenal/bin/open_task_pr.sh` push. It prints `branch:<name>` when it
cannot open the PR here; return that line and stop. Never claim or release.

Otherwise, every session, without waiting to be asked:

1. Read `{home}/session/handover.md` for the previous session's context.
2. List the repository's issues labelled `arsenal:task` — **open and closed** — and
   save the JSON. Use whatever GitHub access this surface has; run
   `claude-arsenal/bin/github_channel.sh --detect` to find out which. Request
   `number`, `title`, `state`, `labels`, `assignees` and **not `body`** — the bodies
   are the bulk of that fetch and nothing downstream reads them.
3. Run `python3 claude-arsenal/scripts/query_status.py --issues <that file>` for the
   board, and report anything it flags.
4. Pick up work: `python3 claude-arsenal/scripts/task_select.py --issues <that file>`
   returns the next unblocked task, then
   `bash claude-arsenal/bin/claim_task.sh <id>` takes it (see `@claude-arsenal/AGENTS.md`).
   - **Nothing returned + workspace plans exist** → seed tasks from each plan.
   - **Nothing at all** → ask what to work on.
5. Open each task's PR with `Closes #<issue>` so merging it closes the task by itself.
   Dispatching the work to another session instead? Pass the repository explicitly
   and pass `ARSENAL_TASK_ISSUE` — a spawned worker can resolve neither.
   → `claude-arsenal/references/orchestrator-tick.md`
6. After any session with tasks: update `{home}/session/handover.md`.

@claude-arsenal/AGENTS.md
<!-- /claude-arsenal: auto-managed -->"""

_CONFIG_TEMPLATE = """\
# claude-arsenal host configuration — yours; upstream never rewrites this file.

# How far must a task PR get before an agent may merge it?
#
#   always               The gates open_task_pr.sh already ran are the whole bar.
#   after-ci             Every required check has REPORTED, and is green.
#                        Absent is not green: no runners, no workflows, or a
#                        job that died unassigned means "wait", not "pass".
#   after-review         A review has landed (human or bot — whatever GitHub
#                        reports on the PR) and every comment it raised is
#                        fixed or answered. CI is NOT consulted. This is the
#                        value for a repo with no CI, or whose CI is
#                        unavailable rather than failing.
#   after-ci-and-review  Both of the two above: green checks AND a review whose
#                        comments are all addressed. The usual choice for a repo
#                        that has CI and a review bot — pick this one if you
#                        expect "wait for green, answer the bot, then merge".
#   never                An agent never merges. It reports the PR ready and
#                        stops; a human merges.
#
# Whichever is set, both directions are failures: merging past what it allows,
# and stopping to ask a question this file already answers. Do not set a policy
# nothing in the repo can ever satisfy — it gets waved through, and then it
# stays waved through on the day it starts meaning something again.
merge-policy = "after-ci"

# Shell command run before any task PR is opened; a non-zero exit means no PR.
# Empty = no host gate. Point it at everything your repo actually checks, not
# just lint — whatever is not named here is enforced by nobody.
#   host-gate = "make lint test evidence"
host-gate = ""

# Shell command that installs this repo's dependencies, run once in a fresh
# worktree before the first gate (claude-arsenal/bin/host_setup.sh). Empty = no
# setup step. A worktree is a checkout: it carries tracked files and none of
# what an install produces, so without this the first gate a worker runs fails
# on a missing tool and every worker works that out for itself.
#   host-setup = "npm ci && uv sync"
host-setup = ""

# How hard the pre-PR adversarial review binds when a TASK PR is opened — a
# reviewer with no history of the change reads it first
# (claude-arsenal/bin/adversarial_review.sh). The gates above prove the repo
# still works; only this one can tell whether the change is the change that was
# asked for. Read by open_task_pr.sh only: the execution, github and ship skills
# run the same gate as a step of their own workflow and do not consult this.
#   warn      Open the task PR either way, and state the outcome in its body.
#   required  No clearing verdict for this exact tree, no task PR.
#   off       Do not check, write nothing in the body.
pre-pr-review = "warn"

# test-first writes a failing test before the change; test-after writes tests
# alongside it.
test-discipline = "test-first"

# What /session-end leaves behind: handoff | ticket | none
session-end = "handoff"

# The skills-listing character budget the auditor enforces. Raise it if your
# surface's real budget differs, rather than deleting skills to fit a number
# that is not yours.
listing-budget = 8000

# Which skill sections this repo installs. Written by `/init` from the profile
# you picked ("what kind of project is this?"), as a [skills] table below.
#
# Every installed skill costs a row in the resident skills listing of every
# session, forever, whether or not it ever triggers — so a repo that never
# touches Python should not be carrying five Python skills. Flip a value and
# the next `/init` (which the session protocol runs anyway) adds or prunes the
# skills for that section.
#
#   workflow  specify, design, execution, review, ship, gate-check
#   python    python-bootstrap, pypi-release, coverage-gaps, dep-upgrade,
#             mutmut-report
#
# The core section — init, continue, queue-add, queue-status, github,
# session-end — is always installed and is not listed: the vendored session
# protocol names those skills directly, so switching one off would break every
# session rather than save anything worth saving.

# Which model runs what. An alias Claude Code resolves (opus | sonnet | haiku)
# or a full model id.
#
# workers is enforced: the orchestrator exports it as CLAUDE_CODE_SUBAGENT_MODEL
# before dispatching, so it governs every worker subagent in the session.
#
# orchestrator is advisory — a session cannot change the model it is already
# running as. It is read at session start and reported when the running model
# is not the one named here. Leave it empty for "no opinion".
#
# Keep table headers at the end of this file: a bare key written after one
# lands inside the table instead of at the top level.
[models]
orchestrator = ""
workers = "sonnet"
"""

# Permissive on purpose: until the probe runs, every `surface:` task stays
# eligible. `access:` capabilities are deliberately absent — they gate work a
# session may genuinely be unable to do, so they are granted by the probe or by
# naming one at /continue, never by a default nobody chose.
# Deny by default. A session runs on exactly ONE surface, so claiming cli, web
# and cloud at once was not permissive — it was false, and every task gated on
# `requires: [surface:cli]` became selectable on the web, where it cannot run.
# An undetected surface promises nothing; `bin/detect_surface.sh` overwrites this
# with what the surface actually offers, and until it has, a task that declares a
# requirement waits instead of being handed to a surface that may not meet it.
# Tasks with no `requires:` are unaffected — an empty requirement set is a subset
# of every profile, this one included.
DEFAULT_SURFACE_PROFILE = {
    "surface": "unknown",
    "capabilities": [],
}

WORKSPACE_SPEC_STUB = """\
# {name}: Specification

<!-- Written by /specify -->
"""

WORKSPACE_PLAN_STUB = """\
# {name}: Plan

<!-- Written by /design -->
"""

WORKSPACE_CONTEXT_STUB = """\
# {name}: Context

<!-- ≤200-word worker brief — written by /specify in workspace mode -->
"""

WORKSPACE_HANDOVER_STUB = """\
# {name}: Session Handover

<!-- Written at session end. A new session reading this file can resume
     without additional context. -->

## Last task

- **ID**: <!-- e.g. lo-a3f8 -->
- **Title**: <!-- task title -->
- **Status at handover**: <!-- open | in_progress | done | blocked -->

## What was done this session

<!-- One-paragraph summary. Include commit SHAs if relevant. -->

## What remains

<!-- Bulleted list of sub-tasks or acceptance-criteria items not yet met. -->

## How to continue

1. Read `claude-arsenal/references/worker-loop.md` for the worker loop algorithm.
2. Fetch the `arsenal:task` issues, then run
   `claude-arsenal/scripts/task_select.py --issues <file>` for the next task.
3. Claim it with `claude-arsenal/bin/claim_task.sh <task_id>`; `lost` means
   another session has it, so take the next one.
"""

OVERVIEW_HEADER = """\
# Project Overview

<!-- ≤100-word project description. Updated by /init --workspace. -->

## Workspaces

| Name | Root | Spec | Plan |
|------|------|------|------|
"""

# Bundle lives in this skill's assets/ so it travels with the skill when the
# skill folder is flattened into a consumer's .claude/skills/ (Claude Code web).
# skills/init/scripts/init.py -> skills/init -> skills/init/assets
_BUNDLE_DIR = Path(__file__).resolve().parent.parent / "assets"


def _bundle_dir(override: Path | None = None) -> Path:
    path = override or _BUNDLE_DIR
    if not path.is_dir():
        sys.exit(f"init: bundle not found at {path}")
    return path


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _has_shebang(path: Path) -> bool:
    """True when the file begins with a #! shebang (i.e. it is a script)."""
    try:
        with path.open("rb") as fh:
            return fh.read(2) == b"#!"
    except OSError:
        return False


# Host-owned bundle paths the init only SCAFFOLDS: a template is written once
# when absent, but NEVER overwritten on re-run — these hold live host data
# (AGENTS.md marks session/ and project/ "host-owned; never touched by /init
# re-run"). Clobbering them wipes the consumer's handover and plans on every
# `init --silent` at session start. Only session/ ships a template today;
# project/ is listed defensively so a future bundle file under it can't
# introduce the same data loss.
_SCAFFOLD_ONCE = ("session/", "project/")


def _refresh_bundle(bundle: Path, target: Path, silent: bool = False) -> None:
    """Copy bundle files into target, refreshing only stale files.

    Files under a _SCAFFOLD_ONCE prefix are written only when absent and left
    untouched if they already exist (host-owned live data, not bundle content).
    """
    for src in bundle.rglob("*"):
        if src.is_dir():
            continue
        rel = src.relative_to(bundle)
        dst = target / rel
        if rel.as_posix().startswith(_SCAFFOLD_ONCE) and dst.exists():
            if not silent:
                print(f"  preserved (host-owned): {rel}")
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists() and _sha256(src) == _sha256(dst):
            if not silent:
                print(f"  up to date: {rel}")
        else:
            shutil.copy2(src, dst)
            # copy2 already mirrors the source mode; restore +x only for files
            # that are actually scripts (a #! shebang) in case the checkout
            # dropped the bit. Keying off a missing suffix would make arbitrary
            # extensionless data files executable.
            if _has_shebang(src):
                dst.chmod(dst.stat().st_mode | 0o111)
            print(f"  refreshed:  {rel}")
    _prune_bundle(bundle, target)


# Directories the bundle owns outright: everything in them comes from upstream,
# so a file there that upstream no longer ships is a leftover, not host data.
# `references/` is swept for the same reason as the script dirs: a retired
# reference left behind is protocol the bundle no longer means, sitting in the
# tree a session reads on demand.
_PRUNABLE_DIRS = ("bin", "scripts", "references")


def _prune_bundle(bundle: Path, target: Path) -> None:
    """Delete installed bundle files upstream no longer ships.

    Refreshing by checksum updates and adds, but never removed — so an upgrade
    left every retired script sitting in the bundle, still executable. Those are
    not inert leftovers: they are the previous architecture, and a session that
    finds `claim.sh` can still run it against a queue that is no longer the
    board. Only the two upstream-owned directories are swept; host trees are
    never touched.
    """
    for dirname in _PRUNABLE_DIRS:
        src_dir, dst_dir = bundle / dirname, target / dirname
        if not dst_dir.is_dir():
            continue
        shipped = {p.name for p in src_dir.iterdir() if p.is_file()} if src_dir.is_dir() else set()
        for installed in sorted(dst_dir.iterdir()):
            if not installed.is_file() or installed.name in shipped:
                continue
            installed.unlink()
            print(f"  removed (no longer shipped): {dirname}/{installed.name}")


def _parse_version(text: str) -> tuple[int, ...] | None:
    """(major, minor, patch), or None when this is not a plain numeric version.

    None means "cannot compare", and the caller then behaves as it always did:
    a hand-edited or pre-release marker must not be able to wedge an install shut.
    """
    parts = text.strip().split(".")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        return None
    try:
        return tuple(int(part) for part in parts)
    except ValueError:
        # CPython caps int() on very long digit strings. A garbage marker is
        # "cannot compare", never a crash in the one step every session runs.
        return None


_CHANGELOG_HEADING = re.compile(r"(?m)^## \[(\d+\.\d+\.\d+)\][^\n]*\n")


def _changelog_since(bundle: Path, installed_ver: str, bundle_ver: str) -> str:
    """Bundle CHANGELOG.md entries newer than installed_ver, up to bundle_ver.

    "" when there is no changelog yet, no entry falls in that range, or either
    version fails to parse — this is an enhancement to the upgrade banner below,
    never a reason to withhold it, so every failure here is silent, not fatal.
    """
    changelog = bundle / "CHANGELOG.md"
    if not changelog.is_file():
        return ""
    since, upto = _parse_version(installed_ver), _parse_version(bundle_ver)
    if since is None or upto is None:
        return ""
    try:
        text = changelog.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return ""
    parts = _CHANGELOG_HEADING.split(text)
    entries: list[tuple[tuple[int, ...], str, str]] = []
    for i in range(1, len(parts), 2):
        version = _parse_version(parts[i])
        body = parts[i + 1].strip() if i + 1 < len(parts) else ""
        if version is not None and since < version <= upto and body:
            entries.append((version, parts[i], body))
    entries.sort(reverse=True)
    return "\n\n".join(f"## {ver}\n{body}" for _, ver, body in entries)


def _check_bundle_version(bundle: Path, arsenal: Path) -> tuple[str, str] | None:
    """Print an upgrade banner; REPORT a downgrade instead of performing one.

    Returns (installed, bundle) when the host's committed bundle is newer than
    this skill's vendored copies, and None otherwise. That direction used to be
    invisible: the refresh is by checksum, so an older vendored copy differs from
    a newer installed one exactly as a newer copy does, and step 0b — which a
    session runs before it knows what kind of session it is — quietly replaced
    upstream fixes with the versions that predate them. A session that trusts it
    then ships the regression inside whatever PR it opens next (#220).
    """
    bundle_ver_path = bundle / ".bundle-version"
    installed_ver_path = arsenal / ".bundle-version"
    if not bundle_ver_path.exists() or not installed_ver_path.exists():
        return None
    bundle_ver = bundle_ver_path.read_text(encoding="utf-8").strip()
    installed_ver = installed_ver_path.read_text(encoding="utf-8").strip()
    if installed_ver == bundle_ver:
        return None
    installed_parsed, bundle_parsed = _parse_version(installed_ver), _parse_version(bundle_ver)
    if installed_parsed and bundle_parsed and installed_parsed > bundle_parsed:
        return installed_ver, bundle_ver
    print(
        f"Upgrading claude-arsenal bundle: {installed_ver} → {bundle_ver}"
    )
    changelog = _changelog_since(bundle, installed_ver, bundle_ver)
    if changelog:
        print(f"\nWhat's new:\n\n{changelog}\n")
    return None


def _register_statusline(repo_path: Path) -> None:
    """Register statusline_capture.sh as the host statusLine command.

    Writes/merges .claude/settings.json. A user's existing statusLine is never
    clobbered — the budget guard is best-effort and must not override a custom
    status line the user already configured.
    """
    settings_path = repo_path / ".claude" / "settings.json"
    block = {
        "type": "command",
        "command": "bash claude-arsenal/bin/statusline_capture.sh",
    }
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
            if not isinstance(settings, dict):
                settings = {}
        except json.JSONDecodeError:
            print("  settings.json: unparseable — skipping statusLine registration")
            return
        if "statusLine" in settings:
            print("  settings.json: statusLine already set — skipping")
            return
        settings["statusLine"] = block
    else:
        settings = {"statusLine": block}

    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
    print("  settings.json: registered statusLine (statusline_capture.sh)")


# --- vendoring --------------------------------------------------------------
# Vendoring is the only mechanism that reaches every surface. A cloud session
# runs on a fresh clone and never sees ~/.claude/, and — verified against a live
# session, not inferred from docs — it does not act on a repo's
# `extraKnownMarketplaces` / `enabledPlugins` either: skills there arrive by
# account-level sync, and the web runtime never fetches a git marketplace at
# session start. What it does read is `.claude/skills/` and the hooks in
# `.claude/settings.json`, both of which are part of the clone.
#
# So the skills are copied in, and the gate that plugin hooks would otherwise
# provide is written into settings.json alongside them.
_MARKETPLACE = "claude-arsenal"
_VENDOR_MARKER = ".arsenal-vendored"
_GATE_HOOK = "claude-arsenal/bin/check_skill_workshop_loaded.sh"
_MARK_HOOK = "claude-arsenal/bin/mark_skill_workshop_loaded.sh"
_MARK_PROMPT_HOOK = "claude-arsenal/bin/mark_skill_workshop_loaded_from_prompt.sh"


def _read_settings(settings_path: Path) -> dict | None:
    """Parse .claude/settings.json, or None when it exists and is unparseable."""
    if not settings_path.exists():
        return {}
    try:
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return settings if isinstance(settings, dict) else {}


def _source_skills_dir() -> Path:
    """The skills/ directory this script's own skill lives in.

    Works from the plugin cache and from a vendored copy alike: init is always
    `<skills>/init/scripts/init.py`, so its grandparent is the library to copy.
    """
    return Path(__file__).resolve().parent.parent.parent


# ---------------------------------------------------------------------------
# Sections — which skills a repo actually installs.
#
# Every vendored skill costs the same two things in every session forever: a
# `name` + `description` row in the resident skills listing, and a share of the
# 8000-char listing budget the auditor enforces. A repo that never touches
# Python paid for five Python skills anyway, because vendoring was all-or-
# nothing. Sections make that a choice.
#
# A section is declared per skill in SKILL.md frontmatter (`section:`, under
# `metadata:` by convention). A skill that names none is `core`.
#
#   core      the bundle itself — the installer, the queue engine, and the two
#             skills the vendored AGENTS.md protocol names by hand. Never
#             toggleable: switching these off breaks the protocol every session
#             loads, so they are not offered as a choice that could be got
#             wrong.
#   workflow  the spec -> design -> execute -> review -> ship discipline.
#   python    the Python toolchain skills.
#
# Defaults are for a FRESH install only. An upgrade never applies them — see
# _resolve_sections for why that distinction is the whole safety story.
_CORE_SECTION = "core"

_SECTION_DEFAULTS: dict[str, bool] = {
    "workflow": True,
    "python": False,
}

# Named answers to "what kind of project is this?" — the question `/init` asks
# before a first install. A profile is only ever a starting point: it is
# written out as an explicit [skills] table the consumer can edit afterwards,
# so nobody has to remember what "general" meant six months later.
_PROFILES: dict[str, tuple[str, ...]] = {
    "minimal": (),
    "general": ("workflow",),
    "python": ("workflow", "python"),
    "all": tuple(_SECTION_DEFAULTS),
}

_FRONTMATTER_SECTION = re.compile(r"^\s*section:\s*[\"']?([A-Za-z0-9_-]+)", re.MULTILINE)


def _known_sections() -> set[str]:
    """Every section a consumer may ask for: the registered ones plus any shipped.

    Read from the shipped skills rather than from `_SECTION_DEFAULTS` alone so
    that adding a section to a SKILL.md is enough to make it requestable. A
    shipped section with no entry in `_SECTION_DEFAULTS` is simply off by
    default — opt-in, which is the right default for anything new.

    The manifest is unioned in because the on-disk scan cannot see a section
    whose skills are all still un-vendored, and that is a chicken-and-egg a
    consumer cannot break out of: a vendored `_source_skills_dir()` is the
    repo's own `.claude/skills/`, so `extract` was unrequestable because `har`
    was not installed, and `har` was not installed because `extract` was
    unrequestable. Via `--sections` that failed loudly; via `config.toml` it
    failed silently — the flag was simply dropped from `known` and the usual
    `skills: vendored N` line printed as though nothing had been asked for.
    `sections.json` ships beside this script and carries the full set.
    """
    try:
        shipped = {
            _skill_section(d)
            for d in _source_skills_dir().iterdir()
            if (d / "SKILL.md").is_file()
        }
    except OSError:
        shipped = set()
    manifest = _load_manifest() or {}
    declared = {
        entry["name"]
        for entry in manifest.get("sections", [])
        if isinstance(entry, dict) and isinstance(entry.get("name"), str)
    }
    return (set(_SECTION_DEFAULTS) | shipped | declared) - {_CORE_SECTION}


def _skill_section(skill_dir: Path) -> str:
    """The section a skill declares in its frontmatter, or `core` if it names none.

    Only the frontmatter block is searched, so the word `section:` in body prose
    cannot silently re-file a skill. An unreadable or malformed SKILL.md falls
    back to `core` — a skill we cannot classify is one we keep installing,
    because the failure mode of the other choice is silently dropping it.
    """
    try:
        text = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return _CORE_SECTION
    if not text.startswith("---"):
        return _CORE_SECTION
    end = text.find("\n---", 3)
    if end == -1:
        return _CORE_SECTION
    match = _FRONTMATTER_SECTION.search(text[3:end])
    return match.group(1) if match else _CORE_SECTION


# The shipped capability map. A vendored init.py's `_source_skills_dir()` is the
# consumer's own `.claude/skills/`, already pruned to the sections that repo
# installed — so it can enumerate the skills a repo HAS and not the ones it does
# not, which is exactly the question a map exists to answer. The manifest is
# written in the marketplace, where every skill is visible, and travels with the
# skill; `scripts/sync_sections.py` generates it and CI fails on drift.
_SECTIONS_MANIFEST = Path(__file__).resolve().parent.parent / "assets" / "sections.json"


def _load_manifest() -> dict[str, Any] | None:
    """The shipped section manifest, or None when this bundle predates it."""
    try:
        data = json.loads(_SECTIONS_MANIFEST.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and isinstance(data.get("sections"), list) else None


def _manifest_from_disk() -> dict[str, Any]:
    """A manifest shaped like the shipped one, built from whatever is on disk.

    The degraded path for a consumer whose bundle predates `sections.json`. It
    can only see installed skills, so the caller says so rather than printing a
    partial map as though it were the whole one.
    """
    by_section: dict[str, list[dict[str, str]]] = {}
    try:
        skills = sorted(d for d in _source_skills_dir().iterdir() if (d / "SKILL.md").is_file())
    except OSError:
        skills = []
    for skill_dir in skills:
        by_section.setdefault(_skill_section(skill_dir), []).append(
            {"name": skill_dir.name, "description": ""}
        )
    return {
        "sections": [
            {
                "name": name,
                "default": name == _CORE_SECTION or _SECTION_DEFAULTS.get(name, False),
                "core": name == _CORE_SECTION,
                "blurb": "",
                "skills": by_section[name],
            }
            for name in sorted(by_section, key=lambda s: (s != _CORE_SECTION, s))
        ]
    }


def _installed_skills(repo_path: Path) -> set[str] | None:
    """Skill names present in the host's `.claude/skills/`, or None if there is none.

    Ground truth for the map's on/off column: a section is on here if a skill of
    it is actually loadable, which is what a session cares about and what stays
    right when `arsenal/config.toml` has been edited but no install has run yet.
    """
    dest = repo_path / ".claude" / "skills"
    try:
        return {d.name for d in dest.iterdir() if (d / "SKILL.md").is_file()}
    except OSError:
        return None


def _section_is_on(section: dict[str, Any], installed: set[str] | None, config: Path) -> bool:
    """Whether this repo has the section, read from disk and falling back to config."""
    if section.get("core"):
        return True
    names = {s["name"] for s in section.get("skills", [])}
    if installed is not None and names:
        return bool(names & installed)
    recorded = _read_sections_table(config)
    if recorded is not None:
        return bool(recorded.get(section["name"], section.get("default", False)))
    return bool(section.get("default", False))


def list_sections(repo_path: Path, only: str | None = None) -> int:
    """Print the capability map: every section this bundle ships, and what is on here.

    Writes nothing — no config, no vendoring, no bundle refresh. The session-start
    protocol runs this unattended on every session, and a discovery command with a
    side effect is a discovery command nobody dares run.

    Skills are named for sections that are OFF and not for ones that are ON,
    which is the whole budget of this output: an installed skill already carries
    its name and full description in the resident skills listing, so naming it
    again pays twice for one fact, while an uninstalled one appears nowhere else
    at all.
    """
    manifest = _load_manifest()
    degraded = manifest is None
    if manifest is None:
        manifest = _manifest_from_disk()

    sections: list[dict[str, Any]] = manifest["sections"]
    if only is not None:
        sections = [s for s in sections if s["name"] == only]
        if not sections:
            known = ", ".join(s["name"] for s in manifest["sections"])
            print(f"init: no section named {only!r}. Known: {known}", file=sys.stderr)
            return 2

    installed = _installed_skills(repo_path)
    config = _home(repo_path) / "config.toml"
    on = {s["name"] for s in sections if _section_is_on(s, installed, config)}

    if only is not None:
        section = sections[0]
        state = "installed here" if section["name"] in on else "NOT installed here"
        print(f"{section['name']} — {section['blurb'] or 'no description'} [{state}]")
        for skill in section["skills"]:
            print(f"  {skill['name']}")
            if skill["description"]:
                print(f"    {skill['description']}")
        return 0

    width = max((len(s["name"]) for s in sections), default=4)
    print(f"skill sections — {len(on)} of {len(sections)} installed here")
    for section in sections:
        is_on = section["name"] in on
        detail = section["blurb"] or "no description"
        if not is_on and section["skills"]:
            detail += " (" + ", ".join(s["name"] for s in section["skills"]) + ")"
        print(f"  {section['name']:<{width}}  {'on ' if is_on else 'off'}  {detail}")
    if degraded:
        print(
            "  (installed sections only — this bundle predates the shipped map; "
            "run claude-arsenal/bin/check_update.sh)"
        )
    else:
        print(
            "  off sections: `init.py --sections a,b` or edit [skills] in arsenal/config.toml; "
            "`--section NAME` for detail"
        )
    return 0


def _read_sections_table(config: Path) -> dict[str, bool] | None:
    """The `[skills]` table from arsenal/config.toml, or None if it has none.

    None and an empty table are different answers and the caller depends on it:
    None means "this repo has never been asked", which is what triggers the
    upgrade-preserving path. An empty `[skills]` table means "asked, and the
    answer was core only".
    """
    if not config.is_file():
        return None
    try:
        raw = tomllib.loads(config.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError) as exc:
        sys.exit(f"init: cannot read {config}: {exc}")
    except tomllib.TOMLDecodeError as exc:
        sys.exit(f"init: {config} is not valid TOML — {exc}")

    table = raw.get("skills")
    if table is None:
        return None
    if not isinstance(table, dict):
        sys.exit(f"init: {config}: [skills] must be a table of section = true/false")

    # A non-boolean is a typo, and the cost of guessing is pruning skills a repo
    # is using. `workflow = "treu"` used to read as false and silently delete
    # six skills; it now stops the install and says which line to fix.
    for name, value in table.items():
        if not isinstance(value, bool):
            sys.exit(
                f"init: {config}: [skills] {name} = {value!r} is not true or false"
            )
    # Unknown names are NOT fatal, deliberately: a repo that has run a newer
    # bundle carries sections this one has never heard of, and downgrading
    # should not be an error. They are ignored here, and a name absent from the
    # table falls back to its shipped default rather than to off (see
    # _resolve_sections) — so a misspelled key fails toward keeping skills.
    return dict(table)


def _write_sections_table(config: Path, enabled: set[str], known: list[str]) -> None:
    """Record the resolved sections as a `[skills]` table, replacing any existing one.

    Written out in full — every known section, `true` or `false` — rather than
    only the enabled ones. A consumer opting a section back in should find the
    line already there to flip, not have to know the name of something that was
    never mentioned.
    """
    header = "\n".join(
        ["[skills]"] + [f"{name} = {str(name in enabled).lower()}" for name in known]
    )
    text = config.read_text(encoding="utf-8") if config.is_file() else ""
    existing = re.search(r"^\[skills\]\s*$", text, re.MULTILINE)
    if existing:
        rest = text[existing.end():]
        nxt = re.search(r"^\[", rest, re.MULTILINE)
        tail = rest[nxt.start():] if nxt else ""
        text = text[: existing.start()] + header + "\n" + ("\n" + tail if tail else "")
    else:
        text = (text.rstrip("\n") + "\n\n" if text.strip() else "") + header + "\n"
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text(text, encoding="utf-8")


def _resolve_sections(
    config: Path,
    dest: Path,
    by_section: dict[str, set[str]],
    profile: str | None,
    sections: list[str] | None,
) -> set[str]:
    """Decide which sections this repo installs, and record the decision.

    The decision is recorded in `arsenal/config.toml` rather than inferred each
    run, for the same reason `queue-automation` is: the session-start protocol
    runs `init.py --silent` every session, so anything re-derived from the state
    of the checkout gets re-derived after the consumer changes that state, and
    quietly undoes them.

    Four cases:

      * `--sections` / `--profile` given — an explicit answer. Use it and record
        it, overwriting any previous one. This is what `/init` passes after
        asking what kind of project this is.
      * a `[skills]` table exists — the repo has already answered. Honour it
        exactly, including sections it sets to false.
      * no table, and skills are already vendored — an UPGRADE. Enable every
        section that has a skill on disk right now and record that. This is the
        case that must never apply a default: `python` ships default-off, so
        defaulting here would delete five skills out of a repo that has been
        using them, on a routine `--silent` upgrade nobody was watching.
      * no table, nothing vendored — a FRESH install. Apply the shipped
        defaults and record them.
    """
    known = sorted(_known_sections() | (set(by_section) - {_CORE_SECTION}))

    # An explicit list wins outright — `--sections ""` means core only, which
    # is a different answer from "nothing was passed" and must not fall through
    # to the recorded table or the defaults.
    if sections is not None:
        chosen = set(sections)
    elif profile:
        chosen = set(known) if profile == "all" else set(_PROFILES[profile])
    else:
        recorded = _read_sections_table(config)
        if recorded is not None:
            return {_CORE_SECTION} | {
                name
                for name in known
                if recorded.get(name, _SECTION_DEFAULTS.get(name, False))
            }
        # Asked of the *bundle*, by name, not of the installed files by their
        # metadata. `_skill_section` falls back to `core` for a SKILL.md it
        # cannot classify — right for its own case, inverted here: a bundle
        # installed before `section:` existed carries the line in no skill at
        # all, so every directory classified as `core`, `vendored` came out as
        # `{"core"}`, and the subtraction below emptied it *after* the truth
        # test that was supposed to catch "we found nothing". The recorded
        # answer was then no sections, and the prune loop rmtree-d the
        # consumer's workflow and python skills on a run they invoked to
        # upgrade them. Names are stable across every version that ever
        # shipped, and `by_section` is keyed on them.
        vendored_names = {
            d.name
            for d in dest.iterdir()
            if d.is_dir() and (d / _VENDOR_MARKER).is_file()
        } if dest.is_dir() else set()
        vendored = {
            section for section, names in by_section.items() if names & vendored_names
        }
        chosen = (
            vendored - {_CORE_SECTION}
            if vendored
            else {name for name, on in _SECTION_DEFAULTS.items() if on}
        )

    chosen &= set(known)
    _write_sections_table(config, chosen, known)
    return {_CORE_SECTION} | chosen


def _vendor_skills(
    repo_path: Path,
    silent: bool = False,
    profile: str | None = None,
    sections: list[str] | None = None,
) -> None:
    """Copy the sibling skills into .claude/skills/ so every surface can load them.

    Only the sections this repo installs are copied (see _resolve_sections);
    a skill whose section is off is pruned, so switching one off in
    `arsenal/config.toml` takes effect on the next session rather than needing a
    manual delete that the next upgrade would undo anyway.

    Only folders carrying the marker are ever replaced or removed — a skill the
    consumer authored is not ours to touch. Vendoring into itself (running from
    an already-vendored copy) is a no-op refresh.
    """
    source = _source_skills_dir()
    dest = repo_path / ".claude" / "skills"
    if source.resolve() == dest.resolve():
        # Running from the vendored copy: the source IS the destination, so
        # there is nothing to copy in. Saying nothing was the silent half of
        # the same bug — a consumer who enabled a section here got the usual
        # success output and no skill, because a vendored copy can only ever
        # refresh the skills a repo already has. Name the sections that are on
        # with nothing on disk to satisfy them, and say where to get them.
        if not silent:
            recorded = _read_sections_table(_home(repo_path) / "config.toml") or {}
            asked = (
                set(sections)
                if sections is not None
                else {name for name, on in recorded.items() if on}
            )
            on_disk = {
                _skill_section(d) for d in source.iterdir() if (d / "SKILL.md").is_file()
            }
            empty = sorted(asked - on_disk - {_CORE_SECTION})
            if empty:
                print(
                    f"  skills: section(s) {', '.join(empty)} are enabled but no skill for "
                    "them is installed — a vendored init.py can only refresh what this repo "
                    "already has. Re-run the plugin's init.py (or update the bundle) to "
                    "install them."
                )
        return

    shipped = {d.name: _skill_section(d) for d in source.iterdir() if (d / "SKILL.md").is_file()}
    by_section: dict[str, set[str]] = {}
    for name, section in shipped.items():
        by_section.setdefault(section, set()).add(name)

    enabled = _resolve_sections(
        _home(repo_path) / "config.toml", dest, by_section, profile, sections
    )
    available = {name for name, section in shipped.items() if section in enabled}
    dest.mkdir(parents=True, exist_ok=True)

    for name in sorted(available):
        target = dest / name
        if target.exists() and not (target / _VENDOR_MARKER).is_file():
            print(f"  skills: {name} exists and is not arsenal-vendored — left alone")
            continue
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source / name, target)
        (target / _VENDOR_MARKER).write_text("", encoding="utf-8")

    # Prune skills a previous version vendored that this one no longer ships,
    # and skills whose section this repo has switched off.
    removed = []
    # Materialised first: iterdir() walks a live scandir, and rmtree inside the
    # loop can make it skip the entry that follows a deleted one.
    for d in sorted(dest.iterdir()):
        if d.is_dir() and (d / _VENDOR_MARKER).is_file() and d.name not in available:
            shutil.rmtree(d)
            removed.append(d.name)

    if not silent or removed:
        # Every shipped section, not only the ones with a `_SECTION_DEFAULTS`
        # entry. A section that ships without one is off by default — opt-in —
        # and opt-in is what "new" looks like, so those are exactly the ones a
        # consumer is most likely to be missing and least likely to know about.
        off = sorted((set(_SECTION_DEFAULTS) | set(by_section)) - enabled - {_CORE_SECTION})
        suffix = f" (sections off: {', '.join(off)})" if off else ""
        print(f"  skills: vendored {len(available)} into .claude/skills/{suffix}")
    for name in removed:
        print(f"  skills: pruned {name} (not shipped, or its section is off)")


def _register_gate_hook(repo_path: Path) -> None:
    """Wire the skill-edit gate into .claude/settings.json.

    A plugin ships this as a plugin hook, but plugin hooks do not travel with
    vendored skills — which is why vendored skill authoring was ungated for as
    long as vendoring has existed. Settings hooks are part of the clone, so they
    reach a cloud session too.
    """
    settings_path = repo_path / ".claude" / "settings.json"
    settings = _read_settings(settings_path)
    if settings is None:
        print("  settings.json: unparseable — skipping gate-hook registration")
        return

    hooks = settings.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        print("  settings.json: unexpected 'hooks' value — skipping gate-hook registration")
        return

    wanted = {
        "PreToolUse": ("Edit|Write|MultiEdit|Bash", _GATE_HOOK),
        "PostToolUse": ("Skill", _MARK_HOOK),
        "UserPromptSubmit": (None, _MARK_PROMPT_HOOK),
    }
    changed = False
    for event, (matcher, command) in wanted.items():
        entries = hooks.setdefault(event, [])
        if not isinstance(entries, list):
            continue
        if any(command in json.dumps(e) for e in entries):
            continue
        entry: dict = {"hooks": [{"type": "command", "command": f"bash {command}"}]}
        if matcher:
            entry["matcher"] = matcher
        entries.append(entry)
        changed = True

    if changed:
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
        print("  settings.json: registered the skill-edit gate")


def _retire_plugin_declaration(repo_path: Path) -> None:
    """Remove a marketplace declaration written by v1.0.0 through v1.1.0.

    Those versions declared the plugins in the host repo's settings, on the
    belief that a cloud session would install them. It does not. Left in place
    beside the vendored copies it does nothing in the cloud and produces
    duplicate skills on the CLI — `specify` and `core:specify` both live, both
    answering.
    """
    settings_path = repo_path / ".claude" / "settings.json"
    settings = _read_settings(settings_path)
    if not settings:
        return

    changed = False
    markets = settings.get("extraKnownMarketplaces")
    if isinstance(markets, dict) and _MARKETPLACE in markets:
        markets.pop(_MARKETPLACE)
        if not markets:
            settings.pop("extraKnownMarketplaces")
        changed = True

    enabled = settings.get("enabledPlugins")
    if isinstance(enabled, dict):
        stale = [k for k in enabled if k.endswith(f"@{_MARKETPLACE}")]
        for key in stale:
            enabled.pop(key)
        if stale:
            changed = True
        if not enabled:
            settings.pop("enabledPlugins")

    if changed:
        settings_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
        print("  settings.json: retired the plugin declaration (vendored copies supersede it)")


def _add_gitignore_entry(repo_path: Path, entry: str) -> None:
    gitignore = repo_path / ".gitignore"
    if gitignore.exists():
        lines = gitignore.read_text(encoding="utf-8").splitlines()
        if entry in lines:
            return
        with gitignore.open("a", encoding="utf-8") as f:
            f.write(f"\n{entry}\n")
    else:
        gitignore.write_text(f"{entry}\n", encoding="utf-8")
    print(f"  .gitignore: added {entry}")


def _replace_managed_block(content: str, block: str) -> str | None:
    """Return content with the managed block replaced, or None if there is none.

    The block is delimited by the two markers. Repos installed before the end
    marker existed have only the opening one, and their block runs to the
    `@claude-arsenal/AGENTS.md` import that terminates the template — match that
    so an upgrade repairs them too, instead of skipping the one file that tells
    every session what to do.
    """
    start = content.find(CLAUDE_MD_MARKER)
    if start == -1:
        return None
    end = content.find(CLAUDE_MD_END_MARKER, start)
    if end != -1:
        end += len(CLAUDE_MD_END_MARKER)
    else:
        # The tail string also appears *inline*, inside step 4 of the block
        # itself. An unanchored find() therefore stops at that mention and cuts
        # the block in half, stranding the rest of it — steps 5 and 6 and the
        # real import — below the closing marker as if it were host content.
        # Only a line that IS the import terminates the block, and if the block
        # names it more than once, the last such line is the end of it.
        offsets, pos = [], 0
        for line in content[start:].splitlines(keepends=True):
            if line.strip() == LEGACY_BLOCK_TAIL:
                offsets.append(start + pos + len(line.rstrip("\r\n")))
            pos += len(line)
        if not offsets:
            # An opening marker with no recognisable end: replacing to the end of
            # the file would eat host-owned content, so leave it and say so.
            return ""
        end = offsets[-1]
    return content[:start] + block + content[end:]


def _claude_md_block(repo_path: Path) -> str:
    """The managed block, naming the host tree this repo actually has."""
    home_rel = _home(repo_path).relative_to(repo_path).as_posix()
    return _CLAUDE_MD_TEMPLATE.replace("{home}", home_rel)


def _inject_claude_md(repo_path: Path) -> None:
    block = _claude_md_block(repo_path)
    claude_md = repo_path / "CLAUDE.md"
    if not claude_md.exists():
        claude_md.write_text(f"{block}\n", encoding="utf-8")
        print("  CLAUDE.md: created with session-protocol block")
        return

    content = claude_md.read_text(encoding="utf-8")
    if CLAUDE_MD_MARKER not in content:
        claude_md.write_text(content.rstrip("\n") + f"\n\n{block}\n", encoding="utf-8")
        print("  CLAUDE.md: injected session-protocol block")
        return

    # The block is labelled auto-managed, so manage it. It was previously written
    # once and never touched again, which meant an upgrade that rewrote the
    # protocol left every consumer running the old one — naming paths that had
    # moved and scripts that had been deleted.
    replaced = _replace_managed_block(content, block)
    if replaced == "":
        print(
            "  CLAUDE.md: managed block has no end marker and no recognisable tail — "
            "left alone; review it against the current protocol"
        )
        return
    if replaced is None or replaced.rstrip("\n") == content.rstrip("\n"):
        print("  CLAUDE.md: session-protocol block up to date")
        return
    claude_md.write_text(replaced.rstrip("\n") + "\n", encoding="utf-8")
    print("  CLAUDE.md: session-protocol block refreshed (was out of date)")



# The host-owned handover template. It lives here, not in `assets/`, because
# anything under `assets/` is a bundle file and `_refresh_bundle` rewrites
# bundle files into `claude-arsenal/` — which is how this template came to
# shadow the real handover in the first place (see `_retire_shadow_handover`).
HANDOVER_TEMPLATE = """# Session Handover

<!-- Written at session end. A new session reading this file can resume without
     additional context. -->

## Last task

- **ID**: <!-- e.g. lo-a3f8 -->
- **Title**: <!-- task title -->
- **Status at handover**: <!-- open | in_progress | done | blocked -->

## What was done this session

<!-- One-paragraph summary. Include commit SHAs if relevant. -->

## What remains

<!-- Bulleted list of sub-tasks or acceptance-criteria items not yet met. -->

## How to continue

1. Read `claude-arsenal/references/worker-loop.md` for the worker loop algorithm.
2. Run `python3 claude-arsenal/scripts/task_select.py --issues <issues.json>` for
   the next unblocked task.

## Surface profile at handover

<!-- Copy of session/surface_profile.json for quick reference. -->

## Queue snapshot at handover

<!-- Output of: python3 claude-arsenal/scripts/query_status.py --detail -->
"""


def _handover_is_untouched(text: str) -> bool:
    """Whether a handover file carries nothing a session would want to read.

    The same test the session-start protocol describes in prose ("content beyond
    the template"): strip HTML comments, headings, list scaffolding and blank
    lines, and see whether any prose survives. Deliberately conservative — a
    file we cannot confidently call empty is one we keep.
    """
    # The stock template first, exactly. Its "How to continue" steps are ordinary
    # numbered prose, so the heuristic below reads them as content a session
    # wrote — the one file guaranteed to be untouched, called touched.
    if text.strip() == HANDOVER_TEMPLATE.strip():
        return True
    body = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        # An untouched bullet is the label with nothing after the colon.
        bullet = re.sub(r"^[-*]\s*", "", stripped)
        bullet = re.sub(r"^\d+\.\s*", "", bullet)
        if not bullet:
            continue
        label, sep, rest = bullet.partition(":")
        if sep and not rest.strip() and label.startswith("**"):
            continue
        return False
    return True


def _retire_shadow_handover(bundle_dir: Path, home: Path, repo_path: Path) -> None:
    """Remove the handover the bundle used to write into its own prefix.

    Consumers upgraded from a bundle that shipped `session/handover.md` still
    carry `<bundle>/session/handover.md`. Nothing reads it, and an empty one
    reads exactly like a fresh install, so it is removed — but only when it is
    provably untouched. A copy someone actually wrote into is left where it is
    and reported, because deleting a session's only written record to tidy up a
    path is the worse failure by far.
    """
    shadow = bundle_dir / "session" / "handover.md"
    if not shadow.is_file() or shadow.resolve() == (home / "session" / "handover.md").resolve():
        return
    try:
        text = shadow.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return
    rel = shadow.relative_to(repo_path)
    if _handover_is_untouched(text):
        # Every other failure in this function is non-fatal; an unguarded unlink
        # (a read-only checkout, a permission) propagated out of init_base and
        # aborted the install before _vendor_skills ever ran. Tidying up a shadow
        # copy is not a reason to leave a repo half-installed.
        try:
            shadow.unlink()
        except OSError as exc:
            print(f"  note: could not remove {rel} ({exc}) — delete it by hand")
            return
        with contextlib.suppress(OSError):
            shadow.parent.rmdir()
        print(f"  removed: {rel} (shadowed {home.name}/session/handover.md)")
    else:
        print(
            f"  WARNING: {rel} has content but nothing reads it — the live handover is "
            f"{home.name}/session/handover.md. Merge it across and delete the old copy."
        )


def _home(repo_path: Path) -> Path:
    """The host-owned tree — tasks, specs, plans, config, session.

    `ARSENAL_HOME` relocates it, and eight shipped bundle files already read it
    that way, `arsenal_config.py` included. This script is the one thing that
    CREATES the tree, and it hardcoded `arsenal/` — so with the variable set,
    `/init` scaffolded a config in one place and every reader looked in another.
    The consumer edits a file nothing reads and every setting silently stays at
    its default.
    """
    # `.strip() or "arsenal"`, not a bare default: `os.environ.get` returns the
    # empty string for a variable that is exported and unset, and `repo_path /
    # ""` is the repo root — so every host-owned file would be scaffolded
    # straight into the top of the consumer's tree.
    home = repo_path / (os.environ.get("ARSENAL_HOME", "").strip() or "arsenal")
    # It has to land inside the repo. A task is a file in the repository —
    # versioned, and committed by the PR that opens it — so a tree outside it
    # can never reach the board, and `${ARSENAL_HOME}/tasks` as an absolute
    # path is a queue that quietly stops being git-backed. It also breaks every
    # repo-root-relative comparison (evidence paths, the rebase helper). An
    # absolute value used to reach `relative_to(repo_path)` and raise a
    # traceback halfway through an install, which is a worse way to find out.
    try:
        home.resolve().relative_to(repo_path.resolve())
    except ValueError:
        sys.exit(
            f"init: ARSENAL_HOME resolves to {home}, which is outside {repo_path}. "
            "The host tree is versioned in the repository — a task file outside it "
            "cannot be committed, so the queue would never see it. Set ARSENAL_HOME "
            "to a path inside the repo, or unset it to use arsenal/."
        )
    return home


def _upsert_overview(repo_path: Path, workspace: str, root: str, spec: str, plan: str) -> None:
    overview = _home(repo_path) / "project" / "overview.md"
    if not overview.exists():
        overview.write_text(OVERVIEW_HEADER, encoding="utf-8")
    content = overview.read_text(encoding="utf-8")
    row = f"| {workspace} | {root} | {spec} | {plan} |"

    # Match an existing row by workspace name (the first table cell) so a
    # re-run with changed root/spec/plan updates in place instead of appending
    # a duplicate.
    lines = content.splitlines()
    for i, line in enumerate(lines):
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if len(cells) == 4 and cells[0] == workspace:
            if line == row:
                print(f"  overview.md: workspace {workspace} already listed")
            else:
                lines[i] = row
                overview.write_text("\n".join(lines) + "\n", encoding="utf-8")
                print(f"  overview.md: updated workspace {workspace}")
            return

    content = content.rstrip("\n") + f"\n{row}\n"
    overview.write_text(content, encoding="utf-8")
    print(f"  overview.md: added workspace {workspace}")


# The queue automation workflow. It lives outside the bundle prefix because
# GitHub only reads workflows from .github/workflows/, so it is installed
# rather than vendored — but the copy under claude-arsenal/workflows/ stays the
# source of truth, and this keeps the installed file identical to it.
_QUEUE_WORKFLOW = "arsenal-queue.yml"


def _queue_automation_setting(config: Path) -> str | None:
    """The recorded queue-automation decision: `true`, `false`, or None if never set."""
    if not config.is_file():
        return None
    for line in config.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^\s*queue-automation\s*=\s*(\S+)", line)
        if match:
            return match.group(1).strip().strip('"').lower()
    return None


def _upsert_bare_key(config: Path, key: str, value: str) -> None:
    """Upsert `<key> = <value>` in arsenal/config.toml, above the first table."""
    if config.is_file():
        text = config.read_text(encoding="utf-8")
        if re.search(rf"^\s*{re.escape(key)}\s*=", text, re.MULTILINE):
            text = re.sub(
                rf"^\s*{re.escape(key)}\s*=.*$",
                f"{key} = {value}",
                text,
                count=1,
                flags=re.MULTILINE,
            )
        else:
            # A bare key has to go above the first [table] header — appended at
            # the end of a file that ends in `[models]` it would be read as
            # `models.<key>`, an unknown key the loader ignores, so opting out
            # of the workflow would silently stop working.
            lines = text.rstrip("\n").split("\n")
            table_at = next(
                (i for i, line in enumerate(lines) if line.lstrip().startswith("[")), None
            )
            entry = f"{key} = {value}"
            if table_at is None:
                lines.append(entry)
            else:
                lines[table_at:table_at] = [entry, ""]
            text = "\n".join(lines) + "\n"
    else:
        text = f"{key} = {value}\n"
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text(text, encoding="utf-8")


def _record_queue_automation(config: Path, value: str) -> None:
    """Upsert `queue-automation = <value>` in arsenal/config.toml."""
    _upsert_bare_key(config, "queue-automation", value)


def _install_queue_workflow(repo_path: Path, arsenal: Path, silent: bool = False) -> None:
    """Install .github/workflows/arsenal-queue.yml, and say plainly what it does.

    Installed by default because the whole point is that queue upkeep does not
    depend on anyone remembering it — a workflow a repo has to opt into is one
    more setup step to forget, and the sessions that most need the cleanup are
    the ones that ended badly. But a file that grants itself write access to
    issues and contents should never appear silently, so the first install
    prints exactly what it will do and what it can touch.

    Deleting the file has to be a real opt-out, and that needs a record: the
    session-start protocol runs `init.py --silent` every session, so a purely
    file-based check would reinstall a workflow the user deliberately removed —
    on every single start, re-granting write access they had revoked and
    dirtying their checkout each time. So the decision lives in
    `arsenal/config.toml`, which an upgrade never overwrites:

      * no key       — never offered here. Install it and record `true`.
      * `true`, file present — refresh/no-op, as for any vendored file.
      * `true`, file gone    — deleted since the install. Record `false`, say so
                               once, and never reinstall.
      * `false`      — opted out. Do nothing, silently. Set the key back to
                       `true` to opt in again.

    A workflow the user has edited is left alone — clobbering local changes on
    every session start is how vendored files lose people's trust.
    """
    source = arsenal / "workflows" / _QUEUE_WORKFLOW
    if not source.is_file():
        return
    target = repo_path / ".github" / "workflows" / _QUEUE_WORKFLOW
    config = _home(repo_path) / "config.toml"
    setting = _queue_automation_setting(config)

    if setting == "false":
        return

    if target.exists():
        if setting is None:
            _record_queue_automation(config, "true")
        if _sha256(source) == _sha256(target):
            if not silent:
                print(f"  .github/workflows/{_QUEUE_WORKFLOW}: up to date")
        else:
            print(
                f"  .github/workflows/{_QUEUE_WORKFLOW}: differs from the shipped version "
                f"— left as is. Diff it against {source.relative_to(repo_path)} to pick up "
                "upstream changes."
            )
        return

    if setting == "true":
        # Installed before, gone now: the user removed it. Honour that.
        _record_queue_automation(config, "false")
        print(
            f"  .github/workflows/{_QUEUE_WORKFLOW}: removed by you — recorded "
            "`queue-automation = false` in arsenal/config.toml so it is not reinstalled. "
            "Merging still completes a task; only the automatic upkeep (stale claims, "
            "missing handles) is off. Set the key back to `true` to restore it."
        )
        return

    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    _record_queue_automation(config, "true")
    print(
        f"""
  INSTALLED .github/workflows/{_QUEUE_WORKFLOW} — GitHub now keeps the queue current:
    * a merged task PR whose `Closes` keyword did not fire closes its task anyway
    * a task PR closed WITHOUT merging releases its claim, back onto the board
    * a task file merged to the default branch gets its issue handle immediately
    * a claim held over 24h with no open PR is released (crashed session)
    * a task PR that would merge without closing anything fails its check first
  It asks GitHub for `issues: write` (close/label/comment on task issues) and
  `contents: write` (archive a merged task file). It never runs code from a pull
  request. Delete the file to opt out — that choice is recorded in
  arsenal/config.toml, so it is not reinstalled on the next session start."""
    )


def init_base(
    repo_path: Path,
    bundle_override: Path | None = None,
    silent: bool = False,
    allow_downgrade: bool = False,
    skills_profile: str | None = None,
    sections: list[str] | None = None,
) -> bool:
    """True when the install ran; False when it refused to downgrade (nothing written)."""
    bundle = _bundle_dir(bundle_override)
    arsenal = repo_path / "claude-arsenal"

    if not silent:
        print("Initializing claude-arsenal/...")

    # Version check — upgrade banner when behind, a hard stop when AHEAD.
    newer_installed = _check_bundle_version(bundle, arsenal)
    if newer_installed is not None:
        installed_ver, bundle_ver = newer_installed
        # Printed whatever --silent says: this is the one line that tells a
        # refresh from a revert, and the caller is usually the session-start
        # protocol, which runs silent.
        print(
            f"init: the installed bundle ({installed_ver}) is NEWER than this skill's "
            f"vendored copies ({bundle_ver}) — nothing written. Update the plugin so its "
            f"copies catch up. To overwrite {installed_ver} with {bundle_ver} anyway, "
            f"pass --allow-downgrade."
        )
        if not allow_downgrade:
            return False
        print(f"init: --allow-downgrade — DOWNGRADING {installed_ver} → {bundle_ver}")

    # Scaffold directories. `claude-arsenal/` is upstream's and may be
    # overwritten freely; `arsenal/` is the host's and is created once, never
    # written again by an upgrade — that separation is what lets a consumer
    # vendor the bundle without an update ever touching their tasks or config.
    for d in ["bin", "scripts", "agents"]:
        (arsenal / d).mkdir(parents=True, exist_ok=True)
    home = _home(repo_path)
    # An existing default tree while ARSENAL_HOME points somewhere else is an
    # install about to be orphaned: the tasks and config stay on disk and every
    # script starts reading past them. Scaffolding a second tree beside the
    # first is the less useful of the two answers, and it is silent.
    default_home = repo_path / "arsenal"
    if home != default_home and default_home.is_dir() and not home.exists():
        sys.exit(
            f"init: ARSENAL_HOME points at {home}, which does not exist, while "
            f"{default_home} does. Scaffolding a second host tree would leave the "
            "existing tasks and config where nothing reads them. Move it "
            f"(`mv {default_home} {home}`), or unset ARSENAL_HOME to keep using it."
        )
    for d in ["tasks", "specs", "plans", "project", "session"]:
        (home / d).mkdir(parents=True, exist_ok=True)

    # Refresh bundle files
    if not silent:
        print("Refreshing bundle files:")
    _refresh_bundle(bundle, arsenal, silent=silent)

    # Host configuration. Seeded once and never rewritten, so a preference set
    # here survives every bundle upgrade — unlike one stored in a vendored skill,
    # which is build output and gets replaced.
    config = home / "config.toml"
    if not config.exists():
        config.write_text(_CONFIG_TEMPLATE, encoding="utf-8")
        print(f"  created: {config.relative_to(repo_path)}")

    # Create session handover. This is the ONLY handover the bundle scaffolds.
    # `assets/session/handover.md` used to ship as a bundle file too, so
    # `_refresh_bundle` recreated `<bundle>/session/handover.md` on every run,
    # forever, after the host tree moved to `arsenal/`. Nothing reads that copy
    # — every reader names `{home}/session/handover.md` — but an empty handover
    # is indistinguishable from a fresh install, so a session that opened the
    # wrong one concluded there was no prior context and carried on without it.
    handover = home / "session" / "handover.md"
    if not handover.exists():
        handover.write_text(HANDOVER_TEMPLATE, encoding="utf-8")
        print(f"  created: {handover.relative_to(repo_path)}")

    _retire_shadow_handover(arsenal, home, repo_path)

    # Default surface profile (gitignored — overwritten by detect_surface.sh hook)
    profile = home / "session" / "surface_profile.json"
    if not profile.exists():
        profile.write_text(
            json.dumps(DEFAULT_SURFACE_PROFILE, indent=2) + "\n", encoding="utf-8"
        )
        print(f"  created: {profile.relative_to(repo_path)}")

    # .gitignore — surface profile, the statusLine-written rate-limit snapshot,
    # and the per-session dispatch-round counter (all live, machine-local state)
    # Derived from `home`, not from the literal: ignoring `arsenal/session/…`
    # for a tree that lives at `hosttree/session/` leaves machine-local state
    # stageable, which is the accident these entries exist to prevent.
    session = home.relative_to(repo_path) / "session"
    for entry in (
        "surface_profile.json",
        "rate_limits.json",
        "budget_iterations.json",
        "worktree_isolation",
        # The provenance sidecar record_isolation.sh writes beside it. Same
        # reason as the sentinel: it is an observation about THIS machine and
        # this session, not a fact about the repository.
        "worktree_isolation.why",
        "host_branch",
        # Rescue metadata is machine-local too; it was previously omitted, so a
        # forced-restore snapshot could be swept into a task commit (#140).
        "rescue_refs",
    ):
        _add_gitignore_entry(repo_path, f"{session.as_posix()}/{entry}")

    # GitHub-side queue upkeep (see the function's docstring for why by default)
    _install_queue_workflow(repo_path, arsenal, silent=silent)

    # statusLine command feeding budget_check.sh (token-budget stop)
    _register_statusline(repo_path)

    # Vendor the skills and wire the gate — the only path that reaches a cloud
    # session — then retire a plugin declaration an older init may have written.
    _vendor_skills(repo_path, silent=silent, profile=skills_profile, sections=sections)
    _register_gate_hook(repo_path)
    _retire_plugin_declaration(repo_path)

    # CLAUDE.md
    _inject_claude_md(repo_path)

    ver_path = arsenal / ".bundle-version"
    if silent:
        if ver_path.exists():
            print(f"claude-arsenal {ver_path.read_text(encoding='utf-8').strip()}")
    else:
        print(f"\ninit: claude-arsenal/ ready at {repo_path}")
    return True


def init_workspace(
    repo_path: Path,
    workspace: str,
    root: str,
    spec: str,
    plan: str,
    bundle_override: Path | None = None,
    allow_downgrade: bool = False,
    skills_profile: str | None = None,
    sections: list[str] | None = None,
) -> None:
    # The workspace name becomes a directory under arsenal/project/ — host-owned,
    # so a bundle upgrade never touches a workspace's spec, plan, or context.
    # Strip Windows-style trailing dots/spaces before checking (they normalize
    # to ".." on NTFS) and retain the substring ".." guard for defence-in-depth.
    normalized = workspace.rstrip(". ")
    bad = (not normalized or normalized in (".", "..") or ".." in workspace
           or "/" in workspace or "\\" in workspace or "|" in workspace
           or "\n" in workspace or "\r" in workspace)
    if bad or any(c in p for p in (root, spec, plan) for c in ("|", "\n", "\r")):
        sys.exit("init: invalid workspace name or paths (must not contain '|' or newlines)")

    arsenal = repo_path / "claude-arsenal"

    # Ensure base exists first. A refusal there wrote nothing, so registering a
    # workspace on top would report one ready over an uninitialized bundle.
    #
    # Also run it — on an install that already exists — when the caller named a
    # profile or a section list, because that is the only place either takes
    # effect. Accepting `--sections extract` and installing the defaults is the
    # expensive direction of silent: the caller believes the section is on, and
    # finds out when a skill they asked for is not there. `init_base` is
    # idempotent by construction (the session-start protocol runs it every
    # session), so the extra call on an existing install is a refresh.
    wants_sections = skills_profile is not None or sections is not None
    if (not (arsenal / "bin").is_dir() or wants_sections) and not init_base(
        repo_path,
        bundle_override,
        allow_downgrade=allow_downgrade,
        skills_profile=skills_profile,
        sections=sections,
    ):
        sys.exit("init: workspace not registered — the bundle refused to install (see above)")

    ws_dir = _home(repo_path) / "project" / workspace
    ws_dir.mkdir(parents=True, exist_ok=True)
    print(f"Registering workspace {workspace!r}...")

    stubs = {
        "spec.md": WORKSPACE_SPEC_STUB.format(name=workspace),
        "plan.md": WORKSPACE_PLAN_STUB.format(name=workspace),
        "context.md": WORKSPACE_CONTEXT_STUB.format(name=workspace),
        "handover.md": WORKSPACE_HANDOVER_STUB.format(name=workspace),
    }
    for filename, content in stubs.items():
        fp = ws_dir / filename
        if not fp.exists():
            fp.write_text(content, encoding="utf-8")
            print(f"  created: {fp.relative_to(repo_path)}")
        else:
            print(f"  exists:  {fp.relative_to(repo_path)}")

    _upsert_overview(repo_path, workspace, root, spec, plan)
    print(f"\ninit: workspace {workspace!r} ready at {ws_dir.relative_to(repo_path)}")


def _parse_sections(raw: str | None) -> list[str] | None:
    """`--sections a,b` -> ["a", "b"]. An unknown name is fatal, not ignored.

    A typo'd section is a request for skills that will not be installed, and
    silently installing fewer skills than someone asked for is the kind of
    failure nobody notices until a skill they expected does not trigger.
    """
    if raw is None:
        return None
    known = _known_sections()
    names = [part.strip() for part in raw.split(",") if part.strip()]
    unknown = sorted(set(names) - known - {_CORE_SECTION})
    if unknown:
        sys.exit(
            f"init: unknown section(s) {', '.join(unknown)} — "
            f"known sections are {', '.join(sorted(known))}"
        )
    return names


def main() -> None:
    """Parse the CLI and run either a base install or a workspace registration."""
    p = argparse.ArgumentParser(description="Bootstrap or update claude-arsenal/ in a host repo.")
    p.add_argument("--repo-path", default=".", help="Path to the host repository root.")
    p.add_argument("--workspace", metavar="NAME", help="Register a workspace.")
    p.add_argument("--root", default=None, help="Workspace root dir (default: ./<NAME>/).")
    p.add_argument("--spec", default=None, help="Spec file path override.")
    p.add_argument("--plan", default=None, help="Plan file path override.")
    p.add_argument("--bundle-dir", help="Override path to plugin bundle/ (for testing).")
    p.add_argument(
        "--profile",
        choices=sorted(_PROFILES),
        help="What kind of project this is, as a starting set of skill sections: "
        + "; ".join(
            f"{name} = core"
            + ("".join(f" + {s}" for s in secs) if secs else " only")
            for name, secs in sorted(_PROFILES.items())
        )
        + ". Recorded as an editable [skills] table in arsenal/config.toml.",
    )
    p.add_argument(
        "--sections",
        metavar="A,B",
        help="Install exactly these skill sections (comma-separated), on top of core. "
        f"Known: {', '.join(sorted(_known_sections()))}. Overrides --profile.",
    )
    p.add_argument(
        "--list-sections",
        action="store_true",
        help="Print the capability map — every skill section this bundle ships, whether it is "
        "installed here, and the skills of the ones that are not. Writes nothing.",
    )
    p.add_argument(
        "--section",
        metavar="NAME",
        help="Detail for one section: every skill it contains, with its description. "
        "Answers whether an uninstalled skill actually fits before recommending it.",
    )
    # `--quiet` is the canon's spelling; `--silent` shipped first and keeps
    # working, so no consumer's existing invocation breaks.
    p.add_argument(
        "--quiet", "--silent", action="store_true", dest="silent",
        help="Suppress 'up to date' lines; only print refreshed files and version banner.",
    )
    p.add_argument(
        "--allow-downgrade", action="store_true",
        help="Overwrite a NEWER installed bundle with this skill's older copies.",
    )
    args = p.parse_args()

    repo_path = Path(args.repo_path).resolve()
    bundle_override = Path(args.bundle_dir) if args.bundle_dir else None

    # Read-only, and answered before anything else: this is what the session-start
    # protocol runs, and it must never be a path into an install.
    if args.list_sections or args.section:
        raise SystemExit(list_sections(repo_path, only=args.section))

    if args.workspace:
        name = args.workspace
        root = args.root or f"./{name}/"
        # The stubs are written under the resolved home, so the paths recorded
        # in overview.md have to point at the same place.
        ws_rel = (_home(repo_path).relative_to(repo_path) / "project" / name).as_posix()
        spec = args.spec or f"{ws_rel}/spec.md"
        plan = args.plan or f"{ws_rel}/plan.md"
        init_workspace(repo_path, name, root, spec, plan, bundle_override,
                       allow_downgrade=args.allow_downgrade,
                       skills_profile=args.profile,
                       sections=_parse_sections(args.sections))
    else:
        init_base(repo_path, bundle_override, silent=args.silent,
                  allow_downgrade=args.allow_downgrade, skills_profile=args.profile,
                  sections=_parse_sections(args.sections))


if __name__ == "__main__":
    main()
