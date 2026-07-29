#!/usr/bin/env bash
# Self-checking test for claude-arsenal/bin/gate_run.sh (D-14).
#
# The repo has no shell-test framework (vitest only covers .ts), so this is a
# plain assert script: `bash tests/gate_run_test.sh`, exit 0 = all pass.
#
# What it pins down:
#   - a gate that CANNOT run (missing command) exits 3, never 0
#   - the "could not run" banner reaches stdout, so a `| tail` caller still sees
#     it after the pipeline has eaten the exit status
#   - a gate that runs and fails still exits 1 (unchanged contract)
#   - a passing gate exits 0 (unchanged contract — release.sh depends on it)
#   - the project's package manager is reachable inside the hardened env
#   - a payload absent from disk is read from the coordination branch, and
#     nothing is written into the repo tree to do it

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE_RUN="${REPO_ROOT}/claude-arsenal/bin/gate_run.sh"
WORK="$(mktemp -d -t gate-run-test-XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

mkdir -p "${WORK}/claude-arsenal/queue"
FAILURES=0

# Writes a payload whose ## Acceptance gate holds $2 as its bash block.
payload() {
    printf '# %s\n\n## Acceptance gate\n\n```bash\n%s\n```\n' "$1" "$2" \
        >"${WORK}/claude-arsenal/queue/$1.md"
}

# run <task_id> -> sets RC and OUT (stdout only, stderr discarded).
run() {
    OUT="$(cd "${WORK}" && bash "${GATE_RUN}" "$1" 2>/dev/null)"
    RC=$?
}

check() { # check <label> <expected> <actual>
    if [[ "$2" == "$3" ]]; then
        echo "  ok   $1"
    else
        echo "  FAIL $1 (expected '$2', got '$3')"
        FAILURES=$((FAILURES + 1))
    fi
}

echo "gate_run.sh contract:"

payload pass-gate 'true'
run pass-gate
check "passing gate exits 0" 0 "${RC}"

payload fail-gate 'exit 1'
run fail-gate
check "failing gate exits 1" 1 "${RC}"

payload missing-cmd 'definitely-not-a-real-command-xyz'
run missing-cmd
check "unrunnable gate exits 3 (not 0, not 1)" 3 "${RC}"
case "${OUT}" in
    *"GATE COULD NOT RUN"*) echo "  ok   unrunnable gate announces itself on stdout" ;;
    *) echo "  FAIL unrunnable gate is silent on stdout"; FAILURES=$((FAILURES + 1)) ;;
esac

# The regression this task exists for: pnpm lives behind a $HOME shim, and the
# hardened PATH used to drop it — so every `pnpm …` gate exited 127 unrun.
payload pkg-manager 'command -v pnpm'
run pkg-manager
check "package manager reachable in hardened env" 0 "${RC}"

printf '# prose-only\n\n## Acceptance gate\n\nJust judgment, no block.\n' \
    >"${WORK}/claude-arsenal/queue/prose-only.md"
run prose-only
check "prose-only gate exits 0" 0 "${RC}"

run no-such-task
check "payload missing everywhere exits 2" 2 "${RC}"

# Payload on the coordination branch but not on disk: must be found there, and
# must NOT be materialized into the working tree (open_task_pr.sh does add -A).
QUEUE_BRANCH="${ARSENAL_QUEUE_BRANCH:-arsenal-queue}"
PROBE_ID="lo-19c0"
if git -C "${REPO_ROOT}" cat-file -e \
    "${QUEUE_BRANCH}:claude-arsenal/queue/${PROBE_ID}.md" 2>/dev/null; then
    if [[ -f "${REPO_ROOT}/claude-arsenal/queue/${PROBE_ID}.md" ]]; then
        echo "  skip coordination-ref fallback (payload is on disk here)"
    else
        (cd "${REPO_ROOT}" && bash "${GATE_RUN}" "${PROBE_ID}" >/dev/null 2>&1)
        check "payload read from ${QUEUE_BRANCH} when absent on disk" 0 "$?"
        if [[ -e "${REPO_ROOT}/claude-arsenal/queue/${PROBE_ID}.md" ]]; then
            echo "  FAIL fallback wrote the payload into the repo tree"
            FAILURES=$((FAILURES + 1))
        else
            echo "  ok   fallback left the repo tree clean"
        fi
    fi
else
    echo "  skip coordination-ref fallback (${QUEUE_BRANCH} not available)"
fi

if [[ "${FAILURES}" -ne 0 ]]; then
    echo "${FAILURES} check(s) failed"
    exit 1
fi
echo "all checks passed"
