#!/usr/bin/env bash
# rebase_stack.sh [--no-push] <branch> <old-base>
# Rebase a stacked branch onto the current origin/main after its parent PR
# has been squash-merged. Replays only the commits between <old-base>
# (exclusive) and <branch> (inclusive) — skipping the already-merged parent
# commits — then force-pushes with lease.
#
# Usage (after fix/iss-A merges into main):
#   bin/rebase_stack.sh fix/iss-B fix/iss-A
#
# <branch>   — the stacked branch to rebase (defaults to current branch)
# <old-base> — the tip of the parent branch at the time <branch> was cut
#              (a branch name, tag, or commit SHA)
# --no-push  — rebase only; skip the pre-push gate and the force-push
#
# Evidence conflicts resolve themselves. A repo that uses evidence gates
# commits a measurement of its own tree (`evidence:` in a task's gate block),
# so every branch touches those files and every replay onto a moved base
# conflicts on them. Hand-merging two of them is meaningless — the right answer
# is neither side, it is whatever the code measures on the resulting tree. So
# when the conflicted set is a SUBSET of the declared evidence paths, this takes
# the branch's side, re-runs the host gate to regenerate, and continues.
# Anything outside that set stops the rebase and is reported: that is a real
# conflict and a human's to resolve. The subset test is what makes the
# auto-resolve safe to run without thinking about it.

set -euo pipefail

NO_PUSH=0
args=()
for a in "$@"; do
    case "${a}" in
        --no-push) NO_PUSH=1 ;;
        *) args+=("${a}") ;;
    esac
done
set -- "${args[@]+"${args[@]}"}"

# Resolve the bundle BEFORE the cd below: `BASH_SOURCE[0]` is the path as
# invoked, so a relative one (`bin/rebase_stack.sh` from anywhere but the repo
# root) stops resolving the moment the working directory moves. That failed
# silently — `BUNDLE_SCRIPTS` pointed nowhere, the guarded `gate_evidence.py`
# lookup was skipped, and every conflict then read as "outside the declared
# evidence set": the pre-evidence refusal, wearing the same message.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_SCRIPTS="${SCRIPT_DIR}/../scripts"

# Run from the repo root so `git diff --name-only` and the declared evidence
# paths are in the same frame of reference (both repo-root-relative), and so
# ARSENAL_HOME resolves the way every other script resolves it.
# Checked, not assumed: outside a repository `git rev-parse` fails and prints
# nothing, `cd ""` succeeds by staying put, and everything below would then run
# against whatever directory the caller happened to be in.
_toplevel="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${_toplevel}" ]]; then
    echo "rebase_stack: not inside a git repository — refusing to run" >&2
    exit 2
fi
cd "${_toplevel}"

ARSENAL_HOME="${ARSENAL_HOME:-arsenal}"

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
OLD_BASE="${2:?rebase_stack.sh requires <old-base> (tip of the parent branch)}"
REMOTE="${ARSENAL_QUEUE_REMOTE:-origin}"

# The host's own aggregate gate. Regenerating evidence is part of what it runs,
# which is why it is also what resolves an evidence conflict. Absent by default,
# so a repo without one is unaffected — it just gets the diagnosis instead of
# the auto-resolve.
host_gate=""
if [[ -f "${BUNDLE_SCRIPTS}/arsenal_config.py" ]]; then
    # Errors are NOT swallowed into the empty default — the same policy
    # open_task_pr.sh states for this identical call. `2>/dev/null || true`
    # turned a malformed config.toml, or a missing python3, into
    # `host_gate=""`, and an empty host gate is a no-op: the pre-push check
    # silently stopped running, which reads as protection while granting none.
    if ! host_gate="$(python3 "${BUNDLE_SCRIPTS}/arsenal_config.py" \
            --repo-root "$(pwd)" --get host-gate 2>&1)"; then
        echo "rebase_stack: could not read host-gate from ${ARSENAL_HOME}/config.toml: ${host_gate}" >&2
        echo "rebase_stack: refusing rather than treating an unreadable config as 'no gate declared'." >&2
        exit 2
    fi
fi

# SECURITY: host-gate runs verbatim, like a payload's gate block. It comes from
# arsenal/config.toml, which is host-owned and reviewed like any other file in
# the repo — but it is code, not data.
run_host_gate() {
    [[ -n "${host_gate}" ]] || return 0
    echo "rebase_stack: running host gate: ${host_gate}" >&2
    bash -c "${host_gate}" >&2
}

evidence_paths=""
if [[ -f "${BUNDLE_SCRIPTS}/gate_evidence.py" ]]; then
    evidence_paths="$(python3 "${BUNDLE_SCRIPTS}/gate_evidence.py" \
        --list-only "${ARSENAL_HOME}/tasks" 2>/dev/null || true)"
fi

# A repo that declares a host gate but resolves no evidence paths gets the
# refusal path for every conflict. Legitimate when no task declares `evidence:`,
# a symptom when something upstream broke — say which rather than letting the
# degraded case look like normal operation.
if [[ -z "${evidence_paths}" && -n "${host_gate}" ]]; then
    echo "rebase_stack: a host gate is declared but no evidence paths resolved from ${ARSENAL_HOME}/tasks — conflicts will not auto-resolve" >&2
fi

is_evidence() {
    [[ -n "${evidence_paths}" ]] && grep -qxF -- "$1" <<<"${evidence_paths}"
}

conflicted() { git diff --name-only --diff-filter=U; }

# Explain, then leave the rebase in progress: the tree is the reader's to
# resolve and `git rebase --abort` is theirs to decide on.
stop_here() {
    echo "rebase_stack: $1" >&2
    echo "rebase_stack: the rebase is still in progress — resolve and 'git rebase --continue', or 'git rebase --abort'" >&2
    exit 1
}

