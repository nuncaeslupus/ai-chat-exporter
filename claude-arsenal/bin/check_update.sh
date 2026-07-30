#!/usr/bin/env bash
# check_update.sh — pull a newer claude-arsenal bundle when one is available.
#
# Compares the installed bundle version (claude-arsenal/.bundle-version) against
# the latest version tag on the upstream remote. When behind: runs
# `git subtree pull` to bring in the new bundle, then re-runs init.py --silent
# to propagate any file-level changes to the host project.
#
# NO SILENT "ALREADY CURRENT". Every path that declines to update says why. A
# consumer once re-vendored, was told it was current, and sat on a stale bundle
# for a whole session because two separate conditions both exited 0 without a
# word: no `arsenal` remote was configured (the bundle had been hand-copied, so
# there was nothing to compare against), and the upstream release was UNTAGGED
# (its tag workflow never ran), so the tag-gated check could not see it either.
# Both now report. The rules:
#   - no remote            → say so, name the remote, exit 0.
#   - newest tag > installed → update (as before).
#   - newest tag <= installed but the remote's default branch has moved past
#     that tag → read the branch's .bundle-version and, if it is newer, say so
#     loudly. An untagged upstream version is never merged automatically —
#     consumers pin to tags by contract — but they are told it exists.
#   - genuinely current    → say so.
#
# NEVER DOWNGRADES. The old check was `installed != latest`, so a consumer on a
# hand-vendored 0.21.0 with a newest tag of v0.20.5 would "update" backwards.
# Versions are compared numerically now; only a strictly newer tag updates.
#
# Env overrides (all optional):
#   ARSENAL_REMOTE   git remote name pointing to claude-arsenal (default: arsenal)
#   ARSENAL_PREFIX   git subtree prefix used when the subtree was added (default: claude-arsenal)
#   ARSENAL_UPSTREAM_VERSION_PATH  path of .bundle-version inside the marketplace
#                    repo, for the untagged-release probe
#
# Exit: 0 always — update failures are printed as warnings and never abort a session.

set -euo pipefail

REMOTE="${ARSENAL_REMOTE:-arsenal}"
PREFIX="${ARSENAL_PREFIX:-claude-arsenal}"
VERSION_FILE="${PREFIX}/.bundle-version"
UPSTREAM_VERSION_PATH="${ARSENAL_UPSTREAM_VERSION_PATH:-plugins/core/skills/init/assets/.bundle-version}"

_warn() { echo "check_update.sh: $*" >&2; }

# _semver_gt <a> <b> — true when version a is strictly greater than b.
# Non-numeric or malformed input compares false rather than erroring.
_semver_gt() {
    python3 -c "
import sys
def parse(v):
    return tuple(int(x) for x in v.split('.'))
try:
    sys.exit(0 if parse(sys.argv[1]) > parse(sys.argv[2]) else 1)
except (ValueError, IndexError):
    sys.exit(1)
" "$1" "$2" 2>/dev/null
}

# Report a newer version sitting untagged on the marketplace's default branch.
# Reads the file from a THROWAWAY bare repo: a --depth=1 fetch into the
# consumer's own repo would leave shallow objects behind and can break a later
# `git subtree merge`, and this repo is not ours to make shallow.
_upstream_branch_version() {
    local url tmpdir version=""
    url="$(git remote get-url "${REMOTE}" 2>/dev/null || true)"
    [[ -n "${url}" ]] || return 0
    tmpdir="$(mktemp -d 2>/dev/null || true)"
    [[ -n "${tmpdir}" ]] || return 0
    if git init -q --bare "${tmpdir}" 2>/dev/null \
        && git -C "${tmpdir}" fetch -q --depth=1 "${url}" HEAD 2>/dev/null; then
        version="$(git -C "${tmpdir}" show "FETCH_HEAD:${UPSTREAM_VERSION_PATH}" 2>/dev/null \
            | tr -d '[:space:]' || true)"
    fi
    rm -rf "${tmpdir}" 2>/dev/null || true
    printf '%s' "${version}"
}

# Only worth a network round trip when the default branch actually carries
# commits beyond the newest tag — otherwise the tag IS the tip and there can be
# no untagged release to find.
_report_untagged_upstream() {
    local installed="$1" latest="$2" head_sha tag_sha branch_version
    head_sha="$(git ls-remote "${REMOTE}" HEAD 2>/dev/null | awk 'NR==1{print $1}')"
    [[ -n "${head_sha}" ]] || return 0
    if [[ -n "${latest}" ]]; then
        tag_sha="$(git ls-remote "${REMOTE}" "refs/tags/v${latest}^{}" 2>/dev/null | awk 'NR==1{print $1}')"
        [[ -z "${tag_sha}" ]] && tag_sha="$(git ls-remote "${REMOTE}" "refs/tags/v${latest}" 2>/dev/null | awk 'NR==1{print $1}')"
        [[ "${head_sha}" == "${tag_sha}" ]] && return 0
    fi
    branch_version="$(_upstream_branch_version)"
    [[ -n "${branch_version}" ]] || return 0
    _semver_gt "${branch_version}" "${installed}" || return 0
    _warn "UNTAGGED UPSTREAM RELEASE — installed v${installed}, newest tag on '${REMOTE}' is v${latest:-none}, but its default branch already ships v${branch_version}."
    _warn "  The tag-gated update path cannot see it, so this session would otherwise report 'already current'."
    _warn "  Fix upstream by tagging that commit (\`make tag\` on main in the marketplace repo), then re-run this check."
    return 0
}

# No remote → the check is inert. Say so: a hand-copied bundle has no upstream
# to compare against, and silence here reads as "you are up to date".
if ! git remote get-url "${REMOTE}" >/dev/null 2>&1; then
    _warn "no '${REMOTE}' remote configured — update checking is INERT for this repo (the bundle was copied, not added as a git subtree). Wire it up with: git remote add ${REMOTE} <marketplace-url>"
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
    _warn "no version tags found on '${REMOTE}' — nothing to compare against (installed v${installed}). If the marketplace has shipped, its tag workflow may not have run."
    _report_untagged_upstream "${installed}" ""
    exit 0
fi

# Only a strictly NEWER tag is an update. Equal → current; lower → the installed
# bundle is ahead of what has been tagged (a hand-vendor, or an untagged
# upstream release), which must never trigger a backwards subtree merge.
if ! _semver_gt "${latest}" "${installed}"; then
    if [[ "${installed}" == "${latest}" ]]; then
        echo "claude-arsenal: v${installed} — current with the newest tag on '${REMOTE}'."
    else
        _warn "installed v${installed} is AHEAD of the newest tag on '${REMOTE}' (v${latest}) — not downgrading."
    fi
    _report_untagged_upstream "${installed}" "${latest}"
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
