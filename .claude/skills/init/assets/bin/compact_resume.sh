#!/usr/bin/env bash
# Three hooks, registered by /init and by the core plugin:
#
#   compact_resume.sh            SessionStart, matcher `compact`
#   compact_resume.sh record     PostToolUse on Write / Edit / MultiEdit
#   compact_resume.sh instruct   PreCompact
#
# Compaction replaces the transcript with a summary, and a summary drops exactly
# what a long task needs to continue: the decisions already taken, the approaches
# already ruled out, and the next command. `execution` keeps those in the Resume
# section of tmp/<task-id>-notes.md; the SessionStart hook prints that section and
# a short `git status` so they land back in context right after compaction.
#
# That only helps a session that kept a notes file, and one that never loaded
# `execution` has none. `instruct` covers it: a PreCompact hook's stdout is
# appended to the compaction instructions, so it asks the summary itself to keep
# the same three things. It cannot put text in front of the model directly —
# that is still the SessionStart hook's job — but it needs nothing on disk.
#
# Which task is this session on? `record` answers it at every moment: each edit
# of a notes file writes tmp/.arsenal-sessions/<session_id> → that file. The
# session id survives compaction, so several agents sharing one checkout each
# get their own notes back. Without a record it falls back to a notes file named
# in the branch, then to the newest one — and says it guessed.
#
# The SessionStart hook is silent when there is no recent notes file, so a repo
# that never uses them pays nothing after compaction. Never blocks: always exits 0.

if [ "${1:-}" = instruct ]; then
  cat <<'EOF_INSTRUCT'
Keep these in the summary, verbatim where they are short:
- the task in progress and its handles: task id, branch, PR, issue;
- decisions taken, each with its reason;
- approaches tried and ruled out, each with its reason, so they are not retried;
- the exact next step, as a command where there is one;
- instructions and corrections the user gave in this session;
- paths of the files being edited, and of any notes file under tmp/.
EOF_INSTRUCT
  exit 0
fi

payload="$(cat 2>/dev/null || true)"
field() { printf '%s' "$payload" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1; }
sid="$(field session_id | tr -cd 'A-Za-z0-9_-')"
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" 2>/dev/null || exit 0

if [ "${1:-}" = record ]; then
  case "$payload" in *-notes.md*) ;; *) exit 0 ;; esac
  path="$(field file_path)"
  case "$path" in "$root"/*) path="${path#"$root"/}" ;; esac
  case "$path" in tmp/*-notes.md) ;; *) exit 0 ;; esac
  [ -n "$sid" ] || exit 0
  mkdir -p tmp/.arsenal-sessions 2>/dev/null && printf '%s\n' "$path" > "tmp/.arsenal-sessions/${sid}"
  exit 0
fi

[ -d tmp ] || exit 0
how=""
notes=""
# 1. This session's own record.
if [ -n "$sid" ] && [ -f "tmp/.arsenal-sessions/${sid}" ]; then
  notes="$(head -n 1 "tmp/.arsenal-sessions/${sid}")"
  [ -f "$notes" ] && how="recorded for this session" || notes=""
fi
# 2. A notes file whose task id is in the branch name.
if [ -z "$notes" ]; then
  branch="$(git symbolic-ref --short -q HEAD 2>/dev/null || true)"
  for f in tmp/*-notes.md; do
    [ -f "$f" ] || continue
    id="$(basename "$f" -notes.md)"
    case "$branch" in *"$id"*) notes="$f"; how="matched to branch ${branch}"; break ;; esac
  done
fi
# 3. The newest notes file touched in the last 7 days — older is a finished task.
if [ -z "$notes" ]; then
  recent="$(find tmp -maxdepth 1 -name '*-notes.md' -mtime -7 2>/dev/null)"
  [ -n "$recent" ] || exit 0
  # shellcheck disable=SC2086  # paths come from find over tmp/, no spaces by construction
  notes="$(ls -t $recent 2>/dev/null | head -n 1)"
  [ -f "$notes" ] || exit 0
  how="GUESSED as the newest notes file — confirm it is your task before acting"
fi

resume="$(awk '
  /^## Resume[[:space:]]*$/ { on = 1; next }
  on && /^## /              { exit }
  on && !/^>/               { print }
' "$notes" | sed '/./,$!d')"

echo "arsenal: context was compacted. The task state is on disk, not in the summary."
echo "Notes: $notes ($how) — re-read it in full before changing anything."
if [ -n "$resume" ]; then
  echo "$resume"
else
  echo "(no Resume section — fill Decided / Ruled out / Next step before continuing)"
fi
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "git status:"
  git status --short --branch 2>/dev/null | head -n 15
fi
exit 0
