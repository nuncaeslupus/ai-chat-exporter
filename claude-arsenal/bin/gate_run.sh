#!/usr/bin/env bash
# gate_run.sh <task_id>
# Runs the mechanical acceptance gate for a task, if one is defined.
#
# Reads arsenal/tasks/<task_id>.md — falling back to `git show <ref>:…` when the
# file is not on disk, so a caller whose tree predates the commit that added the
# task (a worker on an older base) never has to materialize one —
# and looks for the first ```bash (or ```sh) code block inside the
# ## Acceptance gate section. If found, executes it in the repo root; if absent
# (prose-only gate), nothing is executed.
#
# A GATE THAT RAN NOTHING IS NOT A PASS, and it no longer looks like one. The
# no-block case used to exit 0 in silence, indistinguishable from a real pass —
# and since a worker opens no PR when this script fails,
# a repo whose payloads all write gates as prose (or as inline single-backtick
# commands, which the fence regex does not match) had an inert gate layer for
# every task without a word of warning. One consumer audit found 0 of 70
# payloads carrying a fenced block. Every outcome is now announced on stdout as
# a `gate:` line and, when nothing ran, warned about on stderr:
#
#   gate: passed      a block was found and it exited 0
#   gate: unmeasured  the evidence file declares the metric unmeasured (exit 3)
#   gate: prose-only  an ## Acceptance gate section exists with no fenced block
#   gate: none        no ## Acceptance gate section at all
#
# Set ARSENAL_GATE_REQUIRE_BLOCK=1 to make the two nothing-ran outcomes a hard
# failure (exit 1) — the right setting for a repo that intends every task to
# carry a mechanical gate.
#
# SECURITY: the gate block runs VERBATIM in the caller's working tree — it is
# code, not data. A plan/payload an attacker can influence is therefore
# RCE-from-data; review gate blocks before running. To limit the blast radius
# the gate runs under a throwaway HOME and a PATH stripped of $HOME-local shims
# by default, so $HOME-keyed secrets (~/.ssh, ~/.aws, ~/.netrc, ~/.config/gh)
# and user-writable shim dirs are out of reach — except the directories holding
# the package manager / language runtime (pnpm, npm, node, uv, cargo …), which
# are re-admitted because they are commonly $HOME-installed and without them
# every `pnpm …` gate dies with exit 127 instead of running. This is NOT a
# sandbox. Set ARSENAL_GATE_INHERIT_ENV=1 to run with the caller's full
# environment for gates that genuinely need the real HOME (build caches,
# credentials).
#
# Exit: 0 gate passed, or nothing mechanical was defined (see the `gate:` line)
#       1 gate failed (command exited non-zero), or nothing ran under
#         ARSENAL_GATE_REQUIRE_BLOCK=1
#       2 usage/setup error — including "no task file on disk NOR on any
#         known ref", i.e. there is nothing to read a gate from
#       3 gate COULD NOT RUN (command/interpreter not found, 126/127). Distinct
#         from 1 so "the gate never executed" is never mistaken for a verdict.
#         Also printed loudly on stdout, so a caller that pipes this script's
#         output (`gate_run.sh <id> | tail`) — and thereby loses the exit status
#         to the pipeline — still sees that nothing was verified.

set -euo pipefail

TASK_ID="${1:-}"
if [[ -z "${TASK_ID}" ]]; then
    echo "Usage: gate_run.sh <task_id>" >&2
    exit 2
fi

PAYLOAD_TMP=""
# `return 0` matters: under `set -e` a non-zero status out of an EXIT trap
# becomes the script's exit status, which would report every clean run as failed.
cleanup() { [[ -n "${PAYLOAD_TMP}" ]] && rm -f "${PAYLOAD_TMP}"; return 0; }
trap cleanup EXIT

# The task file is ordinary versioned content on the default branch, so any
# worktree cut from there already has it. That is a direct consequence of tasks
# being repository files rather than rows on a coordination branch: the old code
# needed a `git show <branch>:…` fallback and a temp file outside the tree,
# because the payload only existed on a ref the worker was not on.
HOME_DIR="${ARSENAL_HOME:-arsenal}"
PAYLOAD="${HOME_DIR}/tasks/${TASK_ID}.md"

# ARSENAL_GATE_FROM_DEFAULT=1 prefers the default branch's copy over the one on
# disk. open_task_pr.sh sets it, because there the gate is an enforcement
# precondition rather than a convenience: a worker whose own branch supplies the
# gate it is being held to is certifying itself. Everywhere else the working
# copy is what the author wants to run, so the default is unchanged. One
# exception, below: when the default branch's gate COMMAND is still the shipped
# placeholder, it is taken from the working copy — otherwise the first PR that
# could define a real check is the one this gate refuses.
_prefer_default=0
[[ "${ARSENAL_GATE_FROM_DEFAULT:-}" == "1" && -f "${PAYLOAD}" ]] && _prefer_default=1

