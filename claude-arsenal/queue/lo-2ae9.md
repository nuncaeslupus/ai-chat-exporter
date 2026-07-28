# Payload: lo-2ae9 — C-4: three-step font-size option

## Acceptance gate

**Gate**: choosing compact / normal / large in the popup measurably changes the
page count of a pdf and docx export of the same conversation.

```bash
pnpm typecheck && pnpm test:run && pnpm build
```

## The request

The project owner (2026-07-28): *"we could give the option to use three font sizes
(not a full font type and size), so we can reduce page number."*

Note the deliberate constraint: **three steps, not a free font picker.** Do not
build a font-family selector or a numeric size input.

## Depends on C-1

`C-1` (`lo-82e7`) creates the shared token module. This task multiplies that scale
by a factor per step — it is a small change ON TOP of the token layer, and a large
tangled one without it. Do not start until `C-1` has landed.

## Work

- A `fontScale: 'compact' | 'normal' | 'large'` export option, persisted through
  `StorageService.getUserPreferences()` / `setUserPreferences()` like the existing
  `includeMetadata` / `includeTimestamps` prefs (`lo-f096`, PR #81 — follow that
  exact pattern; do not add a new storage mechanism).
- A three-way control in the popup. It must have a real accessible label and go
  through `getMessage()` with keys added to ALL 7 locale files under `_locales/`.
- Apply the scale in the token module so every format picks it up at once.

Scale the whole type ramp, not just body text — headings, code and metadata must
move together or the hierarchy inverts at the extremes.

## Tests

- Storage round-trips the setting.
- For pdf and docx: export the same fixture at `compact` and `large` and assert the
  page count actually differs (that is the user-facing point of the feature — an
  assertion on font size alone does not prove it).
- Locale key parity across all 7 files.
