# Payload: lo-aee0 — Keyboard shortcut does nothing

## Acceptance gate

**Gate**: pressing the registered shortcut on a supported page performs an export.


Prose-only gate — verified by worker judgment, no script to run.

`src/extension/background/service-worker.ts:288-302` sends `{type:'show_export_dialog'}` on the command; `content-script.ts`'s `onMessage` listener has no branch for that type, so the message is dropped silently. `manifests/manifest.base.json:39-47` registers only `Ctrl+Shift+E` (`export-conversation`) — the `Ctrl+Shift+S` and `Ctrl+Shift+P` shortcuts that README and `docs/usage.md` advertise do not exist at all (that doc side is `lo-5cda`).

Decide: either handle `show_export_dialog` in the content script, or send a message type it already handles. Do not add UI for a dialog that does not exist.
