#!/usr/bin/env bash
# workspace_list.sh — lists registered workspaces that have at least spec.md or plan.md.
# Output: one workspace name per line. Exit 0 always.
PROJECT_DIR="claude-arsenal/project"
[[ -d "${PROJECT_DIR}" ]] || exit 0
for dir in "${PROJECT_DIR}"/*/; do
    [[ -d "${dir}" ]] || continue
    name="$(basename "${dir}")"
    if [[ -f "${dir}spec.md" || -f "${dir}plan.md" ]]; then
        echo "${name}"
    fi
done
exit 0
