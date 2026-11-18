#!/usr/bin/env bash
# _timing.sh — how long a boundary took, appended to a local TSV. SOURCED, not run.
#
# Nothing in this bundle recorded how long anything took, so every consumer who
# hit a slow loop had to hand-instrument it or give up — and "the gate feels
# slow" has one natural response, which is to turn the gate off. The two most
# actionable reports this repo has had (#444, #445) exist only because somebody
# built that table by hand for a day.
#
# The boundary instrumented is the one arsenal already owns: every expensive
# step in the loop runs through a bundle script, so five `source` lines cover
# the whole of both reports without a PostToolUse hook, without correlating
# parallel tool calls, and without any always-on cost on turns nobody is
# measuring.
#
# Collection is always on; READING is on demand. A row is six fields and a
# couple of milliseconds, and nothing enters a context window until somebody
# runs `arsenal_timings.py`. That is the point: the data has to already exist
# when the problem appears, because that is exactly when you cannot go back and
# collect it.
#
# NEVER leaves the machine. No paths, no file contents, no diff — an event
# name, a caller-chosen label, a duration and an exit code. No network, no
# upload, no cross-repo aggregation, ever.
#
# Usage, at the top of a script that already anchors itself to the repo root:
#
#     source "${SCRIPT_DIR}/_timing.sh"
#     arsenal_timing_begin gate "${TASK_ID}" "${TASK_ID}"
#     trap 'arsenal_timing_end $?' EXIT       # or call it from an existing trap
#
# The trap is wired at the call site on purpose. Installing one from here would
# silently replace whatever EXIT trap the caller already had — gate_run.sh's
# temp-file cleanup, for one — and a metrics helper that leaks temp files is a
# bad trade for a number nobody asked for.
#
# For a duration this process did not measure end to end — a review round spans
# an `emit` and a later `verdict`, two separate invocations — call
# `arsenal_timing_record` with the milliseconds computed from the state those
# two share.
#
# Off entirely with ARSENAL_METRICS=off.

# Milliseconds since the epoch. bash 5 exports EPOCHREALTIME; bash 3.2 (still
# what `/usr/bin/env bash` finds on stock macOS) does not, and BSD `date` has no
# %N, so there the resolution is one second.
# ponytail: second resolution on old bash is fine for boundaries measured in
# seconds-to-minutes; if sub-second ever matters here, that is the upgrade path.
_arsenal_now_ms() {
    local r="${EPOCHREALTIME:-}"
    if [[ "${r}" == *[.,]* ]]; then
        r="${r/,/.}"                       # some locales render it with a comma
        printf '%d%.3s\n' "${r%.*}" "${r#*.}"
    else
        printf '%s000\n' "$(date +%s)"
    fi
}

_arsenal_metrics_off() { [[ "${ARSENAL_METRICS:-}" == "off" ]]; }

# The metrics live in their own directory carrying a `*` .gitignore, the same
# shape tmp/arsenal-review uses and for the same reason: open_task_pr.sh stages
# with `git add -A`, so a bare tmp/arsenal-metrics.tsv rides into the next task
# commit in any repo whose .gitignore does not already cover tmp/. Self-ignoring
# needs no change to the host's .gitignore and cannot be undone by one.
# `git clean -fdq` in worker_postcheck.sh has no -x, so the history survives a
# forced restore.
#
# Anchored to the MAIN repo, not to `--show-toplevel`. Workers run in throwaway
# worktrees, so a toplevel-anchored file would be deleted with the worktree that
# wrote it — and the worker loop is exactly the case worth measuring.
# `--git-common-dir` points at the main repo's .git from inside a worktree, so
# every worker appends to one file and the report sees the whole fleet.
_arsenal_metrics_file() {
    local common root=""
    common="$(git rev-parse --git-common-dir 2>/dev/null)" \
        && root="$(cd "${common}/.." 2>/dev/null && pwd -P)" || root=""
    [[ -n "${root}" ]] || root="$(pwd -P)"
    printf '%s/tmp/arsenal-metrics/metrics.tsv\n' "${root}"
}

# Tabs and newlines would forge a row, so they become spaces. Labels are
# caller-chosen strings — a task id, a branch, a suite name — not trusted input.
_arsenal_clean() { printf '%s' "${1-}" | tr '\t\r\n' '   '; }

