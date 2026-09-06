#!/usr/bin/env bash
# Self-checking test for the `node`/`permissions`/`keywords` modes of
# build/check-release.cjs (DOCS-1).
#
# The repo has no shell-test framework (vitest only covers .ts), so this is a
# plain assert script, same style as tests/gate_run_test.sh and
# tests/release_gate_test.sh: `bash tests/check_release_test.sh`, exit 0 = all
# pass.
#
# What it pins down:
#   - `node` mode now also reconciles README.md and docs/dev/building.md
#     against package.json engines.node (DOCS-1 finding: both docs still said
#     Node 18 while the project requires Node 22, and the old check only
#     covered BUILD_INSTRUCTIONS.md/ci.yml).
#   - `permissions` mode is new: every entry in manifest.base.json's
#     `permissions`/`host_permissions` must be justified in the store listing
#     file for the manifest's current version (DOCS-1 finding: the v1.1.1
#     listings never mention `scripting` or the web-sandbox host permission).
#
# Both checks read from `CHECK_RELEASE_ROOT` (falls back to the real repo
# root) so they can run against a throwaway fixture tree instead of mutating
# the real docs.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKER="${REPO_ROOT}/build/check-release.cjs"
WORK="$(mktemp -d -t check-release-test-XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

FAILURES=0

check() { # check <label> <expected-exit-code> <actual-exit-code>
    if [[ "$2" == "$3" ]]; then
        echo "  ok   $1"
    else
        echo "  FAIL $1 (expected exit $2, got $3)"
        FAILURES=$((FAILURES + 1))
    fi
}

# fixture <node-in-readme> <node-in-building> -> sets up $WORK/node-fixture
node_fixture() {
    local dir="${WORK}/node-fixture"
    rm -rf "${dir}"
    mkdir -p "${dir}/.github/workflows" "${dir}/docs/dev"
    printf '{"engines":{"node":">=22.0.0"}}' >"${dir}/package.json"
    printf 'jobs:\n  validate:\n    steps:\n      - node-version: 22\n' \
        >"${dir}/.github/workflows/ci.yml"
    printf 'Node.js >= 22.0.0\n' >"${dir}/BUILD_INSTRUCTIONS.md"
    printf -- "- Node.js >= %s\n" "$1" >"${dir}/README.md"
    printf -- "- Node.js >= %s\n" "$2" >"${dir}/docs/dev/building.md"
}

echo "check-release.cjs node mode:"

node_fixture "22.0.0" "22.0.0"
CHECK_RELEASE_ROOT="${WORK}/node-fixture" node "${CHECKER}" node >/dev/null 2>&1
check "README + building.md in sync with engines.node exits 0" 0 "$?"

node_fixture "18.0.0" "22.0.0"
CHECK_RELEASE_ROOT="${WORK}/node-fixture" node "${CHECKER}" node >/dev/null 2>&1
check "stale README.md Node floor is refused" 1 "$?"

node_fixture "22.0.0" "18.0.0"
CHECK_RELEASE_ROOT="${WORK}/node-fixture" node "${CHECKER}" node >/dev/null 2>&1
check "stale docs/dev/building.md Node floor is refused" 1 "$?"

# --- permissions -------------------------------------------------------------

# perm_fixture <listing-body> -> sets up $WORK/perm-fixture with a manifest
# requesting `scripting` plus a web-sandbox host permission.
perm_fixture() {
    local dir="${WORK}/perm-fixture"
    rm -rf "${dir}"
    mkdir -p "${dir}/manifests" "${dir}/docs/store-listings"
    cat >"${dir}/manifests/manifest.base.json" <<'JSON'
{
  "version": "9.9.9",
  "permissions": ["activeTab", "storage", "scripting"],
  "host_permissions": [
    "https://claude.ai/*",
    "https://*.web-sandbox.oaiusercontent.com/*"
  ]
}
JSON
    printf '%s' "$1" >"${dir}/docs/store-listings/chrome-web-store-v9.9.9.txt"
    printf '%s' "$1" >"${dir}/docs/store-listings/firefox-addons-v9.9.9.txt"
}

