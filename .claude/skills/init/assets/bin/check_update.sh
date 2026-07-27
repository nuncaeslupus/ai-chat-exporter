#!/usr/bin/env bash
# check_update.sh — pull a newer claude-arsenal bundle when one is available.
#
# Compares the installed bundle version (claude-arsenal/.bundle-version) against
# the latest version tag on the upstream remote. When behind: runs
# `git subtree pull` to bring in the new bundle, then re-runs init.py --silent
# to propagate any file-level changes to the host project.
#
# Env overrides (all optional):
#   ARSENAL_REMOTE   git remote name pointing to claude-arsenal (default: arsenal)
#   ARSENAL_PREFIX   git subtree prefix used when the subtree was added (default: claude-arsenal)
#
# This script is a no-op when:
#   - no remote named ARSENAL_REMOTE exists
#   - the remote has no version tags
#   - the installed version already matches the latest tag
#   - git is not available
#
# Exit: 0 always — update failures are printed as warnings and never abort a session.

set -euo pipefail

REMOTE="${ARSENAL_REMOTE:-arsenal}"
PREFIX="${ARSENAL_PREFIX:-claude-arsenal}"
VERSION_FILE="${PREFIX}/.bundle-version"

_warn() { echo "check_update.sh: $*" >&2; }

# Skip if no remote exists
if ! git remote get-url "${REMOTE}" >/dev/null 2>&1; then
    exit 0
fi

# Installed version
installed="$(cat "${VERSION_FILE}" 2>/dev/null || echo "0.0.0")"

# Latest strict-semver tag on the remote (vX.Y.Z only; pre-release tags ignored)
latest="$(git ls-remote --tags "${REMOTE}" 'refs/tags/v*' 2>/dev/null \
    | grep -v '\^{}' \
    | awk '{print $2}' \
    | sed 's|refs/tags/v||' \
    | python3 -c "
import sys
vs = []
for l in sys.stdin:
    v = l.strip()
    if not v:
        continue
    try:
        parts = tuple(int(x) for x in v.split('.'))
        vs.append((parts, v))
    except ValueError:
        pass
if vs:
    vs.sort()
    print(vs[-1][1])
" 2>/dev/null || true)"

if [[ -z "${latest}" ]]; then
    exit 0
fi

if [[ "${installed}" == "${latest}" ]]; then
    exit 0
fi

echo "claude-arsenal: installed=v${installed}, latest=v${latest} — pulling update…"

# Ensure the working tree is clean before the subtree update
_manual="git fetch ${REMOTE} refs/tags/v${latest}:refs/tags/v${latest} && git subtree merge --prefix=${PREFIX} \"v${latest}^{commit}\" --squash"
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    _warn "working tree is dirty; skipping auto-update (run manually: ${_manual})"
    exit 0
fi

# Update to the exact released tag (not the moving `main`) so the installed
# bundle matches the version the latest-tag check gated on. Fetch the tag ref
# explicitly first — this creates the local tag and sidesteps `git subtree` not
# dereferencing annotated tags — then merge its dereferenced commit.
if ! git fetch "${REMOTE}" "refs/tags/v${latest}:refs/tags/v${latest}" 2>&1 \
    || ! git subtree merge --prefix="${PREFIX}" "v${latest}^{commit}" --squash \
        -m "chore: update claude-arsenal to v${latest}" 2>&1; then
    _warn "subtree update failed — run manually: ${_manual}"
    exit 0
fi

echo "claude-arsenal: updated to v${latest}"

# Re-run init.py --silent so any new bundle scripts are propagated
init_py="$(find .claude/skills -name 'init.py' -path '*/init/scripts/init.py' 2>/dev/null | head -1 || true)"
if [[ -n "${init_py}" ]]; then
    python3 "${init_py}" --repo-path . --silent
fi
