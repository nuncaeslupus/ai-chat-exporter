# Payload: lo-adf1 — Q&A selection UI

## Acceptance gate

**Gate**: deselecting a pair in the UI produces an export containing only the selected pairs.


Prose-only gate — verified by worker judgment, no script to run.

## Tests

- `export includes only pairs with selected === true`
- `select-all / select-none toggle every pair`

## References

- `src/core/services/selection-service.ts` + `tests/unit/core/services/selection-service.test.ts` — the service exists and is tested; only the UI is missing
- `src/core/types/conversation.ts` — `QAPair.selected`, already defaulted to `true` by every parser
- `docs/dev/development-plan.md` — "Selection Service" is High Priority #2

## Context

The data layer is done. This task is the injected in-page controls (or popup list) that flip `selected`, nothing more.
