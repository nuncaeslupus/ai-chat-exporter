---
id: lo-df75
title: "CI gaps: version sync check, zip artifacts, audit, dependabot, and make validate still runs lint"
priority: 7
workspace: "TOOLING"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/66
---

## Acceptance gate

**Gate**: CI catches a version mismatch and publishes the built zips; `make validate` passes on a clean checkout.


Prose-only gate — verified by worker judgment, no script to run.

## Work

1. **`make validate` / `make release-check` are red unconditionally.** They call `pnpm validate`, which includes `pnpm lint` — the 1151-error problem CI deliberately routes around (`lo-0f01`). The Makefile did not get the same treatment, so its own `release-check` can never be green. Either give both a recipe mirroring CI, or fix `pnpm validate`. This is a defect in the Makefile added in PR #4.
2. **No manifest-vs-package version check.** `docs/dev/releasing.md` step 1 is a manual sync of `package.json` and `manifests/manifest.base.json`. They match today (1.1.1) by luck. One CI step makes drift impossible.
3. **No artifact upload.** A green run produces nothing a human can download to smoke-test a release candidate. Add `actions/upload-artifact` after `pnpm package:all`.
4. **No `pnpm audit`, no `.github/dependabot.yml`.**
5. **No assertion that the chrome and firefox manifests actually diverge** where they must (background format, gecko keys). `pnpm build` runs both but nothing checks the outputs differ correctly.

## Context

Node matrix is deliberately out of scope here — see `lo-fe02` for the `engines` floor question, which should be settled before deciding what to test against.
