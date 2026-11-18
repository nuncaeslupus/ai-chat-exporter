#!/usr/bin/env bash
# session_start.sh — the deterministic half of AGENTS.md's session-start protocol.
#
# The protocol used to be nine prose steps the model re-derived every session.
# Everything in it that is a computation (bundle refresh, capability map, channel
# detection, the board, missing handles, filed-issue import) is here, and the
# output is a few lines. What stays with the session is only what needs ITS
# GitHub tools or a user: those are printed as `ACTION:` lines.
#
#   session_start.sh           everything; fetches issues itself when channel is `gh`
#   session_start.sh --board   steps from the board on, from issue files the session
#                              wrote (the `rest`/`none` channels)
#
# Files: ARSENAL_ISSUES_JSON (default /tmp/arsenal-issues.json — the path
# open_task_pr.sh and the worker loop read), with arsenal-unfiled.json and
# arsenal-import.json beside it. Not $TMPDIR: macOS always sets it, and the
# board would then be written where nothing downstream looks.
#
# It never commits, merges or pushes. The one write is issue_import.py --apply's
# new task files, left uncommitted for the session. Runs from any subdirectory.
#
# Exit: 0 = report printed (ACTION lines included); 1 = the board could not be
# produced or a step failed (named on stderr); 2 = usage / not a consumer repo.

set -uo pipefail

usage() { echo "usage: session_start.sh [--board]" >&2; }
case "${1:-}" in
    "" | --board) MODE="${1:-all}" ;;
    -h | --help) usage; exit 0 ;;
    *) usage; exit 2 ;;
esac

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" \
    || { echo "session_start.sh: not inside a git work tree" >&2; exit 2; }
cd "$ROOT" || exit 2
B=claude-arsenal
[[ -d "$B/scripts" ]] || { echo "session_start.sh: no $B/ bundle at $ROOT" >&2; exit 2; }

ISSUES="${ARSENAL_ISSUES_JSON:-/tmp/arsenal-issues.json}"
D="$(dirname "$ISSUES")"
UNFILED="$D/arsenal-unfiled.json"; IMPORT="$D/arsenal-import.json"
INIT=.claude/skills/init/scripts/init.py
rc=0
fail() { echo "session_start.sh: $*" >&2; rc=1; }
cfg() { python3 "$B/scripts/arsenal_config.py" --get "$1" 2>/dev/null || echo "$2"; }
TASK_LABEL="$(cfg task-label arsenal:task)"
IMPORT_LABEL="$(cfg import-label arsenal:queue)"

if [[ "$MODE" != "--board" ]]; then
    # 0a. Update check. A non-subtree install reports one INERT line, which is the
    # expected answer, so it is shortened. Any other output (including the
    # subtree-without-remote INERT, which carries the fix) is printed whole.
    out=""
    if [[ -f "$B/bin/check_update.sh" ]]; then
        out="$(bash "$B/bin/check_update.sh" --check-only 2>&1)"
        if [[ "$out" == *"NON-SUBTREE install"* && "$out" != *$'\n'* ]]; then
            echo "update: INERT (non-subtree install; nothing to do)"
        elif [[ -n "$out" ]]; then
            echo "update: $out"
        fi
    fi
    # 0b. Refresh (skipped when the update check says the vendored skill is behind).
    # Never --allow-downgrade: a newer installed bundle is reported, not overwritten.
    if [[ -f "$INIT" && "$out" != *"VENDORED SKILL BEHIND BUNDLE"* ]]; then
        python3 "$INIT" --repo-path . --silent 2>&1 || fail "init.py --silent exited $?"
    fi
    # 0c. Capability map.
    if [[ -f "$INIT" ]]; then
        python3 "$INIT" --list-sections 2>&1 || fail "init.py --list-sections exited $?"
    fi

    channel="$(bash "$B/bin/github_channel.sh" --detect 2>/dev/null)" || channel=none
    echo "channel: ${channel:-none}"
    if [[ "$channel" == "gh" ]]; then
        # Narrow fetches: no `body` except on the import fetch, which needs it.
        # Each file is replaced only by a fetch that succeeded, so a failure
        # cannot leave the previous session's issues to be read as this one's.
        gh_fetch() {  # $1 = destination; rest = gh issue list args
            local dst="$1"; shift
            if gh issue list "$@" --limit 1000 >"$dst.part"; then
                mv "$dst.part" "$dst"
            else
                rm -f "$dst.part" "$dst"
                fail "gh issue list $* failed: board counts unverified"
            fi
        }
        gh_fetch "$ISSUES" --label "$TASK_LABEL" --state all \
            --json number,title,state,labels,assignees
        gh_fetch "$UNFILED.all" --state open --json number,title,labels
        gh_fetch "$IMPORT" --label "$IMPORT_LABEL" --state open \
            --json number,title,body,labels
        if [[ -f "$UNFILED.all" ]]; then
            # Open issues carrying neither the task nor the import label.
            python3 - "$UNFILED.all" "$UNFILED" "$TASK_LABEL" "$IMPORT_LABEL" <<'PY' \
                || fail "could not filter the open-issue list"
