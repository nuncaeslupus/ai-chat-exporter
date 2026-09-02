#!/usr/bin/env bash
#
# DUPLICATED ACROSS SKILLS:
# - plugins/skill-workshop/hooks/mark_skill_workshop_loaded_from_prompt.sh (canonical)
# - plugins/core/skills/init/assets/bin/mark_skill_workshop_loaded_from_prompt.sh
# Shipped in the core bundle because plugin hooks do not travel with vendored
# skills, and vendoring is the only path a cloud session can use. Keep both
# copies in sync. Update via skill-workshop's sync_duplicates.py.
# UserPromptSubmit hook.
#
# Detects /skill-workshop slash-command invocations and drops the
# session-scoped marker, complementing the PostToolUse hook that fires
# when skill-workshop is invoked via the Skill tool. Without this second
# path the gate deadlocks: slash commands bypass tool hooks, so a user
# who loads skill-workshop via /skill-workshop gets no marker, and
# subsequent skill-folder edits stay blocked.
#
# Always exits 0 — this hook never blocks. A failed marker write means
# the next skill-folder edit re-prompts skill-workshop load, which is a
# safe degradation.

set -euo pipefail

payload="$(cat)"
prompt="$(printf '%s' "$payload" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("prompt",""))' 2>/dev/null || true)"
session_id="$(printf '%s' "$payload" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("session_id",""))' 2>/dev/null || true)"

# Match /skill-workshop at the start of the prompt: bare, with args, or
# explicitly namespaced (e.g. /skill-workshop:skill-workshop some text).
# `skill-creator` is the same skill's former name; see the companion hook for
# why a bundle that only exposes it must still be able to satisfy the gate.
if printf '%s' "$prompt" \
    | grep -qE '^/([a-z0-9_-]+:)?(skill-workshop|skill-creator)($|[[:space:]])'; then
  if [[ -n "$session_id" ]]; then
    marker_dir="${CLAUDE_PLUGIN_DATA:-${HOME}/.cache/claude-arsenal/skill-workshop}"
    mkdir -p "$marker_dir" 2>/dev/null || true
    touch "${marker_dir}/loaded-${session_id}" 2>/dev/null || true
  fi
fi
exit 0