if [[ ! -f "${PAYLOAD}" || ${_prefer_default} -eq 1 ]]; then
    # Fall back to reading it from the default branch: a worktree cut from an
    # older base can predate the commit that added the task.
    REMOTE="${ARSENAL_QUEUE_REMOTE:-origin}"
    DEFAULT_BRANCH="${ARSENAL_DEFAULT_BRANCH:-}"
    if [[ -z "${DEFAULT_BRANCH}" ]]; then
        # `|| true`: under `set -euo pipefail` a failing git here (no remote
        # HEAD configured, which is normal in a fresh clone or a test repo) took
        # the whole script down with git's exit 128 instead of falling through to
        # the `main` default below. Latent until something made this path run
        # while the task file was present.
        DEFAULT_BRANCH="$(git symbolic-ref --short "refs/remotes/${REMOTE}/HEAD" 2>/dev/null | sed "s#^${REMOTE}/##" || true)"
    fi
    DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
    # Materialize OUTSIDE the repo tree: a file written inside it would be swept
    # into the feature branch by open_task_pr.sh's `git add -A`.
    PAYLOAD_TMP="$(mktemp -t "arsenal-task-${TASK_ID}-XXXXXX.md")"
    found=0
    for ref in "${REMOTE}/${DEFAULT_BRANCH}" "${DEFAULT_BRANCH}"; do
        if git show "${ref}:${HOME_DIR}/tasks/${TASK_ID}.md" >"${PAYLOAD_TMP}" 2>/dev/null; then
            # Not "(not on disk)": in this branch the file usually IS on disk,
            # and saying otherwise sent workers looking for a stale checkout
            # instead of telling them the default branch's copy is the one that
            # counts.
            echo "gate_run: task file read from ${ref} (preferred over the working copy)" >&2
            PAYLOAD="${PAYLOAD_TMP}"
            found=1
            break
        fi
    done
    if [[ ${found} -eq 0 ]]; then
        if [[ ${_prefer_default} -eq 1 ]]; then
            # Not on the default branch yet — a task added by this very PR. The
            # working copy is all there is, so use it and say so.
            rm -f "${PAYLOAD_TMP}"; PAYLOAD_TMP=""
            PAYLOAD="${HOME_DIR}/tasks/${TASK_ID}.md"
            echo "gate_run: ${TASK_ID} is not on the default branch yet — gating on the working copy" >&2
        else
            echo "gate_run: task file not found: ${HOME_DIR}/tasks/${TASK_ID}.md" >&2
            exit 2
        fi
    fi
fi

# When the default branch's copy won, keep the working copy's path too. The
# assertion (the ```gate block, its threshold and evidence path) always comes
# from the default branch — that is what self-certification would target — but a
# task still carrying the shipped PLACEHOLDER command can never define its first
# real one: the only PR that could replace it is the one this gate refuses.
WORKING_PAYLOAD=""
[[ ${_prefer_default} -eq 1 && -n "${PAYLOAD_TMP}" ]] && WORKING_PAYLOAD="${HOME_DIR}/tasks/${TASK_ID}.md"

# Enforce a structured numeric evidence gate first, if the payload declares one.
# A declared evidence gate can never pass vacuously (CA-12): a missing evidence
# file or a measurement that violates the threshold fails the gate right here,
# before the prose/bash-block path can let it through.
GATE_EVIDENCE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../scripts/gate_evidence.py"
if [[ -f "${GATE_EVIDENCE_PY}" ]]; then
    # `|| _ev=$?`, not a bare call followed by `$?`: under `set -e` a non-zero
    # exit from a simple command ends the script right there, so every line
    # below — the `gate: unmeasured` verdict, both stderr messages, the exit
    # mapping — was unreachable for exactly the runs they exist to describe. A
    # caller parsing the `gate:` line saw nothing, and an exit 2 from
    # gate_evidence.py surfaced as this script's "usage error" rather than as a
    # gate failure.
    _ev=0
    python3 "${GATE_EVIDENCE_PY}" "${PAYLOAD}" || _ev=$?
    # 3 means the evidence file positively declares the metric unmeasured: the
    # check ran and found that this cannot be scored yet. That is not a verdict,
    # and collapsing it into 1 would make the one honest answer a hard failure —
    # which is what pressures an author into weakening a gate to something
    # measurable. Propagated as 3, the same code this script already uses for
    # "the gate could not run".
    if [[ ${_ev} -eq 3 ]]; then
        echo "gate: unmeasured"
        echo "gate_run: ${TASK_ID} declares its metric unmeasured — nothing was verified" >&2
        exit 3
    fi
    if [[ ${_ev} -ne 0 ]]; then
        echo "gate_run: evidence gate failed for ${TASK_ID}" >&2
        exit 1
    fi
