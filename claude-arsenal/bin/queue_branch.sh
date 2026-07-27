#!/usr/bin/env bash
# queue_branch.sh
# Ensures the queue-coordination worktree exists and is up to date, then
# echoes its path to stdout so callers can capture it:
#
#   export ARSENAL_QUEUE_DIR="$(claude-arsenal/bin/queue_branch.sh)"
#
# The coordination branch (default: arsenal-queue) lives in a SIDE git
# worktree — the main working tree NEVER changes branch. This means web
# servers, editors, and other consumers of the repo always see the host
# default-branch content regardless of what the queue is doing.
#
# claim.sh and release.sh honour ARSENAL_QUEUE_DIR: when set, they cd into
# the worktree so the push-CAS lock works without touching the main HEAD.
#
# Idempotent: safe to run at every session start and between loop iterations.
#
# Transition: if the main tree is currently on ARSENAL_QUEUE_BRANCH (leftover
# from a legacy session that used the old branch-switch behaviour), this script
# automatically switches it back to ARSENAL_DEFAULT_BRANCH.
#
# Falls back to the legacy branch-switch behaviour when git worktrees are
# unavailable (very old git or bare repo). In that mode nothing is echoed and
# claim/release run from the main tree as before.
#
# In worktree mode, once the main tree's branch has settled, its name is
# persisted to `${ARSENAL_SESSION_DIR:-claude-arsenal/session}/host_branch` so
# worker_postcheck.sh can confirm the main tree's HEAD hasn't moved without
# assuming it is `main` (see #128 — a web session's designated branch is
# usually its own feature branch, not the repo's trunk).
#
# Project identity guard: ARSENAL_QUEUE_BRANCH is a generic literal name
# (`arsenal-queue` by default) with no built-in tie to a specific project. If
# it is ever fetched from the wrong remote — a stale `origin` left over from a
# template/fork, a copy-pasted ARSENAL_QUEUE_REMOTE, or two unrelated projects
# that end up sharing a remote — another project's tasks can silently land in
# this session's queue. This script stamps a `.project-id` file (the
# normalized remote URL) on the coordination branch the first time it creates
# it, and on every subsequent run refuses to proceed (exit 1) if the fetched
# branch's stamp doesn't match this repo's own remote, rather than mixing
# queues.
#
# Branch name:  ARSENAL_QUEUE_BRANCH   (default: arsenal-queue)
# Remote:       ARSENAL_QUEUE_REMOTE   (default: origin)
# Default br:   ARSENAL_DEFAULT_BRANCH (default: the remote's HEAD branch, else `main`)
# Worktree dir: ARSENAL_QUEUE_WORKTREE (default: <repo-root>/../<repo-name>-arsenal-queue-wt)
#
# Exit: 0 on success, 1 on hard failure.

set -uo pipefail

QUEUE_BRANCH="${ARSENAL_QUEUE_BRANCH:-arsenal-queue}"
REMOTE="${ARSENAL_QUEUE_REMOTE:-origin}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
REPO_NAME="$(basename "${REPO_ROOT}")"
QUEUE_WORKTREE="${ARSENAL_QUEUE_WORKTREE:-${REPO_ROOT}/../${REPO_NAME}-arsenal-queue-wt}"

has_remote=0
git remote get-url "${REMOTE}" >/dev/null 2>&1 && has_remote=1

# Auto-detect the repo's actual trunk branch from the remote's HEAD (set by
# `git clone` / `git remote set-head`) instead of assuming it is literally
# `main` — repos whose trunk is `master` or something else would otherwise
# have DEFAULT_BRANCH silently point at a branch that doesn't exist. Only
# falls back to the literal string `main` when detection is unavailable.
DEFAULT_BRANCH="${ARSENAL_DEFAULT_BRANCH:-}"
if [[ -z "${DEFAULT_BRANCH}" && ${has_remote} -eq 1 ]]; then
    DEFAULT_BRANCH="$(git symbolic-ref --short "refs/remotes/${REMOTE}/HEAD" 2>/dev/null | sed "s#^${REMOTE}/##")"
