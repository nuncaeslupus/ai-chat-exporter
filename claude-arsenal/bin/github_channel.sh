#!/usr/bin/env bash
# github_channel.sh — the one place that knows HOW to reach GitHub.
#
# Different surfaces offer different channels, and the old code assumed `gh`.
# That assumption fails silently: `command -v gh || skip` turns a required step
# into a no-op, so on Claude Code on the web — where `gh` is not installed and
# the REST API is unreachable because credentials live outside the sandbox —
# several steps have simply never run. Silence is the worst failure mode here,
# because the queue looks healthy while nothing is happening.
#
# So this script answers two questions and never guesses:
#
#   --detect            prints `gh`, `rest`, or `none`
#   --api M PATH [BODY] performs a GitHub REST call over the best channel
#
# `none` is not an error. It means "no scriptable channel exists here; the
# model must make this call with its built-in GitHub tools". Callers print the
# exact request in that case so the step still happens — by a different hand,
# not not at all.
#
# Exit codes for --api:
#   0   HTTP 2xx            — body on stdout
#   3   HTTP 422            — kept distinct: for ref creation this means
#                             "already exists", which is a lost race, not a fault
#   4   any other HTTP error — body on stdout, status on stderr
#   5   no scriptable channel (`none`) — caller should hand the call to the model

set -uo pipefail

usage() {
    cat >&2 <<'EOF'
usage: github_channel.sh --detect
       github_channel.sh --api <METHOD> <PATH> [JSON_BODY]
       github_channel.sh --slug            # prints owner/repo for this checkout
EOF
}

# owner/repo from the origin remote, tolerant of ssh and https forms.
repo_slug() {
    local url
    url="$(git remote get-url "${ARSENAL_QUEUE_REMOTE:-origin}" 2>/dev/null)" || return 1
    url="${url%.git}"
    url="${url#git@github.com:}"
    url="${url#ssh://git@github.com/}"
    url="${url#https://github.com/}"
    url="${url#http://github.com/}"
    printf '%s' "${url}"
}

detect() {
    if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
        echo "gh"; return 0
    fi
    # A token in the environment is not proof the API is reachable: sandboxes
    # set GITHUB_TOKEN and still answer 403, because the real credential is
    # held by a proxy outside the VM. Probe instead of assuming.
    #
    # The probe is a READ, and answers only the read question. A channel that
    # can read may still be refused a ref creation, so `rest` here means
    # "reachable", not "may write" — `api()` maps a refused write back to the
    # `none` path rather than treating it as a fault. Probing with a real write
    # is not an option: the only way to test creating a ref is to create one.
    #
    # It probes /user, not /rate_limit. An agent proxy in front of the API can
    # answer /rate_limit 200 by itself, without the request ever reaching GitHub
    # with this session's credential — so the probe was not testing the channel
    # at all, and every real call afterwards came back 403. /user cannot be
    # answered without the credential: no identity, no 200. A credential with no
    # user identity of its own (an Actions installation token) answers 403 and
    # gets `none`, which is a handled outcome — a session on that path uses its
    # built-in tools. Detection failing open into the wrong branch is the worse
    # of the two.
    if command -v curl >/dev/null 2>&1 && [[ -n "${GITHUB_TOKEN:-${GH_TOKEN:-}}" ]]; then
        local code
        code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
            -H "Authorization: Bearer ${GITHUB_TOKEN:-${GH_TOKEN}}" \
            -H "Accept: application/vnd.github+json" \
            "https://api.github.com/user" 2>/dev/null || echo 000)"
        [[ "${code}" == "200" ]] && { echo "rest"; return 0; }
    fi
    echo "none"
}

