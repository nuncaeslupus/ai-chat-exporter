#!/usr/bin/env python3
"""init.py - Bootstrap or update claude-arsenal/ in a host repository."""
import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

CLAUDE_MD_MARKER = "<!-- claude-arsenal: auto-managed -->"

CLAUDE_MD_BLOCK = """\
<!-- claude-arsenal: auto-managed -->
## Automatic session protocol

Every session, without waiting to be asked:

1. Read `claude-arsenal/project/overview.md` (project + workspace index).
2. Read `claude-arsenal/session/handover.md` for last session activity.
3. Run `claude-arsenal/bin/queue_eval.sh`.
   - **Tasks available** → start worker loop (see `@claude-arsenal/AGENTS.md`).
   - **Queue empty + workspace plans exist** → seed from each workspace's plan, then workers.
   - **Queue empty + `status/plan.md` exists** → seed from it, then workers.
   - **Nothing** → ask what to work on.
4. After any session with tasks: update workspace handover + global session handover.

@claude-arsenal/AGENTS.md"""

DEFAULT_SURFACE_PROFILE = {
    "surface": "unknown",
    "capabilities": ["surface:cli", "surface:web"],
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

1. Read `claude-arsenal/AGENTS.md` for the worker loop algorithm.
2. Run `claude-arsenal/bin/queue_eval.sh` to get the next unblocked task.
3. If the last task is still `in_progress` with no active assignee, run:
   `claude-arsenal/bin/release.sh <task_id> open` to requeue it first.
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
# (AGENTS.md marks session/, project/, and queue/ "host-owned; never touched by
# /init re-run"). Clobbering them wipes the consumer's handover / plans / queue
# on every `init --silent` at session start. Only session/ ships a template
# today; project/ and queue/ are listed defensively so a future bundle file
# under them can't introduce the same data loss.
_SCAFFOLD_ONCE = ("session/", "project/", "queue/")


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


def _check_bundle_version(bundle: Path, arsenal: Path) -> None:
    """Print an upgrade banner when the installed bundle version is behind the plugin source."""
    bundle_ver_path = bundle / ".bundle-version"
    installed_ver_path = arsenal / ".bundle-version"
    if not bundle_ver_path.exists() or not installed_ver_path.exists():
        return
    bundle_ver = bundle_ver_path.read_text(encoding="utf-8").strip()
    installed_ver = installed_ver_path.read_text(encoding="utf-8").strip()
    if installed_ver != bundle_ver:
        print(
            f"Upgrading claude-arsenal bundle: {installed_ver} → {bundle_ver}"
        )


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


def _inject_claude_md(repo_path: Path) -> None:
    claude_md = repo_path / "CLAUDE.md"
    if claude_md.exists():
        content = claude_md.read_text(encoding="utf-8")
        if CLAUDE_MD_MARKER in content:
            print("  CLAUDE.md: session-protocol block already present — skipping")
            return
        new_content = content.rstrip("\n") + f"\n\n{CLAUDE_MD_BLOCK}\n"
        claude_md.write_text(new_content, encoding="utf-8")
        print("  CLAUDE.md: injected session-protocol block")
    else:
        claude_md.write_text(f"{CLAUDE_MD_BLOCK}\n", encoding="utf-8")
        print("  CLAUDE.md: created with session-protocol block")


def _upsert_overview(repo_path: Path, workspace: str, root: str, spec: str, plan: str) -> None:
    overview = repo_path / "claude-arsenal" / "project" / "overview.md"
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


def init_base(
    repo_path: Path,
    bundle_override: Path | None = None,
    silent: bool = False,
) -> None:
    bundle = _bundle_dir(bundle_override)
    arsenal = repo_path / "claude-arsenal"

    if not silent:
        print("Initializing claude-arsenal/...")

    # Version check — prints upgrade banner when behind the plugin source
    _check_bundle_version(bundle, arsenal)

    # Scaffold directories
    for d in ["bin", "project", "queue", "session", "agents"]:
        (arsenal / d).mkdir(parents=True, exist_ok=True)

    # Refresh bundle files
    if not silent:
        print("Refreshing bundle files:")
    _refresh_bundle(bundle, arsenal, silent=silent)

    # Create empty queue
    queue_file = arsenal / "queue" / "tasks.jsonl"
    if not queue_file.exists():
        queue_file.write_text("", encoding="utf-8")
        print(f"  created: {queue_file.relative_to(repo_path)}")

    # Create session handover
    handover = arsenal / "session" / "handover.md"
    if not handover.exists():
        handover.write_text(
            "# Session Handover\n\n<!-- Written at session end. -->\n",
            encoding="utf-8",
        )
        print(f"  created: {handover.relative_to(repo_path)}")

    # Default surface profile (gitignored — overwritten by detect_surface.sh hook)
    profile = arsenal / "session" / "surface_profile.json"
    if not profile.exists():
        profile.write_text(
            json.dumps(DEFAULT_SURFACE_PROFILE, indent=2) + "\n", encoding="utf-8"
        )
        print(f"  created: {profile.relative_to(repo_path)}")

    # .gitignore — surface profile, the statusLine-written rate-limit snapshot,
    # and the per-session dispatch-round counter (all live, machine-local state)
    _add_gitignore_entry(repo_path, "claude-arsenal/session/surface_profile.json")
    _add_gitignore_entry(repo_path, "claude-arsenal/session/rate_limits.json")
    _add_gitignore_entry(repo_path, "claude-arsenal/session/budget_iterations.json")
    _add_gitignore_entry(repo_path, "claude-arsenal/session/worktree_isolation")
    _add_gitignore_entry(repo_path, "claude-arsenal/session/host_branch")

    # statusLine command feeding budget_check.sh (token-budget stop)
    _register_statusline(repo_path)

    # CLAUDE.md
    _inject_claude_md(repo_path)

    ver_path = arsenal / ".bundle-version"
    if silent:
        if ver_path.exists():
            print(f"claude-arsenal {ver_path.read_text(encoding='utf-8').strip()}")
    else:
        print(f"\ninit: claude-arsenal/ ready at {repo_path}")


def init_workspace(
    repo_path: Path,
    workspace: str,
    root: str,
    spec: str,
    plan: str,
    bundle_override: Path | None = None,
) -> None:
    # The workspace name becomes a directory under claude-arsenal/project/.
    # Strip Windows-style trailing dots/spaces before checking (they normalize
    # to ".." on NTFS) and retain the substring ".." guard for defence-in-depth.
    normalized = workspace.rstrip(". ")
    bad = (not normalized or normalized in (".", "..") or ".." in workspace
           or "/" in workspace or "\\" in workspace or "|" in workspace
           or "\n" in workspace or "\r" in workspace)
    if bad or any(c in p for p in (root, spec, plan) for c in ("|", "\n", "\r")):
        sys.exit("init: invalid workspace name or paths (must not contain '|' or newlines)")

    arsenal = repo_path / "claude-arsenal"

    # Ensure base exists first
    if not (arsenal / "bin").is_dir():
        init_base(repo_path, bundle_override)

    ws_dir = arsenal / "project" / workspace
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


def main() -> None:
    p = argparse.ArgumentParser(description="Bootstrap or update claude-arsenal/ in a host repo.")
    p.add_argument("--repo-path", default=".", help="Path to the host repository root.")
    p.add_argument("--workspace", metavar="NAME", help="Register a workspace.")
    p.add_argument("--root", default=None, help="Workspace root dir (default: ./<NAME>/).")
    p.add_argument("--spec", default=None, help="Spec file path override.")
    p.add_argument("--plan", default=None, help="Plan file path override.")
    p.add_argument("--bundle-dir", help="Override path to plugin bundle/ (for testing).")
    p.add_argument(
        "--silent", action="store_true",
        help="Suppress 'up to date' lines; only print refreshed files and version banner.",
    )
    args = p.parse_args()

    repo_path = Path(args.repo_path).resolve()
    bundle_override = Path(args.bundle_dir) if args.bundle_dir else None

    if args.workspace:
        name = args.workspace
        root = args.root or f"./{name}/"
        spec = args.spec or f"claude-arsenal/project/{name}/spec.md"
        plan = args.plan or f"claude-arsenal/project/{name}/plan.md"
        init_workspace(repo_path, name, root, spec, plan, bundle_override)
    else:
        init_base(repo_path, bundle_override, silent=args.silent)


if __name__ == "__main__":
    main()