fi
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"

# ---------------------------------------------------------------------------
# Project identity: a normalized form of the remote URL, used to stamp and
# verify the coordination branch belongs to THIS repo (see header comment).
# Strips protocol/user prefixes and the `.git` suffix so the same remote
# compares equal regardless of https/ssh form. Empty when there is no remote
# — a fully local repo cannot fetch another project's branch, so there is
# nothing to guard against.
# ---------------------------------------------------------------------------
_normalize_remote_id() {
    local url="$1"
    url="${url#https://}"; url="${url#http://}"; url="${url#ssh://git@}"; url="${url#git@}"
    url="${url/://}"
    url="${url%.git}"
    printf '%s' "${url}"
}
PROJECT_ID=""
[[ ${has_remote} -eq 1 ]] && PROJECT_ID="$(_normalize_remote_id "$(git remote get-url "${REMOTE}" 2>/dev/null || true)")"

# ---------------------------------------------------------------------------
# _verify_or_stamp_project_id: called once the coordination branch is checked
# out at $1 (a worktree path, or "." in legacy in-place mode). If a
# `.project-id` marker already exists on the branch, it must match this
# repo's PROJECT_ID or we refuse to proceed — that mismatch is exactly a
# foreign project's queue landing here. If no marker exists yet (a brand-new
# branch, or one that predates this guard), stamp it now so future runs, from
# any clone, can detect a mismatch immediately.
# ---------------------------------------------------------------------------
_verify_or_stamp_project_id() {
    local wt="$1"
    [[ -z "${PROJECT_ID}" ]] && return 0
    local marker="${wt}/claude-arsenal/queue/.project-id"
    if [[ -f "${marker}" ]]; then
        local recorded
        recorded="$(cat "${marker}" 2>/dev/null || true)"
        if [[ -n "${recorded}" && "${recorded}" != "${PROJECT_ID}" ]]; then
            echo "queue_branch.sh: ERROR — '${QUEUE_BRANCH}' on '${REMOTE}' is stamped for a different project ('${recorded}'), not this repo ('${PROJECT_ID}'). Refusing to use it to avoid mixing queues — check ARSENAL_QUEUE_REMOTE/origin, or set a distinct ARSENAL_QUEUE_BRANCH for this project." >&2
            return 1
        fi
        return 0
    fi
    mkdir -p "$(dirname "${marker}")" 2>/dev/null || return 0
    printf '%s\n' "${PROJECT_ID}" > "${marker}" 2>/dev/null || return 0
    git -C "${wt}" add "claude-arsenal/queue/.project-id" >/dev/null 2>&1 || return 0
    if ! git -C "${wt}" diff --cached --quiet -- claude-arsenal/queue/.project-id 2>/dev/null; then
        git -C "${wt}" commit -q -m "chore(queue): stamp project identity" >/dev/null 2>&1 || true
        [[ ${has_remote} -eq 1 ]] && git -C "${wt}" push "${REMOTE}" "HEAD:refs/heads/${QUEUE_BRANCH}" >/dev/null 2>&1 || true
    fi
    return 0
}

