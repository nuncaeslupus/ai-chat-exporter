# Payload: lo-ce4b — Delete the dead trees

**Gate**: `pnpm build` and `pnpm test:run` green after deletion; `grep -r` finds no references to the removed symbols.

## Confirmed dead (verified by grep, zero importers)

- `src/ui/**` — 19 files, ~2,717 lines: ButtonInjector, ExportButton, PrintButton, FormatDropdown, SelectionPanel, Toast, ConfirmationModal, themes. Nothing in `src/extension/` imports any of it; the real UI is hand-built DOM inside `content-script.ts` and `popup.ts`. An abandoned parallel UI rewrite.
- `src/core/exporters/html-pdf-exporter.ts` — 314 lines, zero references, not in the registry. Also holds the repo's worst injection sink (`contentDiv.innerHTML = content` into the **live page** at line 171) — dead today, a trap if anyone ever wires it up. Deleting it removes the hazard.
- `src/core/exporters/md-exporter.ts` + `tests/unit/core/exporters/md-exporter.test.ts` — superseded by `StructuredMarkdownExporter`, which is what `exporters/index.ts:26` actually registers for `'md'`.
- `src/extension/background/service-worker.ts:58-70` — relay for `export_conversation`/`print_conversation` messages no caller ever sends.

## Do NOT delete

`src/core/services/selection-service.ts` and its tests. It is unwired, not dead — task `lo-adf1` connects it. `src/ui/components/selection-panel/` is part of the dead UI tree, but check whether `lo-adf1` wants to revive it before deleting; coordinate rather than guess.

## Context

~3,200 lines. Deleting `md-exporter.ts` drops 30-ish passing tests — that is fine, they were testing a superseded implementation, but say so in the PR body so the count drop is not read as a regression.
