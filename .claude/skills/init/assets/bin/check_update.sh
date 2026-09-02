#!/usr/bin/env bash
# check_update.sh — pull a newer claude-arsenal bundle when one is available.
#
# Compares the installed bundle version (claude-arsenal/.bundle-version) against
# the latest version tag on the upstream remote. When behind: runs
# `git subtree pull` to bring in the new bundle, then re-runs init.py --silent
# to propagate any file-level changes to the host project. Either way, prints
# the CHANGELOG.md entries between the installed version and the new one, so
# an update says what changed, not just the version number.
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
# It also reports the one skew no other file can: a vendored init skill OLDER
# than the bundle it would rewrite (#237).
#
# NEVER DOWNGRADES. The old check was `installed != latest`, so a consumer on a
# hand-vendored 0.21.0 with a newest tag of v0.20.5 would "update" backwards.
# Versions are compared numerically now; only a strictly newer tag updates.
#
# Env overrides (all optional):
#   ARSENAL_REMOTE   git remote name pointing to claude-arsenal (default: arsenal)
#   ARSENAL_PREFIX   git subtree prefix used when the subtree was ADDED (default: claude-arsenal)
#   ARSENAL_BUNDLE_DIR  where the ASSEMBLED bundle lives, holding .bundle-version
#                    (default: ARSENAL_PREFIX). These are the same directory in a
#                    plain install and different ones when the subtree is
#                    vendored whole (say at vendor/claude-arsenal/) and the
#                    bundle assembled out of it — a layout with no single value
#                    that could satisfy both readings.
#   ARSENAL_UPSTREAM_VERSION_PATH  path of .bundle-version inside the marketplace
#                    repo, for the untagged-release probe
#   ARSENAL_UPSTREAM_CHANGELOG_PATH  path of CHANGELOG.md inside the marketplace
#                    repo, for printing what changed on an update
#
# Exit: 0 always — update failures are printed as warnings and never abort a session.

set -euo pipefail

# `--check-only` reports and changes nothing. The session-start protocol
# documents this script as reporting status, but the happy path performs a
# subtree merge and commits — a history-writing side effect from a step
# described as a read, landing in the very working tree the worker loop
# requires to be clean.
CHECK_ONLY=0
for arg in "$@"; do
    case "${arg}" in
        --check-only) CHECK_ONLY=1 ;;
        *) echo "check_update.sh: unknown argument '${arg}'" >&2; exit 0 ;;
    esac
done

REMOTE="${ARSENAL_REMOTE:-arsenal}"
# Two different paths that a single variable used to conflate. `PREFIX` is what
# `git subtree merge --prefix` needs; `BUNDLE_DIR` is where the assembled bundle
# records its version. Defaulting one to the other keeps every single-directory
# install behaving exactly as before.
PREFIX="${ARSENAL_PREFIX:-claude-arsenal}"
BUNDLE_DIR="${ARSENAL_BUNDLE_DIR:-${PREFIX}}"
VERSION_FILE="${BUNDLE_DIR}/.bundle-version"
UPSTREAM_VERSION_PATH="${ARSENAL_UPSTREAM_VERSION_PATH:-plugins/core/skills/init/assets/.bundle-version}"
UPSTREAM_CHANGELOG_PATH="${ARSENAL_UPSTREAM_CHANGELOG_PATH:-plugins/core/skills/init/assets/CHANGELOG.md}"

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

# Read `path` at `ref` on the remote, via a THROWAWAY bare repo. A --depth=1
# fetch into the consumer's own repo would leave shallow objects behind and can
# break a later `git subtree merge`, and this repo is not ours to make shallow.
# Empty on any failure (no remote, unreachable ref, no such path) — every
# caller treats that as "nothing to report", never as an error worth aborting on.
_show_upstream_file() {
    local ref="$1" path="$2" url tmpdir content=""
    url="$(git remote get-url "${REMOTE}" 2>/dev/null || true)"
    [[ -n "${url}" ]] || return 0
    tmpdir="$(mktemp -d 2>/dev/null || true)"
    [[ -n "${tmpdir}" ]] || return 0
    if git init -q --bare "${tmpdir}" 2>/dev/null \
        && git -C "${tmpdir}" fetch -q --depth=1 "${url}" "${ref}" 2>/dev/null; then
        content="$(git -C "${tmpdir}" show "FETCH_HEAD:${path}" 2>/dev/null || true)"
    fi
    rm -rf "${tmpdir}" 2>/dev/null || true
    printf '%s' "${content}"
}

# Report a newer version sitting untagged on the marketplace's default branch.
_upstream_branch_version() {
    _show_upstream_file "HEAD" "${UPSTREAM_VERSION_PATH}" | tr -d '[:space:]'
}

