# SEC-3: scope the Deep Research relay's `postMessage` targetOrigin

Split out of `lo-5ebc` (SEC-2, merged as #212). **The SEC-2 worker built this fix,
proved it RED/GREEN, then deliberately reverted it** — read why before starting.

## The finding, and why the earlier refutation was incomplete

`src/extension/content/deep-research-frame.ts` posts the captured report to its
parent with a wildcard target origin:

```ts
window.parent.postMessage(createDeepResearchFrameMessage(text), '*');
```

The review's adversarial verifier **refuted** this, on the grounds that the
receiving side validates `event.origin` against
`^https://[a-z0-9-]+\.web-sandbox\.oaiusercontent\.com$`.

The SEC-2 worker disagreed, and its reasoning is sound: **origin validation on the
receiver protects the parent from a spoofed sender; it does nothing to stop the
sandbox frame from leaking the report to whatever origin happens to own
`window.parent`.** Those are opposite directions of trust. The refutation answered
a different question than the finding asked.

Both agree the trigger is **unproven** — it requires the sandbox frame to be
embedded by something other than ChatGPT — so this is one-way hardening rather than
a demonstrated exploit. Priority is set accordingly.

## Why it was not landed with #212

Scoping the target origin necessarily changes the observable `postMessage` call
shape (target origin, and possibly call count). That breaks roughly **10
assertions** in `tests/unit/extension/content/deep-research-frame.test.ts` — a file
outside SEC-2's assigned scope and, at the time, plausibly mid-edit by the
concurrent vacuous-test-repair worker (`lo-db60`, TEST-1).

Declining to land it was correct: a coordination conflict, not a technical one.

## What to do

**Check `lo-db60` (TEST-1) has landed first.** If that pass rewrote
`deep-research-frame.test.ts`, rebase on it rather than fighting it.

Then implement what SEC-2 already validated:
- A `CHATGPT_PARENT_ORIGINS` allowlist (the ChatGPT hosts the manifest already
  declares — `https://chatgpt.com` and `https://chat.openai.com`).
- A scoped-post helper that posts once per allowed origin instead of once with `'*'`.
- Update the ~10 affected assertions in `deep-research-frame.test.ts` to the new call
  shape. **Do not weaken them** — they should assert the target origin is now
  specific, which is stronger than what they assert today.

## Must not regress

The relay is the only path by which a ChatGPT Deep Research report reaches an
export — #194 (capture) and #201 (HTML fidelity) both depend on it, and #198 was a
revert caused by breaking exactly this path. If a scoped post fails to reach the
parent, the report silently falls back to the placeholder. **Verify the relay still
delivers**, and note that the live-page behaviour cannot be proven by a bash block:
state clearly in the PR that owner verification is outstanding.

## Acceptance gate

The report still reaches the parent and the export, and the post is no longer sent
with `'*'`.

```bash
pnpm test:run && pnpm lint && pnpm format:check && pnpm typecheck
```

## Tests
Assert the post targets a specific allowed origin (not `'*'`), that a report still
round-trips to the parent handler, and that the existing origin validation on the
receiving side is unchanged. Prove the target-origin assertion fails before the fix.

## Location
`src/extension/content/deep-research-frame.ts`,
`src/shared/deep-research-relay.ts` (if the allowlist belongs there),
`tests/unit/extension/content/deep-research-frame.test.ts`
