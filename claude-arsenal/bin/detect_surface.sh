#!/usr/bin/env bash
# detect_surface.sh — updates arsenal/session/surface_profile.json.
# Detects surface (cli/web) via CLAUDE_CODE_REMOTE and probes available services.
# No-op if arsenal/session/ does not exist (repo not initialized).
#
# DUPLICATED ACROSS SKILLS:
# - plugins/core/skills/init/assets/bin/detect_surface.sh (canonical)
# - plugins/core/hooks/detect_surface.sh
# Keep both copies in sync. Update via skill-workshop's sync_duplicates.py.

STATE_DIR="${ARSENAL_HOME:-arsenal}/session"
PROFILE="${STATE_DIR}/surface_profile.json"

main() {
    [[ -d "${STATE_DIR}" ]] || return 0

    # CLAUDE_CODE_REMOTE is set on every cloud surface, not just the web app:
    # the desktop and mobile apps, Claude Tag and routines all report it. The
    # capability was named `surface:web` first and reads as if it excluded them,
    # so `surface:cloud` is emitted alongside it. Both are granted; task files
    # written against either keep matching.
    if [[ "${CLAUDE_CODE_REMOTE:-}" == "true" ]]; then
        surface="cloud"
        caps=("\"surface:cloud\"" "\"surface:web\"")
    else
        surface="cli"
        caps=("\"surface:cli\"")
    fi

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