# ---------------------------------------------------------------------------
# sync_worktree: fast-forward the coordination worktree to the latest
# origin/<queue-branch> so claim/release commits pushed by OTHER sessions are
# pulled in. The queue branch is an append-only ledger that is never merged
# into mainline — so we do NOT merge the default branch into it (that would
# fork the ledger and, on hosts that empty the main-tree tasks.jsonl seed,
# conflicts on every session). A non-FF result means this worktree carries
# un-pushed claim/release commits — the legitimate optimistic-lock path; leave
# that to release.sh's existing rebase rather than forcing it here.
# ---------------------------------------------------------------------------
sync_worktree() {
    local wt="$1"
    [[ ${has_remote} -eq 0 ]] && return 0
    git -C "${wt}" fetch "${REMOTE}" "${QUEUE_BRANCH}" >/dev/null 2>&1 || return 0
    git -C "${wt}" merge --ff-only "${REMOTE}/${QUEUE_BRANCH}" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# legacy_sync: fast-forward the current (queue) branch to origin/<queue-branch>
# so it picks up claim/release commits from other sessions (only used when
# worktrees are unavailable). FF-only — never merges the default branch into
# the append-only ledger; a non-FF result is the optimistic-lock path left to
# release.sh.
# ---------------------------------------------------------------------------
legacy_sync() {
    [[ ${has_remote} -eq 0 ]] && return 0
    git fetch "${REMOTE}" "${QUEUE_BRANCH}" >/dev/null 2>&1 || return 0
    git rev-parse --verify --quiet "${REMOTE}/${QUEUE_BRANCH}" >/dev/null 2>&1 || return 0
    git merge --ff-only "${REMOTE}/${QUEUE_BRANCH}" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# find_branch_worktree: path of the worktree (if any) that already has
# QUEUE_BRANCH checked out, per `git worktree list`. Git refuses a second
# worktree for the same branch ("'<branch>' is already used by worktree at
# '<path>'"), so callers must discover and reuse that path rather than
# hard-failing when it doesn't match the computed default — e.g. a worktree
# left at a legacy, non-namespaced path from before repo-name scoping was
# added (see queue_branch.sh history). Every path `git worktree list` reports
# belongs to THIS repo by construction, so no separate ownership check is
# needed for a path found this way.
# ---------------------------------------------------------------------------
find_branch_worktree() {
    local branch="$1"
    # tr -d '\r': MSYS/Git-Bash porcelain lines end \r\n. Strip before awk
    # rather than inside it — `\r` in an awk regex literal is non-portable
    # (POSIX/BSD awk may read it as a literal backslash-r).
    git worktree list --porcelain 2>/dev/null | tr -d '\r' | awk -v want="refs/heads/${branch}" '
        /^worktree / { path = substr($0, 10) }
        $0 == "branch " want { print path; exit }
    '
}

# ---------------------------------------------------------------------------
# LEGACY FALLBACK — only when `git worktree` is unavailable.
# Preserves the original branch-switch behaviour exactly.
# ---------------------------------------------------------------------------
if ! git worktree list >/dev/null 2>&1; then
    echo "queue_branch.sh: git worktrees unavailable; falling back to legacy branch-switch mode" >&2
    current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if [[ "${current}" == "${QUEUE_BRANCH}" ]]; then
        if [[ ${has_remote} -eq 1 ]] \
            && ! git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
            git fetch "${REMOTE}" "${QUEUE_BRANCH}" >/dev/null 2>&1 || true
            git branch --set-upstream-to="${REMOTE}/${QUEUE_BRANCH}" >/dev/null 2>&1 || true
        fi
        legacy_sync
        _verify_or_stamp_project_id "." || exit 1
        echo "on coordination branch '${QUEUE_BRANCH}' (legacy mode)" >&2
        exit 0
    fi
    if [[ -n "$(git status --porcelain -uno 2>/dev/null)" ]]; then
        echo "queue_branch.sh: tracked files have uncommitted changes; commit or stash before switching to '${QUEUE_BRANCH}'" >&2
        exit 1
    fi
    if [[ ${has_remote} -eq 1 ]] \
        && git ls-remote --exit-code --heads "${REMOTE}" "${QUEUE_BRANCH}" >/dev/null 2>&1; then
        git fetch "${REMOTE}" "${QUEUE_BRANCH}" >/dev/null 2>&1 || true
        if git rev-parse --verify --quiet "${QUEUE_BRANCH}" >/dev/null 2>&1; then
            git checkout "${QUEUE_BRANCH}" >/dev/null 2>&1
            git branch --set-upstream-to="${REMOTE}/${QUEUE_BRANCH}" >/dev/null 2>&1 || true
        else
            git checkout -b "${QUEUE_BRANCH}" --track "${REMOTE}/${QUEUE_BRANCH}" >/dev/null 2>&1
        fi
        legacy_sync
        _verify_or_stamp_project_id "." || exit 1
        echo "tracking existing '${REMOTE}/${QUEUE_BRANCH}' (legacy mode)" >&2
        exit 0
    fi
    if git rev-parse --verify --quiet "${QUEUE_BRANCH}" >/dev/null 2>&1; then
        git checkout "${QUEUE_BRANCH}" >/dev/null 2>&1
    else
        git checkout -b "${QUEUE_BRANCH}" >/dev/null 2>&1
    fi
    if [[ ${has_remote} -eq 1 ]]; then
        if git push -u "${REMOTE}" "${QUEUE_BRANCH}" >/dev/null 2>&1; then
            legacy_sync
            _verify_or_stamp_project_id "." || exit 1
            echo "created and published '${QUEUE_BRANCH}' (legacy mode)" >&2
            exit 0
        fi
        echo "queue_branch.sh: WARNING — could not push '${QUEUE_BRANCH}' to '${REMOTE}'; cross-session locking will not work until it is published" >&2
        legacy_sync
        exit 0
    fi
    echo "queue_branch.sh: WARNING — no '${REMOTE}' remote; '${QUEUE_BRANCH}' is local-only and cannot coordinate across sessions" >&2
    exit 0
fi

# ---------------------------------------------------------------------------
# WORKTREE MODE — main tree stays on its current branch.
# ---------------------------------------------------------------------------

# Transition: if the main tree is on the coordination branch (left by a
# legacy session, or an interrupted worker that ran in-place), switch it back
# to the branch it actually belongs on. That is NOT blindly DEFAULT_BRANCH
# (the repo's trunk) — a Claude Code on the web session is commonly pinned to
# its own designated feature branch, not the trunk (#128). Prefer a branch
# this same script recorded in a PRIOR run of this session (below); only fall
# back to the trunk when nothing was recorded yet (e.g. the very first run).
current_main="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ "${current_main}" == "${QUEUE_BRANCH}" ]]; then
    if [[ -n "$(git status --porcelain -uno 2>/dev/null)" ]]; then
        echo "queue_branch.sh: ERROR — main tree is on '${QUEUE_BRANCH}' with uncommitted changes; cannot auto-switch. Please commit, stash, or discard your changes, then switch the main tree manually." >&2
        exit 1
    fi

    return_branch=""
    _session_dir="${ARSENAL_SESSION_DIR:-claude-arsenal/session}"
    if [[ -f "${_session_dir}/host_branch" ]]; then
        _recorded="$(cat "${_session_dir}/host_branch" 2>/dev/null || true)"
        [[ -n "${_recorded}" && "${_recorded}" != "${QUEUE_BRANCH}" ]] && return_branch="${_recorded}"
    fi
    return_branch="${return_branch:-${DEFAULT_BRANCH}}"

    git checkout "${return_branch}" >/dev/null 2>&1 \
        || { git fetch "${REMOTE}" "${return_branch}" >/dev/null 2>&1 || true; \
             git checkout -b "${return_branch}" "${REMOTE}/${return_branch}" >/dev/null 2>&1; } \
        || { echo "queue_branch.sh: ERROR — could not switch main tree from '${QUEUE_BRANCH}' to '${return_branch}'" >&2; exit 1; }
fi

# Persist the main tree's actual current branch so worker_postcheck.sh (and any
# other post-worker check) can verify the main tree's HEAD didn't move WITHOUT
# assuming it equals the repo's trunk branch. This is deliberately not
# DEFAULT_BRANCH above — that's the repo's trunk (used only as the queue
# branch's fork point). On Claude Code on the web a session is typically
# pinned to its OWN designated branch (e.g. `claude/web-continuation-xxx`),
# never switched here, so DEFAULT_BRANCH's `main` fallback is the wrong thing
# to diff the main tree against post-worker (#128).
host_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ -n "${host_branch}" ]]; then
    session_dir="${ARSENAL_SESSION_DIR:-claude-arsenal/session}"
    mkdir -p "${session_dir}" 2>/dev/null || true
    printf '%s\n' "${host_branch}" > "${session_dir}/host_branch" 2>/dev/null || true
