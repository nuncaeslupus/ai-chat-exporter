# Projects Classic — detection + workarounds

GitHub repos can be on **Projects Classic** (legacy, REST-only, organisation-scoped) or **Projects v2** (current, GraphQL-only, user/org). Some `gh` CLI paths traverse the deprecated `projectCards` GraphQL field internally; on Classic-enabled repos those paths fail or silently no-op.

## Detection

```bash
# REST endpoint — Classic only
gh api repos/<owner>/<repo>/projects --silent 2>/dev/null && echo classic && exit 0

# GraphQL — Projects v2 (any non-zero count → v2)
gh api graphql -f query='
  query($o:String!,$r:String!){
    repository(owner:$o,name:$r){ projectsV2(first:1){ totalCount } }
  }' -F o=<owner> -F r=<repo> --jq '.data.repository.projectsV2.totalCount' | grep -q '^[1-9]' \
  && echo v2 || echo none
```

The `query_project_type.py` script in this skill wraps the same logic and optionally appends a marker comment to the repo's `CLAUDE.md` so subsequent sessions skip re-detection.

## Classic-only gotchas

These only matter when the detector returns `classic`. On `v2`/`none` repos, the standard `gh` invocations work and this section can be ignored.

### `gh pr view --comments` fails or returns empty

The plain (no `--json`) invocation triggers a GraphQL query that includes the deprecated `projectCards` field. Use `--json` or direct REST:

```bash
gh pr view <N> --json title,body,comments --jq '.'
gh api repos/<owner>/<repo>/pulls/<N>/comments \
  --jq '.[] | {path: .path, line: .line, body: .body}'
```

### `gh pr edit --body` returns exit 0 but does nothing

No error, no warning — the PR body is unchanged. Use REST `PATCH` or the GraphQL mutation:

```bash
# REST PATCH — write body to a file first to avoid shell quoting
gh api repos/<owner>/<repo>/pulls/<N> -X PATCH -F body=@/tmp/pr_body.md

# GraphQL mutation
PR_ID=$(gh pr view <N> --json id -q .id)
gh api graphql -F query='
  mutation($id:ID!,$body:String!){
    updatePullRequest(input:{pullRequestId:$id,body:$body}){pullRequest{number}}
  }' -F id="$PR_ID" -F body=@/tmp/pr_body.md
```

`gh pr edit --title` works correctly on Classic — only `--body` is affected.

### Verify before assuming success

After any `gh pr edit --body`, re-fetch the PR body and diff against what was sent:

```bash
gh pr view <N> --json body --jq .body | diff - /tmp/pr_body.md
```

If non-empty, the edit silently failed — fall back to the REST PATCH above.

## Why mark CLAUDE.md

A one-line marker (`<!-- github-skill: projects=classic -->`) in the repo's `CLAUDE.md` saves every future session a detection round-trip and an opportunity to hit the silent-failure trap. The marker is human-readable and survives `git pull`; the detector regenerates it on demand with `--write-claude-md`.
