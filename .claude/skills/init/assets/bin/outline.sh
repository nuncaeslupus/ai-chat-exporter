#!/usr/bin/env bash
# outline.sh — print a file's shape (declarations only), not its prose.
#
# Arsenal's worker loop is built on imitation: a task's gate module is expected
# to look like the last one, its evidence file like the last one, its tests like
# the last one. That consistency is a real strength — it is why a reviewer can
# check one gate module by reading another. But it means a worker is constantly
# told to "follow the existing module", and the default way to do that is to
# read the whole file.
#
# On the surface where the context window is the binding constraint, that is the
# expensive habit. Measured on a consumer repo: reading a ~400-line module whose
# rationale docstring is a third of its length cost ~6k tokens, when what was
# actually needed — the constants, the function signatures, the naming
# convention — is ~400. A 15x overshoot, repeated once per gate-writing task.
#
# The docstrings are not the problem and should not be shortened: they are what
# lets a reviewer tell a real gate from a decorative one. The problem is that no
# cheaper action was named at the moment of choosing. This is that action.
#
# Usage:
#   outline.sh <file> [file...]        # one or more sources
#
# Then open the body of only the function whose logic you actually need:
#   sed -n '120,180p' <file>
#
# Stdout: `<line>: <declaration>` per structural line, grouped by file.
# Exit:   0 if every file was readable, 1 otherwise (2 on no arguments).

set -uo pipefail

if [[ $# -eq 0 ]]; then
    cat >&2 <<'USAGE'
outline.sh: no files given.

  outline.sh <file> [file...]   print declarations only, not bodies

Use it when a task says to follow an existing module: read its shape first, then
open just the function you need with `sed -n 'START,ENDp' <file>`.
USAGE
    exit 2
fi

# One pattern per language, matching what carries the shape: the names a copy
# has to agree with, and nothing that is merely prose.
pattern_for() {
    case "${1##*.}" in
        py)
            echo '^[[:space:]]*(async[[:space:]]+)?(def|class)[[:space:]]|^[A-Z_][A-Z0-9_]*[[:space:]]*[:=]|^@[A-Za-z_]' ;;
        sh|bash)
            # `function name {` is valid Bash and was missed: the `(function )?`
            # prefix was optional but the `()` was not, so a file written in
            # that style outlined to its constants and read as a file with no
            # functions — which is worse than an outline that admits it parsed
            # nothing, because the caller does not open the file to find out.
            echo '^[[:space:]]*(function[[:space:]]+[A-Za-z_][A-Za-z0-9_]*([[:space:]]*\(\))?|[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\(\))|^[A-Z_][A-Z0-9_]*=|^[[:space:]]*(readonly|declare|export)[[:space:]]' ;;
        js|jsx|ts|tsx|mjs|cjs)
            echo '^[[:space:]]*(export[[:space:]]+)?(default[[:space:]]+)?(async[[:space:]]+)?(function|class|const|let|var|type|interface|enum)[[:space:]]|^[[:space:]]*[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*\(.*\)[[:space:]]*\{[[:space:]]*$' ;;
        go)
            echo '^(func|type|const|var|package)[[:space:]]' ;;
        rs)
            echo '^[[:space:]]*(pub[[:space:]]+)?(async[[:space:]]+)?(fn|struct|enum|trait|impl|mod|const|static|type)[[:space:]]' ;;
        rb)
            echo '^[[:space:]]*(def|class|module)[[:space:]]|^[A-Z_][A-Z0-9_]*[[:space:]]*=' ;;
        java|kt|scala|cs)
            echo '^[[:space:]]*(public|private|protected|internal|abstract|final|static|open|sealed)[[:space:]].*[({]|^[[:space:]]*(class|interface|enum|object|record)[[:space:]]' ;;
        md)
            echo '^#{1,6}[[:space:]]' ;;
        yml|yaml)
            echo '^[A-Za-z_-]+:' ;;
        *)
            # Unknown extension: anything declared at column zero is the best
            # available guess at structure, and still far cheaper than the file.
            echo '^[A-Za-z_@#$][^[:space:]]*.*[[:space:]]*[({:=]|^(def|class|func|fn|function)[[:space:]]' ;;
    esac
}

# What a pattern above matches and should not. ERE has no negative lookahead, so
# the exclusion is a second pass rather than a longer expression: the JS method
# shorthand alternative — `identifier(...) {` at end of line — also matches
# `if (x) {`, `for (…) {`, `catch (e) {`, so body structure leaked into an
# outline whose whole purpose is to leave the body out.
exclude_for() {
    case "${1##*.}" in
        js|jsx|ts|tsx|mjs|cjs)
            echo '^[0-9]+:[[:space:]]*(if|for|while|switch|catch|do|else|return|with)[[:space:]]*\(' ;;
        *)
            echo '' ;;
    esac
}

status=0
multi=0
[[ $# -gt 1 ]] && multi=1

for file in "$@"; do
    if [[ ! -r "${file}" ]]; then
        echo "outline.sh: cannot read ${file}" >&2
        status=1
        continue
    fi
    [[ ${multi} -eq 1 ]] && printf '==> %s <==\n' "${file}"

    shape="$(grep -nE "$(pattern_for "${file}")" -- "${file}" || true)"
    exclude="$(exclude_for "${file}")"
    if [[ -n "${shape}" && -n "${exclude}" ]]; then
        shape="$(printf '%s\n' "${shape}" | grep -vE "${exclude}" || true)"
    fi
    if [[ -n "${shape}" ]]; then
        printf '%s\n' "${shape}"
    else
        # No match is an answer, not a failure: a data file or a prose file has
        # no shape to copy, and saying so is cheaper than the caller re-reading
        # it in full to find that out.
        echo "(no declarations matched — this file is prose or data, not structure)"
    fi
    [[ ${multi} -eq 1 ]] && echo
done

exit ${status}
