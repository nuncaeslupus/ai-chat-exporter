#!/usr/bin/env bash
# rescue_snapshot.sh [<reason>]
# Capture the CURRENT working tree — tracked modifications AND untracked
# (non-ignored) files — as a commit anchored under `refs/arsenal-rescue/`,
# BEFORE a caller runs anything destructive (`git reset --hard`,
# `git clean -fd`, `git checkout -f`).
#
# Why this exists: uncommitted work has no blob in the object database, so a
# `reset --hard` that catches it is unrecoverable — no reflog, no stash, no
# dangling object to `fsck`. Every arsenal script that force-restores a tree
# calls this first, so the worst case is "your work is on a ref you have to
# find" instead of "your work is gone".
#
# The snapshot is taken through a TEMPORARY index: the caller's real index,
# staged state, and HEAD are all left exactly as they were.
#
# Stdout: the created ref name (e.g. refs/arsenal-rescue/20260728-101050-a1b2c3d4),
#         or nothing when there was nothing to rescue.
# Exit:   0 a ref was written, or the tree was clean and none was needed;
#         1 the tree HAD work and it could not be snapshotted.
#
# Those last two were one answer until now — no ref, exit 0, either way — and a
# caller cannot route around a failure it cannot see. `worker_postcheck.sh` read
# that as "clean tree" and went on to `reset --hard` + `clean -fdq`, so a
# disk-full or a permissions error during the snapshot ended with the work
# destroyed and no ref to recover it from. Silent, and only on the one occasion
# the safety net was needed. A rescue still never fails its caller *by
# accident*: exit 1 means the caller must decide, and the destructive step is
# the caller's to skip.
#
# Recover with either of:
#   git checkout <ref> -- .          # restore the files into the current tree
#   git diff HEAD <ref> | git apply  # or replay them as a patch
#
# Rescue refs are never pruned automatically; delete one with
# `git update-ref -d <ref>` once the work is safely committed elsewhere.

set -uo pipefail

REASON="${1:-pre-restore snapshot}"

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "${root}" ]] || exit 0

# Nothing to rescue. -u (default) counts untracked files too: those are exactly
# what `git clean -fd` would delete and what `git stash create` would miss.
[[ -n "$(git -C "${root}" status --porcelain 2>/dev/null)" ]] || exit 0

tmp_index="$(mktemp "${TMPDIR:-/tmp}/arsenal-rescue-index.XXXXXX" 2>/dev/null || true)"
[[ -n "${tmp_index}" ]] || exit 1
# `git read-tree` wants to create the index itself; mktemp already made the file
# (that is its point — a reserved name), so hand git the reserved path empty.
: > "${tmp_index}"
cleanup() { rm -f "${tmp_index}"; }
trap cleanup EXIT

head_sha="$(git -C "${root}" rev-parse --verify --quiet HEAD 2>/dev/null || true)"

# Build the snapshot tree: start from HEAD (so the diff against HEAD is exactly
# the worker's/user's changes), then `add -A` the whole working tree from the
# repo root. `add -A` honours .gitignore, so ignored session files and build
# artefacts stay out of the snapshot.
if [[ -n "${head_sha}" ]]; then
    GIT_INDEX_FILE="${tmp_index}" git -C "${root}" read-tree "${head_sha}" >/dev/null 2>&1 || exit 1
fi
GIT_INDEX_FILE="${tmp_index}" git -C "${root}" add -A >/dev/null 2>&1 || exit 1
tree="$(GIT_INDEX_FILE="${tmp_index}" git -C "${root}" write-tree 2>/dev/null || true)"
[[ -n "${tree}" ]] || exit 1

commit_args=("${tree}")
[[ -n "${head_sha}" ]] && commit_args+=(-p "${head_sha}")

# commit-tree needs an identity. Use the repo's own when configured; otherwise
# supply a neutral one rather than failing the rescue on an unconfigured clone.
# Two spelled-out branches rather than an `identity_args` array: expanding an
# EMPTY array under `set -u` is an unbound-variable error on bash 3.2 (still
# /bin/bash on macOS), and a rescue must not die on the shell version.
if [[ -z "$(git -C "${root}" config user.email 2>/dev/null || true)" ]]; then
    snapshot="$(git -C "${root}" -c "user.name=arsenal-rescue" \
        -c "user.email=arsenal-rescue@localhost" \
        commit-tree "${commit_args[@]}" -m "arsenal-rescue: ${REASON}" 2>/dev/null || true)"
else
    snapshot="$(git -C "${root}" commit-tree "${commit_args[@]}" \
        -m "arsenal-rescue: ${REASON}" 2>/dev/null || true)"
fi
[[ -n "${snapshot}" ]] || exit 1

stamp="$(date -u +%Y%m%d-%H%M%S 2>/dev/null || echo snapshot)"
ref="refs/arsenal-rescue/${stamp}-${snapshot:0:8}"
git -C "${root}" update-ref "${ref}" "${snapshot}" >/dev/null 2>&1 || exit 1

printf '%s\n' "${ref}"
exit 0