fi

# Ensure the coordination branch exists on the remote; create + push if not.
if [[ ${has_remote} -eq 1 ]]; then
    git fetch "${REMOTE}" "${QUEUE_BRANCH}" >/dev/null 2>&1 || true
    if ! git ls-remote --exit-code --heads "${REMOTE}" "${QUEUE_BRANCH}" >/dev/null 2>&1; then
        # Not on remote — create a local branch off the default branch and push.
        if ! git rev-parse --verify --quiet "${QUEUE_BRANCH}" >/dev/null 2>&1; then
            git branch "${QUEUE_BRANCH}" "${REMOTE}/${DEFAULT_BRANCH}" >/dev/null 2>&1 \
                || git branch "${QUEUE_BRANCH}" "${DEFAULT_BRANCH}" >/dev/null 2>&1 \
                || git branch "${QUEUE_BRANCH}" >/dev/null 2>&1 || true
        fi
        git push -u "${REMOTE}" "${QUEUE_BRANCH}" >/dev/null 2>&1 \
            || echo "queue_branch.sh: WARNING — could not push '${QUEUE_BRANCH}' to '${REMOTE}'; cross-session locking will not work until published" >&2
    fi
fi

# Verify an existing directory at QUEUE_WORKTREE belongs to this clone before
# reusing it. Comparing the common git directory (the physical .git dir) is
# robust against SSH/HTTPS URL mismatches and multiple local clones of the same
# remote — both would pass a remote-URL check yet cannot share a worktree.
if [[ -d "${QUEUE_WORKTREE}" && -e "${QUEUE_WORKTREE}/.git" ]]; then
    this_common_dir="$(cd "${REPO_ROOT}" && cd "$(git rev-parse --git-common-dir)" && pwd)"
    existing_common_dir="$(cd "${QUEUE_WORKTREE}" 2>/dev/null && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd || true)"
    if [[ -n "${existing_common_dir}" && "${existing_common_dir}" != "${this_common_dir}" ]]; then
        echo "queue_branch.sh: ERROR — '${QUEUE_WORKTREE}' belongs to a different repository clone; set ARSENAL_QUEUE_WORKTREE to a different path" >&2
        exit 1
    fi