echo "check-release.cjs permissions mode:"

perm_fixture "activeTab, storage, scripting, claude.ai, web-sandbox.oaiusercontent.com"
CHECK_RELEASE_ROOT="${WORK}/perm-fixture" node "${CHECKER}" permissions >/dev/null 2>&1
check "listing covering every manifest permission exits 0" 0 "$?"

perm_fixture "activeTab, storage, claude.ai"
CHECK_RELEASE_ROOT="${WORK}/perm-fixture" node "${CHECKER}" permissions >"${WORK}/perm.out" 2>&1
check "listing missing scripting + web-sandbox host is refused" 1 "$?"
if ! grep -q '"scripting"' "${WORK}/perm.out"; then
    echo "  FAIL missing-scripting error names the permission"
    FAILURES=$((FAILURES + 1))
else
    echo "  ok   missing-scripting error names the permission"
fi

# --- keywords ----------------------------------------------------------------

# kw_fixture <listing-body> -> $WORK/kw-fixture with a v9.9.9 manifest and that
# body as both listings.
kw_fixture() {
    local dir="${WORK}/kw-fixture"
    rm -rf "${dir}"
    mkdir -p "${dir}/manifests" "${dir}/docs/store-listings"
    printf '{\n  "version": "9.9.9"\n}\n' >"${dir}/manifests/manifest.base.json"
    printf '%s' "$1" >"${dir}/docs/store-listings/chrome-web-store-v9.9.9.txt"
    printf '%s' "$1" >"${dir}/docs/store-listings/firefox-addons-v9.9.9.txt"
}

echo "check-release.cjs keywords mode:"

kw_fixture "Six formats to choose from, including PDF, Markdown and Word.
Code highlighting, images and tables are kept in every one."
CHECK_RELEASE_ROOT="${WORK}/kw-fixture" node "${CHECKER}" keywords >/dev/null 2>&1
check "prose naming each format once exits 0" 0 "$?"

# The exact block the Chrome Web Store quoted back in the v1.3.0 rejection
# (violation "Yellow Argon", 2026-09-06). This is the regression under test:
# it shipped because a listing that had passed before was treated as a safe
# baseline.
kw_fixture "Multiple Export Formats:

• PDF - Paginated documents with page numbers, code highlighting and embedded images
• Markdown - Clean, readable text with full formatting support
• Word - Microsoft Word documents with proper structure
• HTML, JSON, Plain text"
CHECK_RELEASE_ROOT="${WORK}/kw-fixture" node "${CHECKER}" keywords >"${WORK}/kw.out" 2>&1
check "the rejected enumerate-and-describe block is refused" 1 "$?"
if ! grep -q 'Yellow Argon' "${WORK}/kw.out"; then
    echo "  FAIL refusal cites the rejection it came from"
    FAILURES=$((FAILURES + 1))
else
    echo "  ok   refusal cites the rejection it came from"
fi

# Density is counted over the whole description, which is how a listing with no
# offending bullet can still be refused.
kw_fixture "$(for i in 1 2 3 4 5 6; do echo "Export the conversation as a PDF document."; done)"
CHECK_RELEASE_ROOT="${WORK}/kw-fixture" node "${CHECKER}" keywords >"${WORK}/kw2.out" 2>&1
check "a format named six times in plain prose is refused" 1 "$?"

# The TAGS block is a keyword field by design and must not count against prose.
kw_fixture "Export your conversations.

TAGS
chatgpt, claude, pdf, pdf, pdf, pdf, pdf, pdf, markdown, markdown, markdown"
CHECK_RELEASE_ROOT="${WORK}/kw-fixture" node "${CHECKER}" keywords >/dev/null 2>&1
check "keywords in the TAGS field do not count as description prose" 0 "$?"

if [[ "${FAILURES}" -ne 0 ]]; then
    echo "${FAILURES} check(s) failed"
    exit 1
fi
echo "all checks passed"
