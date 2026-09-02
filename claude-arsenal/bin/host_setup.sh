#!/usr/bin/env bash
# host_setup.sh — run the host repo's install/bootstrap command in this tree.
#
# `isolation: worktree` gives every worker a clean checkout, and a checkout
# carries tracked files only: no `node_modules/`, no `.venv/`, nothing an
# install step produces. So the first gate a worker runs dies on a missing tool
# that has nothing to do with the change under test, and the worker spends a
# full gate run — 10-12 minutes in the fan-out that prompted this — diagnosing a
# fact that is invariant for the repo. Measured once at nine workers: five of
# them rediscovered it independently.
#
# The command comes from `host-setup` in arsenal/config.toml, the sibling of
# `host-gate`, so the repo says `npm ci && uv sync` once in the place the rest
# of its gate configuration already lives instead of every worker inferring it.
# Empty by default: a repo that declares nothing is unaffected and this is a
# no-op.
#
# It also reverts what the install writes into TRACKED files — the
# `package-lock.json` churn an `npm install` produces, a re-pinned `uv.lock`.
# Two of those nine workers committed that churn into their task PR, because
# nothing told them not to. The diff has to stay the task's, and asking every
# worker to remember an extra `git checkout --` is how it stops happening.
#
# The contract is on the install's writes, not on a set of paths: whatever the
# install wrote into a tracked file is undone, and whatever the caller had
# already written is still there afterwards — including in the case where those
# are the same file, which is the one where getting it wrong loses work.
#
# SECURITY: host-setup runs verbatim, like host-gate and like a payload's gate
# block. It comes from arsenal/config.toml, which is host-owned and reviewed
# like any other file in the repo — but it is code, not data.
#
# Exit: 0 the command ran and succeeded, or no host-setup is declared
#       1 the command failed — the tree is not set up, and a gate failure after
#         this one may still be environmental. The revert below still runs: a
#         half-finished install is exactly when the tree needs putting back.
#       2 setup error: not a git repository, or config.toml could not be read
#         (a malformed config must not read as "no setup declared")

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_SCRIPTS="${SCRIPT_DIR}/../scripts"
ARSENAL_HOME="${ARSENAL_HOME:-arsenal}"

_repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${_repo_root}" ]]; then
    echo "host_setup: not inside a git repository — cannot resolve the tree to set up" >&2
    exit 2
fi

if [[ ! -f "${BUNDLE_SCRIPTS}/arsenal_config.py" ]]; then
    echo "host_setup: ${BUNDLE_SCRIPTS}/arsenal_config.py is missing — cannot read host-setup" >&2
    exit 2
fi

# Anchored to the git root, the way open_task_pr.sh anchors the host gate: this
# is routinely invoked from a subdirectory, and a command written as `make
# bootstrap` has to run where the Makefile is.
if ! host_setup="$(python3 "${BUNDLE_SCRIPTS}/arsenal_config.py" \
        --repo-root "${_repo_root}" --get host-setup 2>&1)"; then
    echo "host_setup: could not read host-setup from ${_repo_root}/${ARSENAL_HOME}/config.toml: ${host_setup}" >&2
    exit 2
fi

if [[ -z "${host_setup}" ]]; then
    echo "host_setup: no host-setup declared in ${ARSENAL_HOME}/config.toml — nothing to install."
    echo "host_setup: if a gate then fails on a missing tool or a missing directory, that is this repo's install step going unnamed; declare it there rather than running it by hand each time." >&2
    exit 0
fi

_dirty_tracked() {
    # Unstaged modifications to tracked files, sorted for `comm`. Untracked
    # output (node_modules/, .venv/) is deliberately out of scope: it is what
    # the install is FOR, and .gitignore is the host's business.
    (cd "${_repo_root}" && git diff --name-only 2>/dev/null | LC_ALL=C sort)
}

_before="$(_dirty_tracked)"

