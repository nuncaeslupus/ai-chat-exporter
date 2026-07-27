#!/usr/bin/env bash
# gate_run.sh <task_id>
# Runs the mechanical acceptance gate for a task, if one is defined.
#
# Reads claude-arsenal/queue/<task_id>.md and looks for the first ```bash (or
# ```sh) code block inside the ## Acceptance gate section. If found, executes
# it in the repo root; if absent (prose-only gate), exits 0 immediately.
#
# SECURITY: the gate block runs VERBATIM in the caller's working tree — it is
# code, not data. A plan/payload an attacker can influence is therefore
# RCE-from-data; review gate blocks before running. To limit the blast radius
# the gate runs under a throwaway HOME and a PATH stripped of $HOME-local shims
# by default, so $HOME-keyed secrets (~/.ssh, ~/.aws, ~/.netrc, ~/.config/gh)
# and user-writable shim dirs are out of reach. This is NOT a sandbox. Set
# ARSENAL_GATE_INHERIT_ENV=1 to run with the caller's full environment for
# gates that genuinely need the real HOME/PATH (caches, pyenv/cargo shims).
#
# Exit: 0 gate passed or no mechanical gate defined
#       1 gate failed (command exited non-zero)
#       2 usage/setup error

set -euo pipefail

TASK_ID="${1:-}"
if [[ -z "${TASK_ID}" ]]; then
    echo "Usage: gate_run.sh <task_id>" >&2
    exit 2
fi

PAYLOAD="claude-arsenal/queue/${TASK_ID}.md"
if [[ ! -f "${PAYLOAD}" ]]; then
    echo "gate_run: payload not found: ${PAYLOAD}" >&2
    exit 2
fi

# Enforce a structured numeric evidence gate first, if the payload declares one.
# A declared evidence gate can never pass vacuously (CA-12): a missing evidence
# file or a measurement that violates the threshold fails the gate right here,
# before the prose/bash-block path can let it through.
GATE_EVIDENCE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../scripts/gate_evidence.py"
if [[ -f "${GATE_EVIDENCE_PY}" ]] && ! python3 "${GATE_EVIDENCE_PY}" "${PAYLOAD}"; then
    echo "gate_run: evidence gate failed for ${TASK_ID}" >&2
    exit 1
fi

python3 - "${PAYLOAD}" <<'PY'
import os
import pathlib
import re
import subprocess
import sys
import tempfile

payload = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")

# Extract ## Acceptance gate section (up to next ## heading or EOF).
section_match = re.search(
    r'##\s+Acceptance gate\s*\n(.*?)(?=\n##\s|\Z)', payload, re.DOTALL | re.IGNORECASE
)
if not section_match:
    sys.exit(0)  # no gate section — nothing to run

section = section_match.group(1)

# Find first ```bash or ```sh code block inside the section.
block_match = re.search(r'```(?:bash|sh)\s*\n(.*?)```', section, re.DOTALL)
if not block_match:
    sys.exit(0)  # prose-only gate — deferred to worker judgment

cmd = block_match.group(1).strip().replace('\r', '')
if not cmd:
    sys.exit(0)

script = "#!/usr/bin/env bash\nset -euo pipefail\n" + cmd + "\n"


def _run(env):
    # Pipe the script to `bash -s` over stdin: nothing is ever written to a
    # persisted temp file, so a hard kill leaves no orphaned 0700 script behind.
    return subprocess.run(["bash", "-s"], input=script, text=True, env=env).returncode


inherit = os.environ.get("ARSENAL_GATE_INHERIT_ENV", "") not in ("", "0", "false")
if inherit:
    sys.exit(1 if _run(None) != 0 else 0)

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

with tempfile.TemporaryDirectory(prefix="arsenal-gate-home-") as gate_home:
    env = {
        "PATH": safe_path,
        "HOME": gate_home,
        "PWD": os.getcwd(),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
        "TERM": os.environ.get("TERM", "dumb"),
    }
    rc = _run(env)
sys.exit(1 if rc != 0 else 0)
PY
