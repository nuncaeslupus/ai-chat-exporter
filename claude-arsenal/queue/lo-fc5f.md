# Payload: lo-fc5f — C-7: export to Google Drive

## Acceptance gate

**Gate**: an export can be sent to the user's Google Drive, and the privacy
documentation matches the new behaviour.

```bash
pnpm typecheck && pnpm test:run && pnpm build
```

## The request

The project owner (2026-07-28): *"later we could also add something like adding to
Google Drive."* Explicitly deferred — **do not start before the consistency work
(`C-1`) has landed.**

## Why this is not a small feature

`docs/PRIVACY.md` currently documents an audited **zero-remote-call** inventory —
that claim was corrected and pinned deliberately in PRs #49/#50, and "no remote
subresource in exported HTML" is pinned by test since PR #54. A Drive upload would
be **the first outbound network call this extension ever makes**. That means:

- OAuth via `chrome.identity`, plus a new host permission and a new OAuth scope.
- `docs/PRIVACY.md` must be updated in the SAME change — it would otherwise assert
  something false.
- Both store listings (`docs/store-listings/chrome-web-store-*.txt` and
  `firefox-addons-*.txt`) claim no data leaves the device. They must change too.
- Chrome Web Store and AMO both re-review on a new OAuth scope. Expect a real
  review cycle, not an instant publish.
- Firefox has no `chrome.identity` equivalent with the same shape — decide whether
  this is Chrome-only and say so, rather than shipping a button that fails silently
  on Firefox.

## Work

Scope this properly before building: confirm with the owner whether Drive is
Chrome-only, and whether the upload is "save a copy" or a full sync. Then implement
the narrowest version that works, with the privacy and listing updates in the same
PR.
