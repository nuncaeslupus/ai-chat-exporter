---
id: lo-3fc9
title: "D-24: pnpm validate omits format:check, so CI fails after a green local run"
priority: 10
workspace: "TOOLING"
tags: ["tooling"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/172
---

**What the spec requires:** `validate` is the pre-commit gate. Running it green
should mean CI passes.

**What the code does:**

```json
"validate": "pnpm lint && pnpm typecheck && pnpm test:coverage"
```

`format:check` is missing. CI runs it as a separate step, so a branch can pass
`pnpm validate` locally and still go red on `prettier --check`.

This is not hypothetical — it cost a round trip on PR #163 (R-4 Markdown), which
was reported green locally and failed CI with:

```
> prettier --check "src/**/*.{ts,tsx,css}" "tests/**/*.ts"
[warn] Code style issues found in 2 files. Run Prettier with --write to fix.
```

The trap is sharpest for generated or appended test code, which is exactly where
prettier disagrees most often.

**Fix location:** `package.json`. Add `format:check` to the `validate` chain:

```json
"validate": "pnpm lint && pnpm format:check && pnpm typecheck && pnpm test:coverage"
```

Put it early — it is the cheapest check in the chain, so it should fail fast,
before the multi-minute coverage run.

Also worth doing in the same task: check the docs that tell a contributor to run
`validate` (`docs/dev/`, `CLAUDE.md`) and make sure none of them promise it
covers formatting when it does not.

**Note for whoever takes this:** confirm CI's step list against
`.github/workflows/`, in case CI runs anything else `validate` also misses.

## Acceptance gate

`validate` fails on a deliberately misformatted file, and passes once formatted.

```bash
pnpm validate
```

## Tests
No unit test — this is a build-script change. The gate is that `pnpm validate`
exercises the same checks CI does; verify by hand with a misformatted file.

## Location
`package.json`, `.github/workflows/`