# The path set is not enough on its own. A file that was ALREADY dirty and that
# the install then rewrites is in both the before and the after set, so it falls
# out of the churn diff below — and what survives into the commit is the
# install's version, with the worker's edit gone. That is both failures at once:
# the churn the script exists to strip, and the work it exists to protect. So
# the content of every already-dirty file is snapshotted here, into the object
# database (no temp dir, no path quoting, and `git gc` cleans up after us), and
# put back afterwards if the install moved it.
_snapshot=""
while IFS= read -r _path; do
    [[ -n "${_path}" ]] || continue
    if [[ -e "${_repo_root}/${_path}" ]]; then
        _blob="$(cd "${_repo_root}" && git hash-object -w -- "${_path}" 2>/dev/null || true)"
        [[ -n "${_blob}" ]] || continue
    else
        # Dirty because the worker DELETED it. Absent is the state to restore.
        _blob="ABSENT"
    fi
    _snapshot="${_snapshot}${_blob} ${_path}"$'\n'
done <<EOF
${_before}
EOF

echo "host_setup: running the host setup command in ${_repo_root}: ${host_setup}" >&2
# The status is recorded here and acted on at the very end, because both cleanup
# blocks below have to run whether the install succeeded or not — and a failing
# install is the case where they matter MOST. `npm ci` can rewrite the lockfile
# and then die on a resolution error; a post-install script can exit non-zero
# after writing. An early exit here took the snapshot above and never read it,
# so the caller's overwritten edit survived only as an unreferenced blob in the
# object database, on the one path where the install is least trustworthy.
_setup_status=0
(cd "${_repo_root}" && bash -c "${host_setup}") >&2 || _setup_status=$?

_after="$(_dirty_tracked)"
_churn="$(comm -13 <(printf '%s\n' "${_before}") <(printf '%s\n' "${_after}") | grep -v '^$' || true)"

if [[ -n "${_churn}" ]]; then
    # `--` and one path per call: a lockfile named `-foo` or containing a space
    # is still a path, and this runs unattended.
    printf '%s\n' "${_churn}" | while IFS= read -r path; do
        [[ -n "${path}" ]] || continue
        (cd "${_repo_root}" && git checkout -- "${path}") \
            || echo "host_setup: could not revert ${path} — remove it from your commit by hand" >&2
    done
    echo "host_setup: reverted the tracked files the install rewrote, so the task diff stays the task's:" >&2
    printf '%s\n' "${_churn}" | sed 's/^/  /' >&2
fi

# The other half: files that were already dirty and that the install rewrote
# anyway. `git checkout --` is wrong for these — it would restore the index and
# throw the worker's edit away, which is the thing being protected — so they are
# restored from the snapshot taken above.
_restored=""
while IFS= read -r _line; do
    [[ -n "${_line}" ]] || continue
    _blob="${_line%% *}"
    _path="${_line#* }"
    if [[ "${_blob}" == "ABSENT" ]]; then
        if [[ -e "${_repo_root}/${_path}" ]]; then
            rm -f "${_repo_root}/${_path}" \
                && _restored="${_restored}${_path}"$'\n'
        fi
        continue
    fi
    _now="$(cd "${_repo_root}" && git hash-object -- "${_path}" 2>/dev/null || true)"
    [[ "${_now}" == "${_blob}" ]] && continue
    mkdir -p "$(dirname "${_repo_root}/${_path}")"
    if (cd "${_repo_root}" && git cat-file -p "${_blob}" > "${_path}"); then
        _restored="${_restored}${_path}"$'\n'
    else
        echo "host_setup: the install rewrote ${_path}, which you had already edited, and it could NOT be put back (blob ${_blob}) — check that file before committing" >&2
    fi
done <<EOF
${_snapshot}
EOF

if [[ -n "${_restored}" ]]; then
    echo "host_setup: the install also rewrote files you had already edited; your versions are back:" >&2
    printf '%s' "${_restored}" | sed 's/^/  /' >&2
fi

if (( _setup_status != 0 )); then
    # Exit 1 for any command failure, not the command's own status: the contract
    # a worker is given separates "the install failed" (1) from "this script
    # could not run at all" (2), and a `npm ci` that happens to exit 2 must not
    # read as a missing config.toml. The real status is in the message instead.
    echo "host_setup: the host setup command failed (exit ${_setup_status}: ${host_setup}). Do not treat a later gate failure as a verdict on your change until this succeeds." >&2
    exit 1
fi

echo "host_setup: ok"
exit 0