fi

# Create or reuse the worktree.
# Check by canonical path match in the porcelain listing.
wt_registered=0
# tr -d '\r': MSYS/Git-Bash porcelain lines end \r\n, which would defeat the
# exact-line match (grep -x) and leave the worktree undetected.
if git worktree list --porcelain 2>/dev/null | tr -d '\r' | grep -qxF "worktree ${QUEUE_WORKTREE}"; then
    wt_registered=1
fi

if [[ ${wt_registered} -eq 0 ]]; then
    # Clean up any stale worktree record pointing at this path before adding.
    git worktree prune >/dev/null 2>&1 || true

    # The branch may already be checked out at a DIFFERENT path than the one
    # just computed — most commonly a worktree created before repo-name
    # scoping (#122) landed, sitting at the old shared default
    # `../arsenal-queue-wt`. `git worktree add` would fail outright in that
    # case ("already used by worktree at ..."); detect it first and reuse
    # that worktree instead of hard-failing.
    existing_path="$(find_branch_worktree "${QUEUE_BRANCH}")"
    if [[ -n "${existing_path}" && "${existing_path}" != "${QUEUE_WORKTREE}" ]]; then
        if [[ -e "${existing_path}/.git" ]]; then
            echo "queue_branch.sh: '${QUEUE_BRANCH}' is already checked out at '${existing_path}' (expected '${QUEUE_WORKTREE}'); reusing it instead of creating a second worktree" >&2
            QUEUE_WORKTREE="${existing_path}"
            wt_registered=1
        else
            # Registration is stale (directory removed by hand) — prune and
            # fall through to creating at the computed default path.
            git worktree prune >/dev/null 2>&1 || true
        fi
    fi
