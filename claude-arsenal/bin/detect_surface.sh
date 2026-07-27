#!/usr/bin/env bash
# detect_surface.sh — updates claude-arsenal/session/surface_profile.json.
# Detects surface (cli/web) via CLAUDE_CODE_REMOTE and probes available services.
# No-op if claude-arsenal/session/ does not exist (repo not initialized).
#
# DUPLICATED ACROSS SKILLS:
# - plugins/core/skills/init/assets/bin/detect_surface.sh (canonical)
# - plugins/core/hooks/detect_surface.sh
# Keep both copies in sync. Update via skill-creator's sync_duplicates.py.

STATE_DIR="claude-arsenal/session"
PROFILE="${STATE_DIR}/surface_profile.json"

main() {
    [[ -d "${STATE_DIR}" ]] || return 0

    if [[ "${CLAUDE_CODE_REMOTE:-}" == "true" ]]; then
        surface="web"
    else
        surface="cli"
    fi

    caps=("\"surface:${surface}\"")

    if command -v pg_isready &>/dev/null 2>&1; then
        if pg_isready -t 2 -q 2>/dev/null; then
            caps+=("\"services:postgres\"")
        fi
    fi

    if command -v redis-cli &>/dev/null 2>&1; then
        if timeout 2 redis-cli ping 2>/dev/null | grep -q PONG; then
            caps+=("\"services:redis\"")
        fi
    fi

    local caps_json
    caps_json=$(IFS=', '; echo "${caps[*]}")
    caps_json="[${caps_json}]"

    local ts
    ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "unknown")

    printf '{\n  "surface": "%s",\n  "capabilities": %s,\n  "detected_at": "%s"\n}\n' \
        "${surface}" "${caps_json}" "${ts}" > "${PROFILE}"
}

main "$@" || true
exit 0