fi

python3 - "${PAYLOAD}" "${TASK_ID}" "${WORKING_PAYLOAD}" <<'PY'
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

payload = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
# Passed explicitly: the payload path is a temp file when it was resolved from
# the coordination ref, so its stem is not the task id.
task_id = sys.argv[2]

# `strict` turns "nothing executable was found" into a hard failure, for repos
# that intend every task to carry a mechanical gate.
strict = os.environ.get("ARSENAL_GATE_REQUIRE_BLOCK", "") not in ("", "0", "false")


def nothing_ran(kind, detail):
    """Announce that no command was executed. Never silent: this is the state
    that used to be indistinguishable from a real pass."""
    print(f"gate: {kind}")
    print(
        f"gate_run: {task_id} — NOTHING WAS EXECUTED ({detail}). "
        "This is not a mechanical pass; whatever verification happened was a human's "
        "or an agent's judgment, not this gate's.",
        file=sys.stderr,
    )
    if strict:
        print(
            "gate_run: ARSENAL_GATE_REQUIRE_BLOCK=1 — failing because the payload "
            "defines no runnable ```bash block under '## Acceptance gate'.",
            file=sys.stderr,
        )
        sys.exit(1)
    sys.exit(0)


def gate_section(text):
    """The ## Acceptance gate section (up to the next ## heading or EOF)."""
    m = re.search(
        r'##\s+Acceptance gate\s*\n(.*?)(?=\n##\s|\Z)', text, re.DOTALL | re.IGNORECASE
    )
    return m.group(1) if m else None


def gate_command(section):
    """First ```bash/```sh block in the section, stripped. None when there is
    none. An inline single-backtick command does NOT match and never has — that
    is the most common way a gate ends up inert, so callers name it."""
    m = re.search(r'```(?:bash|sh)\s*\n(.*?)```', section, re.DOTALL) if section else None
    return m.group(1).strip().replace('\r', '') if m else None


# The command every new task ships with, which fails on purpose so that an
# undefined gate is loud rather than vacuous. Recognising it is what lets the
# first PR define a real one; the marker is the current template's, the lone
# `false` covers every task filed from an earlier one.
PLACEHOLDER_MARKER = "arsenal:gate-placeholder"


def is_placeholder(cmd):
    lines = cmd.splitlines()
    # On the block's FIRST line, and only as a comment. A real gate may carry the
    # marker as data — a grep for un-replaced placeholders is exactly the check
    # someone writes, and a heredoc body can hold the marker line verbatim — and
    # matching that would hand the command back to the branch under review, which
    # is the guard this whole path exists to keep. Nothing can precede a heredoc's
    # body but the command opening it, so the first line is never data.
    first = next((ln.strip() for ln in lines if ln.strip()), "")
    if first.startswith("#") and PLACEHOLDER_MARKER in first:
        return True
    code = [ln.split("#", 1)[0].strip() for ln in lines]
    return [ln for ln in code if ln] == ["false"]


section = gate_section(payload)
if section is None:
    nothing_ran("none", "the payload has no '## Acceptance gate' section")

cmd = gate_command(section)
if cmd is None:
    nothing_ran(
        "prose-only",
        "the '## Acceptance gate' section has no fenced ```bash/```sh block — "
        "prose and inline `single-backtick` commands are not executed",
    )
if not cmd:
    nothing_ran("prose-only", "the fenced gate block is empty")

# The bootstrap case: the default branch still has the placeholder, so the
# assertion is real but nothing can produce a measurement for it yet. Take the
# command from the working copy and say which copy ran — the threshold it is
# held to is still the board's.
working = sys.argv[3] if len(sys.argv) > 3 else ""
if working and is_placeholder(cmd):
    try:
        wcmd = gate_command(gate_section(pathlib.Path(working).read_text(encoding="utf-8")))
    except OSError:
        wcmd = None
    if wcmd and not is_placeholder(wcmd):
        print(
            f"gate_run: {task_id} — the default branch still carries the placeholder gate "
            "command; running the working copy's instead. The gate block (metric, operator, "
            "threshold, evidence path) was still read from the default branch.",
            file=sys.stderr,
        )
        cmd = wcmd
elif working:
    # The branch edited a gate that is already real on the board. That edit is
    # discarded by design — it is exactly what self-certification would target —
    # but discarding it in silence is what costs the session: the gate fails
    # naming a symbol the implementation renamed, and the worker debugs its own
    # code against a test that no longer exists. Say which command ran and why.
    try:
        wcmd = gate_command(gate_section(pathlib.Path(working).read_text(encoding="utf-8")))
    except OSError:
        wcmd = None
    if wcmd and wcmd != cmd:
        print(
            f"gate_run: {task_id} — the gate that ran is the one on the DEFAULT BRANCH. "
            "Your branch edits the gate block, and that edit was NOT used and cannot be: "
            "a task's gate is the precondition it was accepted under, so a PR cannot "
            "change the gate it is judged by. If the gate genuinely needs amending, merge "
            "the task-file change on its own first, or open a new task.",
            file=sys.stderr,
        )
    else:
        print(
            f"gate_run: {task_id} — the gate command is still the placeholder on both the "
            "default branch and the working copy. Replace the ```bash block under "
            "'## Acceptance gate' with the real check; it may land in this task's own PR.",
            file=sys.stderr,
        )

