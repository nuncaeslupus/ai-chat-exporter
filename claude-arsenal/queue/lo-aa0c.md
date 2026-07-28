# Payload: lo-aa0c — R6: filename builder

**Spec: `docs/design/popup-redesign.md` § "5. Submenú Nombre del archivo"**.
The largest new feature in the redesign: the filename stops being a fixed
pattern and becomes an ordered list of pieces the user composes.

## Acceptance gate

**Gate**: a filename template is composed from draggable pieces, persists in
`StorageService`, drives the actual exported filename, and the live preview in
the footer matches the file that is written — byte for byte.

```bash
pnpm lint && pnpm typecheck && pnpm test:run && pnpm build
```

## Decide first

`filenameTemplate` is a **new persisted preference** and therefore a
compatibility surface. Before building the UI, settle and record:

- The stored shape — an ordered array of piece descriptors
  (`platform | model | title | date | time | pairCount | literal`) is the
  obvious one; a template string re-introduces parsing.
- What existing users get on upgrade: absent preference must reproduce **today's**
  filename exactly. Prove that with a test against the current naming.
- Where the template is rendered into a name. It must be **one** function, shared
  by the popup preview and the export path — two implementations will drift, and
  the gate is precisely that they agree.

## Work

- Pieces field with white chips, remove buttons, literal `_` separators between
  pieces, insertion caret, drag to reorder.
- Add-chips for pieces not currently used.
- `Por defecto` link restores the default template.
- Footer: file icon + the real resulting name in monospace + `Hecho`.
- Sanitisation stays where it already lives (`base-exporter.ts`) — the template
  produces a name, the exporter still makes it filesystem-safe. Do not duplicate
  that logic.

## Tests

- No stored template → filename identical to today's (regression lock).
- Preview string equals the name the export path produces, for several templates
  including a literal piece and a missing-model conversation.
- Reordering pieces reorders the output; removing all pieces cannot yield an
  empty or extension-only filename.

## Location

`src/extension/popup/*`, `src/shared/storage.ts`, `src/shared/messages.ts`,
the shared filename function (new, next to `base-exporter.ts`),
`_locales/*/messages.json`.