# Print CHANGELOG.md entries for versions in (installed, latest] — what a
# consumer actually gets by updating, not just the version number. Silent on
# any failure: this is an enhancement to the UPDATE AVAILABLE / pulling-update
# messages below, never a reason to treat the update path differently.
_print_changelog_since() {
    local installed="$1" latest="$2" text
    text="$(_show_upstream_file "refs/tags/v${latest}" "${UPSTREAM_CHANGELOG_PATH}")"
    [[ -n "${text}" ]] || return 0
    printf '%s' "${text}" | python3 -c "
import re, sys
def parse(v):
    return tuple(int(x) for x in v.split('.'))
installed, latest = parse(sys.argv[1]), parse(sys.argv[2])
parts = re.split(r'(?m)^## \[(\d+\.\d+\.\d+)\][^\n]*\n', sys.stdin.read())
entries = []
for i in range(1, len(parts), 2):
    try:
        v = parse(parts[i])
    except ValueError:
        continue
    if installed < v <= latest:
        body = parts[i + 1].strip() if i + 1 < len(parts) else ''
        if body:
            entries.append((v, parts[i], body))
entries.sort(reverse=True)
for _, ver, body in entries:
    print()
    print(f'  --- new in {ver} ---')
    for line in body.splitlines():
        print(f'  {line}')
" "${installed}" "${latest}" 2>/dev/null || true
}