resolve_evidence_conflicts() {
    local files f outside
    files="$(conflicted)"
    [[ -n "${files}" ]] || stop_here "the rebase stopped with no conflicted files — read the message above"

    outside=""
    while IFS= read -r f; do
        is_evidence "${f}" || outside+="  ${f}"$'\n'
    done <<<"${files}"

    if [[ -n "${outside}" ]]; then
        echo "rebase_stack: conflicts outside the declared evidence set:" >&2
        printf '%s' "${outside}" >&2
        stop_here "a real conflict — nothing was auto-resolved"
    fi

    if [[ -z "${host_gate}" ]]; then
        echo "rebase_stack: every conflicted file is a declared evidence path — a build product:" >&2
        sed 's/^/  /' <<<"${files}" >&2
        stop_here "do not hand-merge these; regenerate them instead. Declare the command as 'host-gate' in ${ARSENAL_HOME}/config.toml and this resolves itself"
    fi

    echo "rebase_stack: evidence-only conflict; regenerating rather than merging:" >&2
    sed 's/^/  /' <<<"${files}" >&2
    while IFS= read -r f; do
        # --theirs is the commit being replayed (the branch's own work). Either
        # side would do — the gate is about to overwrite it — but a file the
        # gate does not in fact rewrite is then the branch's, not the base's.
        #
        # It fails when the path has no "theirs" at all — the branch deleted a
        # file the base modified. Swallowing that left the base's copy in the
        # tree and staged it below, resurrecting a file the branch removed. It
        # is not a resolution the script can make on its own, so it stops.
        git checkout --theirs -- "${f}" \
            || stop_here "cannot take the branch's side of ${f} — not a content conflict (deleted on one side?), so regenerating cannot resolve it"
    done <<<"${files}"
    run_host_gate || stop_here "the host gate failed while regenerating evidence"
    # Every declared evidence path, not only the conflicted ones: the gate
    # measures the whole tree, so it can rewrite a file that merged cleanly —
    # and an unstaged change to a tracked file blocks `rebase --continue`.
    stage_evidence
    while IFS= read -r f; do
        git add -A -- "${f}"
    done <<<"${files}"
}

# The declared evidence paths as an argv array — a path may contain spaces.
evidence_argv() {
    local f
    ev_argv=()
    [[ -n "${evidence_paths}" ]] || return 0
    while IFS= read -r f; do ev_argv+=("${f}"); done <<<"${evidence_paths}"
}

stage_evidence() {
    local f
    evidence_argv
    for f in ${ev_argv[@]+"${ev_argv[@]}"}; do
        [[ -e "${f}" ]] && git add -- "${f}"
    done
    return 0
}

# Declared evidence paths that differ from what HEAD committed — staged or not.
dirty_evidence() {
    evidence_argv
    (( ${#ev_argv[@]} )) || return 0
    git diff HEAD --name-only -- "${ev_argv[@]}"
}

default_branch="$(git ls-remote --symref "${REMOTE}" HEAD 2>/dev/null \
    | sed -n 's|^ref:[[:space:]]*refs/heads/\([^[:space:]]*\).*|\1|p')"
[[ -z "${default_branch}" ]] && default_branch="main"
git fetch "${REMOTE}" "${default_branch}" >/dev/null 2>&1

fork="$(git merge-base "${BRANCH}" "${OLD_BASE}")"
echo "rebase_stack: replaying ${BRANCH} commits after ${fork:0:12} onto ${REMOTE}/${default_branch}"

if ! git rebase --onto "${REMOTE}/${default_branch}" "${fork}" "${BRANCH}"; then
    # One pass per conflicting commit. The bound is a backstop, not a budget:
    # a stack deeper than this is not what went wrong.
    for _ in $(seq 1 50); do
        resolve_evidence_conflicts
        if GIT_EDITOR=true git rebase --continue; then
            break
        fi
    done
    if [[ -d "$(git rev-parse --git-path rebase-merge)" || -d "$(git rev-parse --git-path rebase-apply)" ]]; then
        stop_here "still rebasing after 50 conflict passes — stopping rather than looping"
    fi
fi

if (( NO_PUSH )); then
    echo "rebase_stack: ${BRANCH} rebased; --no-push, so nothing was pushed"
    exit 0
fi

# Before publishing, not after. A rebase can succeed and still leave committed
# evidence that no longer describes the tree it now sits on; pushing that
# publishes a head that fails the host's own gate.
run_host_gate || {
    echo "rebase_stack: host gate failed after the rebase — NOT pushing ${BRANCH}" >&2
    echo "rebase_stack: fix it, commit, and push yourself (or re-run with --no-push to skip this)" >&2
    exit 1
}

# A rebase that never conflicted can still move the inputs a measurement is
# taken over, leaving committed evidence that describes the pre-rebase tree.
# The gate just regenerated it; if that differs, what is committed is stale and
# pushing it publishes a head the repo's own gate would reject. Not committed
# here — an extra commit on a stacked branch is the caller's call, not this
# script's.
stale="$(dirty_evidence)"
if [[ -n "${stale}" ]]; then
    echo "rebase_stack: regenerated evidence differs from what ${BRANCH} committed:" >&2
    sed 's/^/  /' <<<"${stale}" >&2
    echo "rebase_stack: commit it and re-run — NOT pushing a head whose evidence describes the old tree" >&2
    exit 1
fi

git push --force-with-lease "${REMOTE}" "${BRANCH}"
echo "rebase_stack: ${BRANCH} rebased and pushed"