script = "#!/usr/bin/env bash\nset -euo pipefail\n" + cmd + "\n"


def _run(env):
    # Pipe the script to `bash -s` over stdin: nothing is ever written to a
    # persisted temp file, so a hard kill leaves no orphaned 0700 script behind.
    return subprocess.run(["bash", "-s"], input=script, text=True, env=env).returncode


def _finish(rc):
    if rc == 0:
        print("gate: passed")
        sys.exit(0)
    if rc in (126, 127):
        # The gate never executed — a missing/non-executable command, not a
        # verdict on the work. Say so on BOTH streams: a caller piping this
        # script's stdout keeps the message even when the pipeline eats the
        # exit status, which is how a never-run gate came to read as a pass.
        msg = (
            f"gate_run: {task_id} — GATE COULD NOT RUN (exit {rc}: command not found "
            "or not executable). This is NOT a pass — nothing was verified. If the "
            "gate needs a $HOME-installed tool the hardened PATH does not carry, run "
            "with ARSENAL_GATE_INHERIT_ENV=1."
        )
        print(msg, flush=True)
        print(msg, file=sys.stderr)
        sys.exit(3)
    sys.exit(1)


inherit = os.environ.get("ARSENAL_GATE_INHERIT_ENV", "") not in ("", "0", "false")
if inherit:
    _finish(_run(None))

# Hardened-by-default environment: throwaway HOME + PATH with $HOME-local shim
# dirs stripped. Keeps system + non-home tooling on PATH so common gates still
# resolve `python3`/`make`/etc., while removing user-writable shim dirs and
# $HOME-keyed credential lookups from the gate's reach.
real_home = os.path.abspath(os.path.expanduser("~"))


def _under_home(d):
    # A directory IS the home dir, or sits beneath it. Guard against HOME="/"
    # (minimal/root containers), where everything would otherwise count as
    # "under home" and the whole inherited PATH would be dropped.
    if real_home == os.sep:
        return False
    ad = os.path.abspath(d)
    return ad == real_home or ad.startswith(real_home + os.sep)


safe_path = os.pathsep.join(
    d for d in os.environ.get("PATH", "").split(os.pathsep) if d and not _under_home(d)
)
for system_dir in ("/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"):
    if system_dir not in safe_path.split(os.pathsep):
        safe_path = f"{safe_path}{os.pathsep}{system_dir}" if safe_path else system_dir

# Re-admit the directories holding the project's package manager / language
# runtime. These are routinely installed under $HOME (nvm, corepack, volta,
# asdf, pyenv, uv, rustup), so stripping $HOME wholesale leaves `pnpm test` and
# friends with exit 127 — a gate that CANNOT RUN, which is worse than an
# unhardened one: it verifies nothing, and every caller has to work around it
# with ARSENAL_GATE_INHERIT_ENV=1, which hands the gate the *entire* real
# HOME/PATH. Admitting just these dirs keeps the rest of $HOME off PATH, and
# HOME itself stays a throwaway.
for tool in ("pnpm", "npm", "yarn", "bun", "node", "corepack", "uv", "poetry", "cargo"):
    found = shutil.which(tool, path=os.environ.get("PATH", ""))
    tool_dir = os.path.dirname(os.path.abspath(found)) if found else None
    if tool_dir and tool_dir not in safe_path.split(os.pathsep):
        safe_path = f"{tool_dir}{os.pathsep}{safe_path}" if safe_path else tool_dir

with tempfile.TemporaryDirectory(prefix="arsenal-gate-home-") as gate_home:
    env = {
        "PATH": safe_path,
        "HOME": gate_home,
        "PWD": os.getcwd(),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
        "TERM": os.environ.get("TERM", "dumb"),
    }
    # A repo pinning "packageManager" makes corepack resolve that version out of
    # its own cache; keyed to HOME, a throwaway one re-downloads the package
    # manager on every gate run and fails outright offline. Point it at the real
    # cache — a package cache, not a credential store.
    corepack_home = os.environ.get("COREPACK_HOME") or os.path.join(
        real_home, ".cache", "node", "corepack"
    )
    if os.path.isdir(corepack_home):
        env["COREPACK_HOME"] = corepack_home
    rc = _run(env)
_finish(rc)
PY