# Only worth a network round trip when the default branch actually carries
# commits beyond the newest tag — otherwise the tag IS the tip and there can be
# no untagged release to find.
_report_untagged_upstream() {
    local installed="$1" latest="$2" head_sha tag_sha branch_version
    # `|| true` on the pipeline: this file promises "Exit: 0 always" because
    # session-start step 0(a) runs it as a *report*, and an unreachable or
    # credential-less remote aborting under `set -e` removes the very report it
    # exists to produce — leaving the session unaware the bundle is stale.
    head_sha="$(git ls-remote "${REMOTE}" HEAD 2>/dev/null | awk 'NR==1{print $1}' || true)"
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

# Was PREFIX added by `git subtree`? A separate question from whether a remote
# is configured, and the script tests both — it just used to answer the first
# with the second's message.
_is_subtree() {
    # `--basic-regexp` explicitly: `grep.patternType=fixed` in a consumer's git
    # config applies to `git log --grep` too, and the trailer pattern is a
    # regex — read literally it matches nothing, so every subtree would report
    # as a copied bundle and the update path would refuse to merge one.
    git log --basic-regexp --grep="git-subtree-dir: ${PREFIX}\(/\)\?$" \
        --max-count=1 --format=%H 2>/dev/null | grep -q .
}

# Installed version
installed="$(cat "${VERSION_FILE}" 2>/dev/null || echo "0.0.0")"

# The skew that nothing inside the host can catch on its own. init.py refuses to
# overwrite a newer installed bundle with its own older copies (#220) — but that
# refusal shipped in v2.4.5 and lives in the very file that is stale, so a host
# whose vendored skill predates it runs session-start step 0(b) and walks the
# bundle backwards with an "Upgrading" banner (#237). This script is bundle-side:
# in exactly the dangerous case it is the NEWER of the two files, which makes it
# the only side that can report the drop. Runs before the remote gate and
# regardless of --check-only — it is a local comparison and needs neither.
_report_skill_skew() {
    local installed="$1" ver_file skill_dir skill_ver
    # The canonical location first. The `find` below is a fallback for a host
    # that vendors the skills somewhere else, but it cannot be the primary
    # lookup: its pattern is not anchored to `.claude/skills/init/`, so any
    # other vendored skill carrying a nested `init/assets/.bundle-version`
    # matches too, and `find` emits filesystem order — so `head -1` picked a
    # DIFFERENT skill's version, compared the bundle against it, and returned
    # false. The probe then stayed silent and step 0(b) downgraded the bundle:
    # the exact failure this guard exists to catch, failing open (#244).
    # `sort` in the fallback is load-bearing for the same reason — without it
    # the same tree answers differently on different machines.
    #
    # `sort` made the fallback deterministic, but determinism is not
    # correctness: with two or more candidates it still picked one — the
    # lexicographically first, which has nothing to do with which skill owns the
    # bundle — and reported a confident verdict about it. That turned "wrong on
    # some machines" into "wrong on every machine, reproducibly", and a wrong
    # verdict here is silent: `_semver_gt` returns false, the probe says nothing,
    # and step 0(b) rewrites the bundle backwards.
    #
    # A probe that cannot identify its own subject says so instead of answering.
    # That is the same rule the gates already follow with `gate_status:
    # unmeasured` — the check ran, and what it found is that this cannot be
    # scored. Warning and returning is fail-VISIBLE rather than fail-closed: the
    # operator sees the ambiguity, and step 0(b) is not blocked for a host whose
    # layout is merely unusual.
    ver_file=".claude/skills/init/assets/.bundle-version"
    if [[ ! -f "${ver_file}" ]]; then
        local candidates count
        # No `mapfile`: this ships to consumers and runs under the bash 3.2 that
        # macOS still installs as /bin/bash, where it does not exist.
        candidates="$(find .claude/skills -path '*/init/assets/.bundle-version' 2>/dev/null | sort || true)"
        count="$(printf '%s' "${candidates}" | grep -c . || true)"
        if [[ "${count:-0}" -gt 1 ]]; then
            _warn "AMBIGUOUS VENDORED SKILL — ${count} candidate version files and no canonical ${ver_file}; not guessing which owns the bundle."
            _warn "  Candidates: $(printf '%s' "${candidates}" | tr '\n' ' ')"
            _warn "  The skew check is INERT until one of them is at .claude/skills/init/, so step 0(b) is unguarded: confirm the vendored skill is not behind the bundle before running it."
            return 0
        fi
        ver_file="$(printf '%s\n' "${candidates}" | head -1)"
    fi
    [[ -n "${ver_file}" ]] || return 0
    skill_ver="$(tr -d '[:space:]' < "${ver_file}" 2>/dev/null || true)"
    [[ -n "${skill_ver}" ]] || return 0
    _semver_gt "${installed}" "${skill_ver}" || return 0
    skill_dir="${ver_file%/assets/.bundle-version}"
    _warn "VENDORED SKILL BEHIND BUNDLE — the bundle is v${installed}, but the init skill at ${skill_dir} is v${skill_ver}."
    _warn "  Session-start step 0(b) runs that skill's init.py, which would rewrite the bundle back to v${skill_ver}. SKIP step 0(b) until the skill catches up."
    _warn "  Fix: update the plugin (/plugin update claude-arsenal), re-vendor .claude/skills from it, then re-run this check."
}
_report_skill_skew "${installed}"

# No remote → the check is inert. Say so: silence here reads as "you are up to
# date". Say only what was tested, though: the old wording asserted that the
# bundle "was copied, not added as a git subtree", which is a different fact
# and frequently a false one — remotes are not cloned, so a genuine subtree
# comes out of `git clone` with no remote at all. A session that believed it
# concluded upgrades had to be done by copying files in, which is the exact
# failure `verify-subtree` exists to catch, arrived at by trusting the tool
# whose job is to know.
if ! git remote get-url "${REMOTE}" >/dev/null 2>&1; then
    if _is_subtree; then
        _warn "no '${REMOTE}' remote configured — update checking is INERT for this repo. '${PREFIX}' IS a git subtree here; only the remote is missing, which is expected on a fresh clone. Wire it up with: git remote add ${REMOTE} <marketplace-url>"
    else
        _warn "no '${REMOTE}' remote configured — update checking is INERT for this repo, and '${PREFIX}' has no subtree merge in this history either, so it cannot be updated by merge even once the remote is added. Wire up the remote with: git remote add ${REMOTE} <marketplace-url>"
    fi
    exit 0
fi

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

# The route out of date depends on how the bundle got here, and only one of the
# two was ever printed. A plugin/assets install has no subtree at the tag root to
# merge — the skill's assets ARE the distribution — so both halves of the subtree
# command fail, and the consumer is sent down that route twice with nothing in
# the text to tell them it cannot work here.
_plugin_route="update the plugin (/plugin update claude-arsenal), re-vendor .claude/skills from it, then: python3 .claude/skills/init/scripts/init.py --repo-path . --silent"
if _is_subtree; then
    _manual_hint="git fetch ${REMOTE} refs/tags/v${latest}:refs/tags/v${latest} && git subtree merge --prefix=${PREFIX} \"v${latest}^{commit}\" --squash"
else
    _manual_hint="'${PREFIX}' is not a git subtree, so there is nothing to merge into — ${_plugin_route}"
fi
if [[ ${CHECK_ONLY} -eq 1 ]]; then
    echo "claude-arsenal: installed=v${installed}, latest=v${latest} — UPDATE AVAILABLE"
    echo "  run without --check-only, or: ${_manual_hint}"
    _print_changelog_since "${installed}" "${latest}"
    exit 0
fi

echo "claude-arsenal: installed=v${installed}, latest=v${latest} — pulling update…"
_print_changelog_since "${installed}" "${latest}"

# Ensure the working tree is clean before the subtree update
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    _warn "working tree is dirty; skipping auto-update (run manually: ${_manual_hint})"
    exit 0
fi

# Update to the exact released tag (not the moving `main`) so the installed
# bundle matches the version the latest-tag check gated on. Fetch the tag ref
# explicitly first — this creates the local tag and sidesteps `git subtree` not
# dereferencing annotated tags — then merge its dereferenced commit.
# A prefix that was never added as a subtree cannot be merged into, and no retry
# fixes it. Saying so beats a `fatal:` that reads like a transient failure and a
# manual command carrying the same wrong prefix.
if ! _is_subtree; then
    _warn "'${PREFIX}' was never added as a git subtree, so it cannot be updated by merge. If the subtree lives elsewhere, set ARSENAL_PREFIX to it (and ARSENAL_BUNDLE_DIR to where .bundle-version is). If the bundle came from the plugin instead: ${_plugin_route}"
    exit 0
fi

if ! git fetch "${REMOTE}" "refs/tags/v${latest}:refs/tags/v${latest}" 2>&1 \
    || ! git subtree merge --prefix="${PREFIX}" "v${latest}^{commit}" --squash \
        -m "chore: update claude-arsenal to v${latest}" 2>&1; then
    # A conflicting subtree merge leaves MERGE_HEAD, a populated index and
    # conflict markers behind. This branch then warns and exits 0, so the
    # session reports no failure and the worker loop runs against a tree it
    # requires to be clean -- the same tree the check above just confirmed was
    # clean. Put it back before saying anything.
    #
    # MERGE_HEAD, not the abort's exit status, is what says the tree is still
    # mid-merge: `git merge --abort` also fails when there is no merge to abort,
    # which is the common case on this branch, since a failed `git fetch` never
    # started one. And a bare `|| true` would hide the case that matters -- an
    # abort that could not undo a real conflict. Exiting nonzero is not the
    # answer either: this script promises never to abort a session (3.2.0) and
    # session-start runs it as a report. So repair the tree where that is
    # possible, and name the one state that cannot be repaired loudly enough
    # that nobody dispatches a worker into it.
    if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 \
        && ! git merge --abort >/dev/null 2>&1; then
        _warn "subtree update failed AND 'git merge --abort' could not undo it: the working tree is left mid-merge, with conflict markers under '${PREFIX}'. The worker loop requires a clean tree — resolve or abort this merge by hand BEFORE dispatching any worker, then: ${_manual_hint}"
        exit 0
    fi
    _warn "subtree update failed — run manually: ${_manual_hint}"
    exit 0
fi

# The subtree has moved. The assembled bundle has not yet — init.py builds it
# from the vendored skills, and in a layout where those are a separate tree,
# nothing has refreshed them. Re-vendoring first is what makes the upgrade
# complete rather than a merge followed by a faithful rebuild of the old
# version.
vendor_sh="$(find "${PREFIX}/scripts" .claude/skills -name 'vendor-skills.sh' 2>/dev/null | head -1 || true)"
if [[ "${BUNDLE_DIR}" != "${PREFIX}" && -n "${vendor_sh}" ]]; then
    bash "${vendor_sh}" --src "${PREFIX}" --dest .claude/skills --plugins all >/dev/null 2>&1 \
        || _warn "re-vendoring skills from ${PREFIX} failed; the bundle may still be on the old version"
fi

# Re-run init.py --silent so any new bundle scripts are propagated
init_py="$(find .claude/skills -name 'init.py' -path '*/init/scripts/init.py' 2>/dev/null | head -1 || true)"
if [[ -n "${init_py}" ]]; then
    # A refusal from init.py (a downgrade guard, a malformed config) is a
    # warning here, not an abort: aborting skips the version verification just
    # below, which is the check that separates "updated" from "half-updated".
    python3 "${init_py}" --repo-path . --silent \
        || _warn "init.py refused to re-run after the update; new bundle scripts may not be in place"
fi

# Only now is "updated" a claim worth making. A success message that can print
# while the version did not move is the part that hides a half-finished
# upgrade: the subtree says the new version, the assembled bundle says the old
# one, and nothing fails.
now_installed="$(cat "${VERSION_FILE}" 2>/dev/null || echo "0.0.0")"
if [[ "${now_installed}" != "${latest}" ]]; then
    _warn "subtree merged to v${latest} but ${VERSION_FILE} still reads ${now_installed} — the bundle was NOT upgraded. Re-vendor the skills and re-run init.py:
    bash ${PREFIX}/scripts/vendor-skills.sh --src ${PREFIX} --dest .claude/skills --plugins all
    python3 .claude/skills/init/scripts/init.py --repo-path . --silent"
    exit 0
fi

echo "claude-arsenal: updated to v${latest}"
