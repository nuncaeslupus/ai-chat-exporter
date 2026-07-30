#!/usr/bin/env bash
# Self-checking test for the release-side acceptance-gate guard in
# claude-arsenal/bin/release.sh (D-16).
#
# The repo has no shell-test framework (vitest only covers .ts), so this is a
# plain assert script, same style as tests/gate_run_test.sh:
# `bash tests/release_gate_test.sh`, exit 0 = all pass.
#
# What it pins down — `release.sh <id> done` never records `done` having
# silently skipped the gate:
#   - payload on disk → the gate runs; passing records done, failing refuses
#   - payload only on arsenal-queue → resolved via gate_run.sh and run. This is
#     the D-16 regression: the orchestrator's tree sits on the default branch,
#     where a payload seeded during the session does not exist, and the old
#     `-f <payload>` precondition skipped the whole gate block there
#   - a gate that CANNOT run (127) → refused, and its message stays
#     distinguishable from a gate that ran and failed
#   - no payload anywhere → allowed (nothing to enforce), but announced loudly
#     on stdout: silence is the bug, not permissiveness

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE="${REPO_ROOT}/claude-arsenal/bin/release.sh"
WORK="$(mktemp -d -t release-gate-test-XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

FAILURES=0

check() { # check <label> <expected> <actual>
    if [[ "$2" == "$3" ]]; then
        echo "  ok   $1"
    else
        echo "  FAIL $1 (expected '$2', got '$3')"
        FAILURES=$((FAILURES + 1))
    fi
}

contains() { # contains <label> <needle> <haystack>
    if [[ "$3" == *"$2"* ]]; then
        echo "  ok   $1"
    else
        echo "  FAIL $1 (no '$2' in output)"
        FAILURES=$((FAILURES + 1))
    fi
}

lacks() { # lacks <label> <needle> <haystack>
    if [[ "$3" != *"$2"* ]]; then
        echo "  ok   $1"
    else
        echo "  FAIL $1 (unexpected '$2' in output)"
        FAILURES=$((FAILURES + 1))
    fi
}

# --- scratch repo -----------------------------------------------------------
# Mirrors the real topology: the caller's tree on the default branch, a
# coordination worktree on arsenal-queue (ARSENAL_QUEUE_DIR), and a bare remote
# for release.sh to push the ledger commit to.
REPO="${WORK}/repo"
QWT="${WORK}/qwt"

git init -q --bare "${WORK}/remote.git"
git init -q -b main "${REPO}"
git -C "${REPO}" config user.email "test@example.com"
git -C "${REPO}" config user.name "release-gate-test"
git -C "${REPO}" config commit.gpgsign false
git -C "${REPO}" remote add origin "${WORK}/remote.git"

mkdir -p "${REPO}/claude-arsenal/queue"

# payload <dir> <task_id> <gate-command>
payload() {
    printf '# %s\n\n## Acceptance gate\n\n```bash\n%s\n```\n' "$2" "$3" \
        >"$1/claude-arsenal/queue/$2.md"
}

# On the default branch (and therefore inherited by arsenal-queue).
payload "${REPO}" t-pass-disk 'true'
payload "${REPO}" t-fail-disk 'exit 1'
payload "${REPO}" t-cannotrun 'definitely-not-a-real-command-xyz'
git -C "${REPO}" add -A
git -C "${REPO}" commit -qm "seed default branch"

# On arsenal-queue only: the ledger plus two payloads the default branch lacks.
git -C "${REPO}" checkout -q -b arsenal-queue
payload "${REPO}" t-pass-ref 'true'
payload "${REPO}" t-fail-ref 'exit 1'
for id in t-pass-disk t-fail-disk t-cannotrun t-pass-ref t-fail-ref t-nogate; do
    printf '{"id":"%s","title":"%s","status":"in_progress","payload":"%s.md"}\n' \
        "${id}" "${id}" "${id}" >>"${REPO}/claude-arsenal/queue/tasks.jsonl"
done
git -C "${REPO}" add -A
git -C "${REPO}" commit -qm "seed coordination branch"
git -C "${REPO}" push -q origin arsenal-queue
git -C "${REPO}" checkout -q main
git -C "${REPO}" worktree add -q "${QWT}" arsenal-queue

# --- helpers ----------------------------------------------------------------
# --pr is deliberately a non-http stub: it satisfies the CA-11 "must have a PR"
# guard while skipping CA-13's `gh pr view` lookup, which would need the
# network. Those guards have their own semantics; this file tests the gate.
release() { # release <task_id> -> RC, OUT (stdout), ERR (stderr)
    OUT="$(cd "${REPO}" && ARSENAL_QUEUE_DIR="${QWT}" \
        bash "${RELEASE}" "$1" done --pr pr-stub 2>"${WORK}/err")"
    RC=$?
    ERR="$(cat "${WORK}/err")"
}

status_of() { # status_of <task_id> -> status recorded in the ledger
    python3 - "${QWT}/claude-arsenal/queue/tasks.jsonl" "$1" <<'PY'
import json, sys
for line in open(sys.argv[1], encoding="utf-8"):
    line = line.strip()
    if line and json.loads(line).get("id") == sys.argv[2]:
        print(json.loads(line)["status"])
        break
PY
}

echo "release.sh done gate enforcement:"

# 1. Payload on disk, gate passes → recorded.
release t-pass-disk
check "payload on disk + passing gate exits 0" 0 "${RC}"
check "payload on disk + passing gate records done" "done" "$(status_of t-pass-disk)"

# 2. Payload on disk, gate fails → refused, ledger untouched.
release t-fail-disk
check "payload on disk + failing gate refuses done" 2 "${RC}"
check "payload on disk + failing gate leaves status alone" \
    "in_progress" "$(status_of t-fail-disk)"

# 3. Payload only on arsenal-queue, gate passes → resolved, run, recorded.
release t-pass-ref
check "payload only on arsenal-queue + passing gate exits 0" 0 "${RC}"
check "payload only on arsenal-queue + passing gate records done" \
    "done" "$(status_of t-pass-ref)"

# 4. The D-16 regression: payload only on arsenal-queue and its gate FAILS.
#    Before the fix this recorded `done` with no gate run at all.
release t-fail-ref
check "payload only on arsenal-queue + failing gate refuses done" 2 "${RC}"
check "payload only on arsenal-queue + failing gate leaves status alone" \
    "in_progress" "$(status_of t-fail-ref)"

# 5. A gate that could not run is refused, and says so as "could not run" —
#    never conflated with a gate that ran and returned a verdict.
release t-cannotrun
check "unrunnable gate refuses done" 2 "${RC}"
check "unrunnable gate leaves status alone" "in_progress" "$(status_of t-cannotrun)"
contains "unrunnable gate is reported as COULD NOT RUN" "COULD NOT RUN" "${ERR}"
lacks "unrunnable gate is not reported as a gate failure" \
    "acceptance gate failed" "${ERR}"

# 6. No payload anywhere → no declared gate to enforce; allowed, but loudly.
release t-nogate
check "no payload anywhere exits 0" 0 "${RC}"
check "no payload anywhere records done" "done" "$(status_of t-nogate)"
contains "no payload anywhere announces the skipped gate on stdout" \
    "NO ACCEPTANCE GATE RUN" "${OUT}"

if [[ "${FAILURES}" -ne 0 ]]; then
    echo "${FAILURES} check(s) failed"
    exit 1
fi
echo "all checks passed"
