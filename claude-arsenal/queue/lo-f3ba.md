# Payload: Unify the duplicated preferences definitions

## Acceptance gate

**Gate**: exactly one `UserPreferences` interface and one `DEFAULT_PREFERENCES`
constant exist in the codebase, the constant is typed by the interface, and a
field added to one without the other is a compile error.

```bash
pnpm typecheck && pnpm test:run && pnpm build
```

## The defect

Found by the `lo-5af6` worker (PR #89).

`UserPreferences` is declared **twice**, with different shapes:
- `src/shared/messages.ts:48` — the LIVE one (imported by `src/shared/storage.ts:6`)
- `src/core/types/config.ts:36` — **zero consumers**

`DEFAULT_PREFERENCES` is declared **twice**, with conflicting values:
- `src/shared/constants.ts:30` — the LIVE one (`storage.ts`, `service-worker.ts:319`).
  `defaultFormat: 'pdf'`. Fields: includeMetadata, includeTimestamps,
  includeCodeBlocks, filenameTemplate, defaultFormat, autoSelectAll.
- `src/core/types/config.ts:54` — **zero consumers**. `defaultFormat: 'md'`.
  Entirely different fields: rememberSelections, pdfDefaults, docxDefaults,
  showConfirmation. Re-exported via the barrel at `src/core/types/index.ts:75`,
  which is the only reason it looks alive.

Verified: grepping all of `src/` and `tests/` for consumers of the
`core/types/config.ts` pair returns nothing.

## Why it matters beyond tidiness

Two constants named `DEFAULT_PREFERENCES` disagreeing on the default export
format is a bug waiting for the first person who imports the wrong one from the
barrel — and the barrel is the ergonomic import path, so that is the one a
newcomer reaches for. The live pair is also **untyped**: `shared/constants.ts`'s
object has no `: UserPreferences` annotation, so it can drift from the interface
silently. That is how the two copies diverged in the first place.

## Work

1. Delete the dead `UserPreferences` and `DEFAULT_PREFERENCES` from
   `src/core/types/config.ts` and their barrel re-export in
   `src/core/types/index.ts`. **Check first whether the OTHER config exports in
   that file (`DEFAULT_PDF_OPTIONS`, `DEFAULT_DOCX_OPTIONS`,
   `DEFAULT_FILENAME_TEMPLATE`) are live** — they are referenced by the dead
   constant, so removing it may orphan them. Report which you kept and why.
2. Annotate the surviving `DEFAULT_PREFERENCES` as `: UserPreferences` so the two
   can never drift again without a compile error. Fix whatever that surfaces.
3. Do NOT change any default VALUE. `defaultFormat: 'pdf'` is what ships today;
   changing it is a product decision, not a refactor. If the annotation forces a
   value change, stop and report instead.

## Tests

- A test asserting `DEFAULT_PREFERENCES` satisfies `UserPreferences` (a typed
  assignment is enough — it fails at typecheck, which is the point).
- A test asserting the barrel no longer exports a second `DEFAULT_PREFERENCES`.
