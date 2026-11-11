#!/usr/bin/env bash
#
# DUPLICATED ACROSS SKILLS:
# - plugins/skill-workshop/hooks/check_skill_workshop_loaded.sh (canonical)
# - plugins/core/skills/init/assets/bin/check_skill_workshop_loaded.sh
# Shipped in the core bundle because plugin hooks do not travel with vendored
# skills, and vendoring is the only path a cloud session can use. Keep both
# copies in sync. Update via skill-workshop's sync_duplicates.py.
# PreToolUse hook on Edit / Write / MultiEdit / Bash.
#
# Blocks any edit inside a skill folder until skill-workshop has been loaded
# this session. skill-workshop owns the gate ruleset every skill change must
# pass; this hook guarantees a session that touches a skill file has loaded
# it. The companion hook mark_skill_workshop_loaded.sh drops the marker after
# a successful Skill tool call.
#
# Bash is covered because it is the hole the other three leave: `sed -i`, `tee`,
# a heredoc redirect and a python one-liner all reach a SKILL.md without ever
# naming it in `file_path`. gate_target.py decides what a call actually writes.
#
# Exit codes:
#   0 — path is not in a skill folder, OR skill-workshop is loaded → allow.
#   2 — path is in a skill folder and no marker is present → block + tell
#       Claude to invoke skill-workshop first. Stderr is shown to Claude.
#
# Designed to be cheap: pure shell + one Python json parse, no network.

set -euo pipefail

payload="$(cat)"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Git Bash: a native python.exe cannot open a `/c/...` path, and MSYS rewrites
# one it is handed into a wrong `C:\c\...`. Resolve to `C:/...` once, here, so
# every path built from here below works for both shells. Identity elsewhere.
command -v cygpath >/dev/null 2>&1 && here="$(cygpath -m "${here}")"
# `|| true` used to swallow the exit status here, so ANY crash inside
# gate_target.py — a NameError, a missing interpreter, a syntax error from a
# half-applied edit — produced an empty target, which the next line reads as
# "nothing to gate" and allows. A gate that opens when its own analyser breaks
# is not a gate, and it fails silently: nothing in the transcript says the
# check stopped running. gate_target.py's main() returns 0 on every path it
# handles, including an unparseable payload, so a non-zero status means it
# crashed and nothing else. Fail CLOSED on that, loudly.
# No interpreter at all is not a crash: fail closed only when the call could
# touch a skill, or a host without python3 cannot run a single Bash call.
command -v python3 >/dev/null 2>&1 || { case "$payload" in *skills/*) ;; *) exit 0 ;; esac; }
gate_err="$(mktemp)"
if ! file_path="$(printf '%s' "$payload" | python3 "${here}/gate_target.py" 2>"${gate_err}")"; then
    echo "check_skill_workshop_loaded: gate_target.py failed — the skill-edit gate cannot" >&2
    echo "determine what this call writes, so it is refused rather than allowed." >&2
    sed 's/^/  /' "${gate_err}" >&2
    rm -f "${gate_err}"
    exit 2
fi
rm -f "${gate_err}"

# Empty target → nothing this call would write inside a skill folder.
[[ -z "$file_path" ]] && exit 0

# Only fire for paths inside a skill folder. Skill folders live at
# .claude/skills/<name>/ or plugins/<plugin>/skills/<name>/. Match any
# descendant — references/, scripts/, evals/, assets/, plus any new
# subfolder or loose file at the skill root (notes.md, findings.md, etc.).
# A Bash target arrives relative, so match with and without a leading path.
# One segment past skills/ is enough: the skill folder root is itself a target,
# because `rm -rf .../skills/specify` deletes the skill as surely as editing it.
case "$file_path" in
  */.claude/skills/*|.claude/skills/*) ;;
  */plugins/*/skills/*|plugins/*/skills/*) ;;
  *) exit 0 ;;
esac

session_id="$(printf '%s' "$payload" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("session_id",""))' 2>/dev/null || true)"
marker_dir="${CLAUDE_PLUGIN_DATA:-${HOME}/.cache/claude-arsenal/skill-workshop}"
marker="${marker_dir}/loaded-${session_id}"
[[ -f "$marker" ]] && exit 0

cat >&2 <<EOF
BLOCKED: about to modify '$file_path', which lives inside a skill folder, but
the skill-workshop skill has not been loaded this session.

skill-workshop owns the gate ruleset every skill change must pass
(structural + content-quality rubrics, listing-budget audit, validate.py).
Invoke the skill-workshop skill first, then re-run the edit. The skill
folder layout, naming canon, and pre-commit checks all live in its body
and references.

If your available-skills listing has no skill-workshop, this bundle predates
the rename: load skill-creator instead — it is the same skill and satisfies
this gate.
EOF
exit 2