api() {
    local method="$1" path="$2" body="${3:-}"
    local channel
    channel="$(detect)"

    case "${channel}" in
        gh)
            local args=(api -X "${method}" "${path}" -H "Accept: application/vnd.github+json")
            [[ -n "${body}" ]] && args+=(--input -)
            local out status
            if [[ -n "${body}" ]]; then
                out="$(printf '%s' "${body}" | gh "${args[@]}" 2>&1)"; status=$?
            else
                out="$(gh "${args[@]}" 2>&1)"; status=$?
            fi
            printf '%s\n' "${out}"
            [[ ${status} -eq 0 ]] && return 0
            grep -qi 'already exists\|HTTP 422' <<<"${out}" && return 3
            # The same reasoning the `rest` branch below spells out, which this
            # one was missing: a write this channel is not permitted to make is
            # not a broken channel, it is the no-channel case the caller already
            # knows how to handle. Returning 4 made `claim_task.sh` map it to
            # `error` — which stops the whole session — instead of `manual`,
            # so the documented fallback was unreachable on the `gh` channel.
            # Anchored on gh's own `HTTP <code>:` framing. The bare `403|404`
            # alternatives matched anywhere in ${out} — which is gh's stdout AND
            # stderr — so an HTTP 500 whose body carried a `#404` doc link, or a
            # connection reset with `403` inside a trace id, was reported as a
            # permission failure. The caller then sent a human after a token
            # problem that did not exist, and a real outage was reclassified as
            # `manual` rather than surfacing as the error it was.
            if [[ "${method}" != "GET" ]] \
                && grep -qiE '(^|[^0-9])HTTP[[:space:]]+40[34]([^0-9]|$)' <<<"${out}"; then
                echo "channel:none"
                echo "${method} ${path}"
                [[ -n "${body}" ]] && echo "${body}"
                echo "github_channel: gh reported a permission/not-found failure for ${method} ${path} — this channel may read but not write here; handing the call back" >&2
                return 5
            fi
            return 4
            ;;
        rest)
            local tmp code
            tmp="$(mktemp)"
            # `curl -d` sends application/x-www-form-urlencoded. github.com
            # parses the raw body as JSON regardless, which is why this went
            # unnoticed — but a proxy in front of the API is entitled to reject
            # it, and one does.
            code="$(curl -sS -o "${tmp}" -w '%{http_code}' -X "${method}" \
                -H "Authorization: Bearer ${GITHUB_TOKEN:-${GH_TOKEN}}" \
                -H "Accept: application/vnd.github+json" \
                ${body:+-H "Content-Type: application/json"} \
                ${body:+--data-raw "${body}"} \
                "https://api.github.com${path}" 2>/dev/null || echo 000)"
            cat "${tmp}"; rm -f "${tmp}"
            [[ "${code}" =~ ^2 ]] && return 0
            [[ "${code}" == "422" ]] && return 3
            # A write this channel is not permitted to make is not a broken
            # channel — it is the same situation as having no channel at all,
            # and the caller already knows how to handle that: print the call
            # and let the model make it with its own GitHub tools. Reporting it
            # as a fault instead made the `manual` fallback unreachable on
            # exactly the surface it was written for, and `error` is what the
            # worker loop stops the whole session over. 404 counts too: a proxy
            # that hides write paths reports them as missing.
            if [[ "${method}" != "GET" && ( "${code}" == "403" || "${code}" == "404" ) ]]; then
                echo "channel:none"
                echo "${method} ${path}"
                [[ -n "${body}" ]] && echo "${body}"
                echo "github_channel: HTTP ${code} for ${method} ${path} — this channel may read but not write here; handing the call back" >&2
                return 5
            fi
            echo "github_channel: HTTP ${code} for ${method} ${path}" >&2
            return 4
            ;;
        *)
            # Hand the call back to the caller, fully formed, so the model can
            # make it with its built-in GitHub tools.
            echo "channel:none"
            echo "${method} ${path}"
            [[ -n "${body}" ]] && echo "${body}"
            return 5
            ;;
    esac
}

case "${1:-}" in
    --detect) detect ;;
    --slug)   repo_slug || { echo "github_channel: no git remote" >&2; exit 4; } ;;
    --api)
        shift
        [[ $# -lt 2 ]] && { usage; exit 4; }
        api "$@"
        ;;
    *) usage; exit 4 ;;
esac
