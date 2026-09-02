#!/usr/bin/env bash
#
# DUPLICATED ACROSS SKILLS:
# - plugins/skill-workshop/hooks/mark_skill_workshop_loaded.sh (canonical)
# - plugins/core/skills/init/assets/bin/mark_skill_workshop_loaded.sh
# Shipped in the core bundle because plugin hooks do not travel with vendored
# skills, and vendoring is the only path a cloud session can use. Keep both
# copies in sync. Update via skill-workshop's sync_duplicates.py.
# PostToolUse hook on Skill.
#
# When the Skill tool finishes with skill=skill-workshop, drop a session-
# scoped marker so the companion PreToolUse hook
# (check_skill_workshop_loaded.sh) lets subsequent skill-folder edits
# through this session.
#
# Always exits 0 — this hook never blocks. A failure to write the marker
# means the next skill-folder edit re-prompts skill-workshop load, which is
# a safe degradation.

set -euo pipefail

payload="$(cat)"
skill_name="$(printf '%s' "$payload" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("tool_input",{}).get("skill",""))' 2>/dev/null || true)"
session_id="$(printf '%s' "$payload" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("session_id",""))' 2>/dev/null || true)"

# Strip any plugin-namespace prefix: the harness invokes skills as
# "<plugin>:skill-workshop" via the Skill tool, not the bare name.
skill_name="${skill_name##*:}"
# `skill-creator` is this skill's own former name, and it is accepted because
# the gate must be satisfiable on every bundle a consumer might have installed.
# These hooks ship in the core bundle and reach a repo whose vendored skills
# still expose only `skill-creator`; demanding a name that is not in the
# session's listing at all made the skill-folder gate unbreakable from the main
# session, for the life of that bundle version. Loading it means the rubric is
# loaded, which is the whole condition — and it cannot be loaded unless it is
# installed.
case "$skill_name" in
  skill-workshop | skill-creator) ;;
  *) exit 0 ;;
esac
[[ -n "$session_id" ]] || exit 0

marker_dir="${CLAUDE_PLUGIN_DATA:-${HOME}/.cache/claude-arsenal/skill-workshop}"
mkdir -p "$marker_dir" 2>/dev/null || true
touch "${marker_dir}/loaded-${session_id}" 2>/dev/null || true
exit 0
