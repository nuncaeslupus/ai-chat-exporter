---
id: lo-1c7d
title: "i18n: add metadataFieldDateRange to all 7 locales and drop the English fallback"
priority: 5
workspace: "EXPORTERS"
tags: ["redesign"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/133
---

## Acceptance gate

**Gate**: `metadataFieldDateRange` exists in all seven `_locales/*/messages.json`,
`getMetadataLabel` no longer carries an English fallback for it, and the export
header renders the localized label.

```bash
pnpm lint && pnpm typecheck && pnpm test:run
```

## Context

`lo-3900` (PR #110) added the conversation date range to every export header, but
could not touch `_locales/` — a concurrent worker owned those files. It shipped a
deliberate English fallback (`'Date range'`) in `src/core/exporters/base-exporter.ts`
rather than leak a raw key into the header, and marked it with a `ponytail:`
comment naming what to delete.

Find that comment, add the key to `ca`, `de`, `en`, `es`, `fr`, `it`, `pt`, and
remove the fallback so a missing key fails loudly instead of silently rendering
English.

## Location

`_locales/*/messages.json`, `src/core/exporters/base-exporter.ts`.