fi

if [[ ${wt_registered} -eq 0 ]]; then
    mkdir -p "$(dirname "${QUEUE_WORKTREE}")" 2>/dev/null || true

    if [[ ${has_remote} -eq 1 ]] \
        && git rev-parse --verify --quiet "${REMOTE}/${QUEUE_BRANCH}" >/dev/null 2>&1; then
        if git rev-parse --verify --quiet "${QUEUE_BRANCH}" >/dev/null 2>&1; then
            # Local branch exists; add worktree pointing at it, then wire upstream.
            git worktree add "${QUEUE_WORKTREE}" "${QUEUE_BRANCH}" >/dev/null || true
            git -C "${QUEUE_WORKTREE}" branch --set-upstream-to="${REMOTE}/${QUEUE_BRANCH}" \
                >/dev/null 2>&1 || true
        else
            # Create local branch tracking the remote and add worktree.
            git worktree add -b "${QUEUE_BRANCH}" "${QUEUE_WORKTREE}" \
                "${REMOTE}/${QUEUE_BRANCH}" >/dev/null || true
        fi
    elif git rev-parse --verify --quiet "${QUEUE_BRANCH}" >/dev/null 2>&1; then
        # Remote unavailable but local branch exists.
        git worktree add "${QUEUE_WORKTREE}" "${QUEUE_BRANCH}" >/dev/null || true
    else
        # Neither remote nor local branch — create from current HEAD.
        git worktree add -b "${QUEUE_BRANCH}" "${QUEUE_WORKTREE}" >/dev/null || true
        if [[ ${has_remote} -eq 1 ]]; then
            git -C "${QUEUE_WORKTREE}" push -u "${REMOTE}" "${QUEUE_BRANCH}" \
                >/dev/null 2>&1 || true
        fi
    fi
fi

# Abort if the worktree was not properly initialised — git -C on a plain
# directory (without .git) silently traverses up to the parent repo.
if [[ ! -e "${QUEUE_WORKTREE}/.git" ]]; then
    echo "queue_branch.sh: ERROR — failed to initialise worktree at '${QUEUE_WORKTREE}'; remove the directory and retry" >&2
    exit 1
fi

# Verify the worktree is on the right branch; try to recover via checkout
# before giving up (handles the case of manual branch switches in the worktree).
wt_branch="$(git -C "${QUEUE_WORKTREE}" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ "${wt_branch}" != "${QUEUE_BRANCH}" ]]; then
    git -C "${QUEUE_WORKTREE}" checkout "${QUEUE_BRANCH}" >/dev/null 2>&1 || true
    wt_branch="$(git -C "${QUEUE_WORKTREE}" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi
if [[ "${wt_branch}" != "${QUEUE_BRANCH}" ]]; then
    echo "queue_branch.sh: ERROR — worktree '${QUEUE_WORKTREE}' is on '${wt_branch:-unknown}', expected '${QUEUE_BRANCH}'" >&2
    exit 1
fi

# Fast-forward the worktree to origin/<queue-branch> so it carries claim/release
# commits pushed by other sessions (FF-only — never forks the append-only ledger).
sync_worktree "${QUEUE_WORKTREE}"

# Refuse a coordination branch stamped for a different project rather than
# silently mixing queues (see header comment).
_verify_or_stamp_project_id "${QUEUE_WORKTREE}" || exit 1

# Echo the worktree path — callers capture this as ARSENAL_QUEUE_DIR.
echo "${QUEUE_WORKTREE}"
