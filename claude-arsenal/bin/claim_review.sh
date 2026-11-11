#!/usr/bin/env bash
# claim_review.sh <pr> <head-sha> — take exclusive ownership of reviewing one
# head, or fail cleanly.
#
# A review is a unit of expensive work — a second reader on a substantial PR is
# 135k–280k tokens and several minutes — and until now it was the only expensive
# unit in this bundle with no compare-and-swap. Tasks have `claim_task.sh`;
# reviews had a convention, so two sessions could dispatch a reader at the same
# head and only notice the duplicate if one said so. Coordination by
# announcement is exactly what the claim ref exists to stop needing.
#
# Same primitive as claim_task.sh, one more ref namespace:
#
#     POST /repos/{owner}/{repo}/git/refs   →  422 "Reference already exists"
#
# THE HEAD SHA IS PART OF THE KEY, and that is the whole difference from a task
# claim. A task is claimed once; a review is about one tree. Keying on the PR
# number alone would mean the first reader's claim blocks a re-read after three
# more pushes — the stale-review case is the one a fleet hits most — while
# keying on the head means a new push is a new unit of work, claimable by
# whoever gets there first. It also makes the claim say something true: this
# ref is the receipt that THIS tree is being read.
#
# Stdout:
#   won <ref>            — the review is yours
#   lost                 — somebody is already reading this head
#   manual <METHOD> <PATH> <BODY>
#                        — no scriptable GitHub channel here; make this exact
#                          call with your built-in GitHub tools and treat
#                          201 as `won`, 422 as `lost`
# Exit: 0 won, 1 lost, 5 manual, 2 error.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHANNEL="${SCRIPT_DIR}/github_channel.sh"

# Not `${1:?...}`: that exits 1, and 1 is documented here as `lost`. A usage
# error that reads as a lost race makes a session skip a review it should have
# run, which is the exact outcome this script exists to prevent.
PR="${1:-}"
HEAD_SHA="${2:-}"

_fail() { echo "error: $1" >&2; exit 2; }

[[ -n "${PR}" && -n "${HEAD_SHA}" ]] \
    || { echo "usage: claim_review.sh <pr> <head-sha>" >&2; exit 2; }
[[ "${PR}" =~ ^[0-9]+$ ]] || _fail "pr must be a number, got '${PR}'"
# A full 40-char sha or an abbreviation, but nothing else: a branch name or
# `HEAD` would make the claim key something that moves, and a key that moves
# is not a lock.
[[ "${HEAD_SHA}" =~ ^[0-9a-fA-F]{7,40}$ ]] || _fail "head-sha must be a hex sha, got '${HEAD_SHA}'"

REMOTE="${ARSENAL_QUEUE_REMOTE:-origin}"
PREFIX="${ARSENAL_REVIEW_PREFIX:-arsenal/reviews}"

# Lowercase so two sessions that abbreviate the same sha differently do not both
# win. Not truncated to a common length: a 7-char and a 40-char spelling of one
# sha are still two refs, and the caller is told to pass the head sha it read
# from the PR, which is the full one.
sha_key="$(printf '%s' "${HEAD_SHA}" | tr '[:upper:]' '[:lower:]')"

slug="$(bash "${CHANNEL}" --slug)" || _fail "cannot determine owner/repo from remote '${REMOTE}'"

# The ref has to point at a commit, and the head being reviewed is the only
# meaningful one: it makes `git log arsenal/reviews/<pr>-<sha>` show what was
# read. Falls back to the local default-branch head when the object is not in
# this checkout — a reader dispatched without a fetch still gets to claim.
anchor="${HEAD_SHA}"
if ! git cat-file -e "${HEAD_SHA}^{commit}" 2>/dev/null; then
    default_branch="${ARSENAL_DEFAULT_BRANCH:-}"
    if [[ -z "${default_branch}" ]]; then
        default_branch="$(git symbolic-ref --short "refs/remotes/${REMOTE}/HEAD" 2>/dev/null \
            | sed "s#^${REMOTE}/##")"
    fi
    default_branch="${default_branch:-main}"
    anchor="$(git rev-parse "refs/remotes/${REMOTE}/${default_branch}" 2>/dev/null \
        || git rev-parse HEAD 2>/dev/null)"
    [[ -z "${anchor}" ]] && _fail "cannot resolve a commit to anchor the review claim"
fi

ref="refs/heads/${PREFIX}/${PR}-${sha_key}"
body="$(printf '{"ref":"%s","sha":"%s"}' "${ref}" "${anchor}")"
path="/repos/${slug}/git/refs"

out="$(bash "${CHANNEL}" --api POST "${path}" "${body}" 2>/dev/null)"
status=$?

case ${status} in
    0) echo "won ${ref}"; exit 0 ;;
    3) echo "lost"; exit 1 ;;
    5) echo "manual POST ${path} ${body}"; exit 5 ;;
    *)
        echo "error: review claim call failed for PR ${PR} at ${sha_key}" >&2
        [[ -n "${out}" ]] && echo "${out}" >&2
        exit 2
        ;;
esac
