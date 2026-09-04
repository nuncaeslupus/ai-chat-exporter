---
id: lo-e6b9
title: "R3: popup format menu — floating over main, keyboard and outside-click dismissal"
priority: 7
deps: ["lo-a748"]
workspace: "POPUP"
tags: ["redesign"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/117
---

**Spec: `docs/design/popup-redesign.md` § "2. Menú de formatos"**.

## Acceptance gate

**Gate**: the chevron opens a floating menu of the six formats anchored to the
button; choosing one persists it, relabels the button and updates the print
button's enabled state; `Esc`, an outside click or a choice all close it.

```bash
pnpm lint && pnpm typecheck && pnpm test:run && pnpm build
```

## Work

Floating panel (`position:absolute; left:14px; right:14px; bottom:76px;
max-height:180px`), not a full screen. Six rows of 31 px **with `flex:none`** —
the spec calls this out because without it they collapse. Selected row tinted,
checked, and scrolled into view on open. Content behind dims to `.35`, the
button's right half marks and its chevron rotates 180°.

Persist through the same channel the popup already uses for
`lastExportFormat` — do not introduce a second one.

## Tests

jsdom: open/close via chevron, `Esc` and outside click; selecting a format
persists it, updates the button label and toggles print for DOCX; the selected
row is the one marked on reopen.

## Location

`src/extension/popup/popup.html`, `popup.css`, `popup.ts`, `_locales/*/messages.json`.
