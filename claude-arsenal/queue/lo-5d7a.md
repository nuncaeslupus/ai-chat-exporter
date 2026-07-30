# D-26: the degraded-export warning is unreadable, untranslated, and its Retry is a lie

Three defects in one card, all reported from live use on 2026-07-30 (Spanish UI).
The user's words: *"The message can't be seen complete, it is in English even in
the Spanish version and there is no clear solution: clicking Reintentar does
exactly the same."*

## 1. It is English in every locale

`src/extension/content/content-script.ts:223-225` builds the text as a hardcoded
English literal in the **content script**, then passes it to the popup as raw
text. Every other popup string goes through `getMessage()`; this one bypasses
i18n completely.

Fix: the content script must return a **message key** (plus any substitution
values), not prose. The popup resolves it with `getMessage()`. Add the key to
all seven `_locales/*/messages.json` bundles **in the same commit** — a key
declared without a consumer, or a consumer without the key, both fail
`tests/unit/extension/locales.test.ts`.

## 2. It is clipped at two lines, so it cannot be read

`src/extension/popup/popup.css:1599` puts `-webkit-line-clamp: 2` on
`.warning-card-detail`. The real message runs to three-plus lines, so the end is
cut off. The full text lives only in the element's `title` — a hover tooltip,
which in a 420px popup is close to undiscoverable.

Fix: let the card show the whole message. It sits in the fixed-height body, so
if a long reason ever needs it, let that area scroll rather than clamp. Do not
"fix" this by shortening the message until it happens to fit two lines.

## 3. Retry cannot work, but is offered anyway

`src/extension/popup/popup.ts:536` wires the button to re-run `handleExport`
with the same format. When the cause is persistent — and a missing organization
ID is persistent — retrying fails identically every time. That is what the user
hit.

Fix: only offer Retry for causes that could plausibly change on a second
attempt. For a persistent one, offer what actually helps: say what failed and
what the user can do. If nothing can be done in-product, say that honestly
rather than presenting a dead button. Route this off the reason the content
script now returns (defect 1), not off string matching.

## Also worth correcting

The message says artifacts were dropped. Enrichment also supplies Claude's
**real per-message timestamps** (`created_at`), so a failure silently loses
those too — see D-25 (`lo-4393`). Whatever wording lands should not claim less than
what was actually lost.

## Acceptance gate

The warning renders fully (not clamped), reads in the UI language, and no dead
Retry is offered for a cause that cannot change.

```bash
pnpm vitest run tests/unit/extension/ tests/unit/accessibility/ && pnpm typecheck && pnpm lint && pnpm format:check
```

## Tests

`tests/unit/extension/popup/` — assert the detail element carries no
line-clamp; assert the rendered text comes from `getMessage()` (a locale key,
not a literal); assert Retry is absent/disabled for a persistent cause and
present for a transient one. Plus locale parity for the new key(s).

## Location

`src/extension/content/content-script.ts`, `src/extension/popup/popup.ts`,
`src/extension/popup/popup.css`, `_locales/*/messages.json`
