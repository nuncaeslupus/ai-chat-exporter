---
id: lo-fc5f
title: "C-7: Export to Google Drive"
priority: 2
deps: ["lo-82e7"]
workspace: "EXTENSION"
tags: ["design"]
---

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

## Reframed 2026-07-29 by the repo owner — this is a backup tool, not an export target

Direct guidance: *"let's ignore it for now. If we do it in the future, I'd prefer
to do it more as a backup tool, so you can decide which conversations to backup
(even all of them) in a document format or md or pdf or similar. It needs more
work."*

So the task as written — "add Drive as a seventh export destination" — is **the
wrong shape** and should not be built. The real feature is different in kind:

- **Scope is the conversation list, not the open conversation.** Select many, or
  all, rather than exporting the one on screen. Nothing in the extension currently
  enumerates conversations; that is the actual missing capability, and it is
  platform-specific (each of the three has its own history UI/API).
- **Format is an existing exporter**, per conversation — md, pdf, docx and the
  rest already work. The backup layer chooses a format and a destination; it does
  not need a new renderer.
- **Destination is open.** Drive was the original framing, but a local folder via
  the downloads API needs no OAuth, no third-party data flow and no privacy-policy
  change. Drive should be one destination among several, decided on its merits,
  not the premise.

**Blocked on design, not on effort.** Before any implementation task is seeded this
needs: how conversations are enumerated per platform, what incremental re-runs do
(skip existing? overwrite? date-stamp?), where credentials live if a remote
destination is chosen, and what `docs/PRIVACY.md` has to say — it currently states
nothing leaves the browser, which any remote destination makes false.

Leave at low priority until that design exists.
