# Payload: lo-db20 — the popup cannot talk to a page that has no content script

## Acceptance gate

**Gate**: opening the popup on a supported page whose content script is not
running recovers on its own — no console error, and the user is not asked to
reload unless recovery genuinely fails.

```bash
pnpm lint && pnpm typecheck && pnpm test:run && pnpm build
```

## The report

Hit live by the author, 2026-07-28:

```
Failed to check current page: Error: Could not establish connection. Receiving end does not exist.
  popup/popup.js:10 (checkCurrentPage)
```

## What actually happens

`PopupController.checkCurrentPage()` (`src/extension/popup/popup.ts`) calls
`chrome.tabs.sendMessage(tab.id, 'get_conversation')`. When no content script is
listening in that tab the call **rejects** — it does not resolve with an error
result — and the `catch` does two things: `console.error(…)` and switches to the
reload-needed state.

So the user-facing behaviour is not broken; the prompt to reload is shown. Two
things are wrong anyway:

1. **A routine condition is logged as an error.** The content script is absent
   every time the extension is installed, updated or reloaded while a chat tab is
   already open — normal, expected, and not an error. It is noise in exactly the
   place a real error would need to be visible.
2. **The recovery is manual when it need not be.** MV3 can inject the script:
   `chrome.scripting.executeScript({ target: { tabId }, files: [...] })`, then
   retry the message once. The reload state becomes the fallback for when that
   also fails, not the first answer.

## Decide first

`manifests/manifest.base.json` has `permissions: ["activeTab", "storage",
"contextMenus"]` — **no `scripting`**. Adding it is a manifest change and a store
re-review. Weigh that against the UX win and record the decision:

- With `scripting`: the popup self-heals; host permissions for the four chat
  domains are already granted, so no new install-time warning beyond what is
  shown today (verify this claim before relying on it).
- Without it: keep the reload state as the only path, but stop calling it an
  error — distinguish "not injected" (expected, `console.debug` or silent) from a
  genuine failure, and make the reload copy say *why*.

Either outcome is acceptable; a silent `console.error` on a normal condition is
not.

## Note

The redesign's R7 (`lo-18d4`) rebuilds the reload-needed **view**. This task owns
the **behaviour** behind it. Coordinate: whichever lands second rebases.

## Location

`src/extension/popup/popup.ts`, `manifests/manifest.base.json`,
`tests/unit/extension/popup/`.