import json, sys
src, dst, *skip = sys.argv[1:]
rows = [{"number": r["number"], "title": r["title"]} for r in json.load(open(src))
        if not {lab["name"] for lab in r.get("labels") or []} & set(skip)]
json.dump(rows, open(dst, "w"))
PY
            rm -f "$UNFILED.all"
        else
            rm -f "$UNFILED"
        fi
    else
        # Clear last session's files so `--board` reads only what this one writes.
        rm -f "$ISSUES" "$UNFILED" "$IMPORT"
        cat <<EOF
ACTION: no scriptable GitHub channel. With your own GitHub tools write these files, then run \`bash $B/bin/session_start.sh --board\`:
  $ISSUES   issues labelled $TASK_LABEL, open AND closed: number,title,state,labels,assignees (no body)
  $UNFILED  open issues with neither $TASK_LABEL nor $IMPORT_LABEL: number,title
  $IMPORT   open issues labelled $IMPORT_LABEL: number,title,body,labels
EOF
        exit 0
    fi
fi

for f in "$ISSUES" "$UNFILED" "$IMPORT"; do
    [[ -s "$f" ]] || { fail "$f missing or empty: the board is unverified; write it (\`[]\` when there are none) and run --board"; exit "$rc"; }
done

# 3. Board. A failed fetch makes the counts unverified; say so.
git fetch --quiet origin 2>/dev/null || echo "git fetch origin failed: board counts unverified"
python3 "$B/scripts/query_status.py" --issues "$ISSUES" --open-issues "$UNFILED" \
    || fail "query_status.py exited $?"

# 4. Missing handles, 4b. filed-issue import. Both print a status line when there is
# nothing to do; any other line is a row the session must act on with its own tools.
# handle_sync also sees the import issues: a task imported by an earlier run whose
# relabel the session has not applied yet already HAS its handle (that issue), and
# proposing a second one would duplicate it.
both="$D/arsenal-handle-input.json"
if python3 -c 'import json, sys; json.dump(json.load(open(sys.argv[1])) + json.load(open(sys.argv[2])), open(sys.argv[3], "w"))' \
    "$ISSUES" "$IMPORT" "$both"; then
    handles="$(python3 "$B/scripts/handle_sync.py" --issues "$both" 2>&1)"; hrc=$?
    echo "$handles"
    if [[ $hrc -ne 0 ]]; then
        fail "handle_sync.py exited $hrc"
    elif grep -qv '^handle_sync:' <<<"$handles"; then
        echo "ACTION: create each issue above (every label listed, plus a visible \`arsenal-task: <id>\` body line; resolve any 'ambiguous' row first). See $B/references/queue-seeding.md"
    fi
else
    fail "could not read the issue files as JSON arrays"
fi
imp="$(python3 "$B/scripts/issue_import.py" --issues "$IMPORT" --apply 2>&1)"; irc=$?
echo "$imp"
if [[ $irc -ne 0 ]]; then
    fail "issue_import.py exited $irc"
elif grep -qv '^issue_import:' <<<"$imp"; then
    echo "ACTION: apply every change printed above and commit the new task files. See $B/references/queue-seeding.md"
fi
exit "$rc"
