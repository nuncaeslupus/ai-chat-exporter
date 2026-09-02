---
id: lo-8c3a
title: "Enforce the Node engines floor so package.json, CI and BUILD_INSTRUCTIONS cannot drift"
priority: 6
workspace: "TOOLING"
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/93
---

## Acceptance gate

**Gate**: a Node version mismatch between `package.json`, the CI workflow and
`BUILD_INSTRUCTIONS.md` fails a check rather than passing silently.

```bash
node build/check-release.cjs node && pnpm typecheck && pnpm test:run
```

## Context — the values are correct today; nothing keeps them correct

As of 2026-07-28 all three agree, and the floor is right:
- `package.json` → `engines.node: ">=22.0.0"` (set by `lo-fe02`, PR #90)
- `.github/workflows/ci.yml:16` → `node-version: 22`
- `BUILD_INSTRUCTIONS.md:7` → `Node.js >= 22.0.0`

`>=22` is correct because Node 18 reached end-of-life in April 2025 and Node 20 in
April 2026; Vite 6 declares `^18 || ^20 || >=22`; `@types/node` is pinned `^22`.

**But nothing checks it.** The previous value (`>=18.0.0`) was fiction for months
precisely because no check existed. `BUILD_INSTRUCTIONS.md` is read by Firefox
reviewers — if it drifts from what the build actually needs, source review fails.

This is the same defect class `check-release.cjs version` already solves for
package.json vs manifest.base.json. Extend that tool rather than adding a second one.

## Work

Add a `node` mode to `build/check-release.cjs` asserting that:
1. The CI workflow's `node-version` satisfies `package.json`'s `engines.node`.
2. `BUILD_INSTRUCTIONS.md`'s stated Node requirement matches `engines.node`.

Parse the workflow with a narrow regex or a tiny YAML read — **do not add a
dependency** for this; the existing `check-release.cjs` uses no deps and that
property is worth keeping.

Wire it into the CI workflow and into `make validate`, next to the existing
version and manifest checks.

## Prove it both ways

A check that has never failed is indistinguishable from a check that cannot fail —
which is exactly the trap `lo-2416` uncovered elsewhere in this repo. Temporarily
edit a COPY (not the real files) to introduce a mismatch, show the check exits
non-zero, then show it passes on the real ones. Include both outputs.

## Tests

The check script itself is the test. Show its literal pass and fail output.
