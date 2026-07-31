# TEST-2: `handleClaudeOrganizationsFetch` has zero test coverage

Found by the `lo-db60` (TEST-1) worker while repairing vacuous tests, and reported
as a genuine gap **outside** its seven assigned findings.

## The gap

`src/extension/background/service-worker.ts`'s `handleClaudeOrganizationsFetch` —
the sibling of `fetch_claude_api_data` — is unreachable from any test.

Its sibling **is** well covered: commit `d3ea235` added a handler-capturing
`chrome.runtime.onMessage` mock plus positive/negative UUID-validation cases, and
SEC-1 (#203) added UUID validation before the credentialed fetch. So the harness to
test this already exists — the organizations handler simply was never wired into it.

## Why it matters

This is a **credentialed** `claude.ai` fetch from the service worker. It is exactly
the kind of path where an untested branch is expensive: a regression would either
break Claude organization discovery silently, or loosen validation on a request that
carries the user's cookies.

## What to do

Reuse the existing handler-capturing mock in
`tests/unit/extension/background/service-worker.test.ts`. Cover at minimum:
- the happy path (a well-formed request reaches `fetch` with the expected URL);
- a malformed/absent payload being rejected **before** any fetch;
- a non-OK response surfacing as a failure rather than a silent empty result
  (TYPE-1 / #209 established that failures must never be reported as success).

Check whether this handler validates its inputs the way `fetch_claude_api_data` now
does after #203. **If it does not, that is a real defect, not just a coverage gap —
report it and fix it.**

## Working rule

A test that cannot fail is worse than no test. Prove each new case fails when the
behaviour it asserts is broken, and say so in the PR.

## Acceptance gate

`handleClaudeOrganizationsFetch` is exercised by tests that provably fail when it
misbehaves.

```bash
pnpm test:run tests/unit/extension/background/ && pnpm lint && pnpm format:check && pnpm typecheck
```

## Location
`src/extension/background/service-worker.ts`,
`tests/unit/extension/background/service-worker.test.ts`
