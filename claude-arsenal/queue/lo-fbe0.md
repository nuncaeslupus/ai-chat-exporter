# Payload: lo-fbe0 — finish the lint/format gate

## Acceptance gate

**Gate**: `pnpm lint` exits 0 with **zero warnings**, `pnpm format:check` exits 0,
and both run in `.github/workflows/ci.yml`.

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test:run
```

## Context

`lo-0f01` (PR #97) took `pnpm lint` from 1092 errors to 0 and added it to CI.
Two gaps were left deliberately and reported by that worker:

1. **189 warnings remain**, nearly all `no-non-null-assertion` in tests. The rule
   was already `warn` before that task, so the gate passes — but a step that
   prints 189 warnings every run is a gate nobody reads. Either clear them
   (replace `!` with a real assertion/guard in the tests) or promote the rule to
   `error` once clear. Do not paper over with inline disables.
2. **`pnpm format:check` fails on ~40 files**, pre-existing and repo-wide. It is
   not in CI. Run the formatter across the repo in one commit, then add the check
   as a CI step.

Order matters: format first (it rewrites files), then the warnings.