# arsenal_timing_record <event> <label> <duration_ms> <exit_code> [task_id]
arsenal_timing_record() {
    _arsenal_metrics_off && return 0
    local file dir max keep
    file="$(_arsenal_metrics_file)"; dir="$(dirname "${file}")"
    mkdir -p "${dir}" 2>/dev/null || return 0
    [[ -f "${dir}/.gitignore" ]] || printf '*\n' > "${dir}/.gitignore" 2>/dev/null

    # `|| return 0` on every write: this is instrumentation. A read-only tree, a
    # full disk or a lost race must never fail the thing being measured.
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        "$(_arsenal_clean "${1-}")" \
        "$(_arsenal_clean "${2-}")" \
        "${3:-0}" "${4:-0}" \
        "$(_arsenal_clean "${5-}")" >> "${file}" 2>/dev/null || return 0

    # Bounded retention, checked by line count rather than by age: a repo that
    # runs the loop hard for a week must not grow this without limit. Trimmed
    # only once it is 20% over, so the common append does not rewrite the file.
    max="${ARSENAL_METRICS_MAX_LINES:-5000}"
    [[ "${max}" =~ ^[0-9]+$ ]] && (( max > 0 )) || return 0
    local lines
    lines="$(wc -l < "${file}" 2>/dev/null)" || return 0
    (( lines > max + max / 5 )) || return 0
    keep="$(mktemp "${dir}/.trim.XXXXXX" 2>/dev/null)" || return 0
    if tail -n "${max}" "${file}" > "${keep}" 2>/dev/null; then
        mv -f "${keep}" "${file}" 2>/dev/null || rm -f "${keep}" 2>/dev/null
    else
        rm -f "${keep}" 2>/dev/null
    fi
    return 0
}

# arsenal_timing_begin <event> [label] [task_id]
arsenal_timing_begin() {
    _arsenal_metrics_off && return 0
    _ARSENAL_T_EVENT="${1-}"
    _ARSENAL_T_LABEL="${2-}"
    _ARSENAL_T_TASK="${3-}"
    _ARSENAL_T_START="$(_arsenal_now_ms)"
    return 0
}

# arsenal_timing_end [exit_code] — safe to call when begin never ran.
arsenal_timing_end() {
    _arsenal_metrics_off && return 0
    [[ -n "${_ARSENAL_T_START:-}" ]] || return 0
    local end
    end="$(_arsenal_now_ms)"
    arsenal_timing_record "${_ARSENAL_T_EVENT}" "${_ARSENAL_T_LABEL}" \
        "$((end - _ARSENAL_T_START))" "${1:-0}" "${_ARSENAL_T_TASK}"
    _ARSENAL_T_START=""   # idempotent: a chained trap must not record twice
    return 0
}

# arsenal_timing_phase [name] [exit_code] — close the open phase, open <name>.
#
# The five boundaries are whole-script, and one of them swallowed the answer: a
# consumer's measured `task-pr` was 13m26s with 13m25s inside it and no internal
# structure, while the one resolved boundary — the task's own gate — was 0.3% of
# the cost. The report could say the loop was slow and not which part, which is
# the only question it exists to answer.
#
# A phase is recorded as the event `<parent>:<name>`, so parentage is derived
# from the name rather than carried in a new column: nothing changes in the
# schema, and `arsenal_timings.py` already groups by event.
#
# Phases are CONTIGUOUS by construction — every call closes the previous one —
# and that is what makes the rule closed rather than a list of names: the phases
# under a parent must sum to the parent, so a step added later and left
# uninstrumented shows as a gap instead of disappearing into the parent. Open
# the first phase right after `arsenal_timing_begin` and close the last from the
# same EXIT trap:
#
#     arsenal_timing_begin task-pr "${TASK_ID}" "${TASK_ID}"
#     trap '_rc=$?; arsenal_timing_phase "" "${_rc}"; arsenal_timing_end "${_rc}"' EXIT
#     arsenal_timing_phase review
#     ...
#
# An empty name closes the open phase without opening another. The exit code
# applies to the phase being CLOSED, so the trap attributes the failure to
# whichever phase was running when the script died.
#
# A HOST records its own sub-targets through the same schema. `host-gate` is the
# host's command and this bundle cannot know it is four make targets, so a
# Makefile that wants the breakdown writes it:
#
#     source claude-arsenal/bin/_timing.sh
#     s=$(date +%s); make test; rc=$?; e=$(date +%s)
#     arsenal_timing_record host-gate:test "" "$(( (e - s) * 1000 ))" "${rc}"
#
# and `host-gate:test` appears in the p50/p95 table beside everything else, with
# no hand-instrumentation to redo the next time the question comes up.
arsenal_timing_phase() {
    _arsenal_metrics_off && return 0
    local now
    now="$(_arsenal_now_ms)"
    if [[ -n "${_ARSENAL_P_NAME:-}" ]]; then
        arsenal_timing_record "${_ARSENAL_T_EVENT:-}:${_ARSENAL_P_NAME}" \
            "${_ARSENAL_T_LABEL:-}" "$((now - _ARSENAL_P_START))" "${2:-0}" \
            "${_ARSENAL_T_TASK:-}"
    fi
    _ARSENAL_P_NAME="${1-}"
    _ARSENAL_P_START="${now}"
    return 0
}
