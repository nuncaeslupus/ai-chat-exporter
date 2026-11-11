#!/usr/bin/env bash
# PostToolUse hook on Skill: append "<utc-iso>\t<skill name>" to
# tmp/arsenal-metrics/skill-loads.tsv under the repo root, so skill use can be
# counted afterwards. Silent, and always exits 0: a metrics row is never worth
# failing a tool call. Parsing is a sed one-liner because this runs on every
# skill load and a python start-up would be the slowest part of it.

payload="$(cat 2>/dev/null)" || exit 0
name="$(printf '%s' "$payload" | sed -n 's/.*"skill"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
[[ -n "$name" ]] || exit 0

root="$(git rev-parse --show-toplevel 2>/dev/null)" || root="${CLAUDE_PROJECT_DIR:-$PWD}"
# The repo controls these paths, so a symlink at any of them could redirect the
# append to any file the session can write. Skip the row instead, and create each
# directory one level at a time so mkdir never follows a link.
tmpdir="${root}/tmp"
dir="${tmpdir}/arsenal-metrics"
tsv="${dir}/skill-loads.tsv"
for d in "$tmpdir" "$dir"; do
    [[ -L "$d" ]] && exit 0
    [[ -d "$d" ]] || mkdir "$d" 2>/dev/null || exit 0
done
[[ -L "$tsv" ]] && exit 0
printf '%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" >>"$tsv" 2>/dev/null
exit 0
