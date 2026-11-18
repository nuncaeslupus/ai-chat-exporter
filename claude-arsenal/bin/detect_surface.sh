#!/usr/bin/env bash
# detect_surface.sh — updates arsenal/session/surface_profile.json.
# Detects surface (cli/web) via CLAUDE_CODE_REMOTE, probes available services,
# and runs the host's own [capabilities] probes from arsenal/config.toml.
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
        # Stock macOS has no `timeout`; fall back to an unbounded ping there.
        _t=(); command -v timeout &>/dev/null && _t=(timeout 2)
        if ${_t[@]+"${_t[@]}"} redis-cli ping 2>/dev/null | grep -q PONG; then
            caps+=("\"services:redis\"")
        fi
    fi

    # Host-declared probes from `[capabilities]` in arsenal/config.toml: each
    # capability is granted only when its probe exits 0 here, so `requires:
    # [net:example.com]` stops being a claim someone has to remember to pass on
    # the right machine (#481). Each probe gets 5 s; this runs at session start.
    local config_py="" name cmd
    for config_py in "$(dirname "${BASH_SOURCE[0]}")/../scripts/arsenal_config.py" \
                     "claude-arsenal/scripts/arsenal_config.py"; do
        [[ -f "${config_py}" ]] && break
        config_py=""
    done
    if [[ -n "${config_py}" ]] && command -v python3 &>/dev/null; then
        while IFS=$'\t' read -r name cmd; do
            [[ -n "${name}" && -n "${cmd}" ]] || continue
            if command -v timeout &>/dev/null; then
                timeout 5 bash -c "${cmd}" </dev/null &>/dev/null || continue
            else
                bash -c "${cmd}" </dev/null &>/dev/null || continue
            fi
            caps+=("\"${name}\"")
        done < <(python3 "${config_py}" --repo-root . --probes 2>/dev/null)
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
