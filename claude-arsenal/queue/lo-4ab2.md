# Payload: D-18 — every timestamp in an export is fabricated

Reported by the repo owner, 2026-07-29, from a real Gemini PDF export:

> *"The header shows that it has been done today (actually, now), with times
> before each turn saying the same, but the conversation was done yesterday. Also,
> it shows UTC time instead of my current time."*

## Acceptance gate

**Gate**: an export never presents a time it did not obtain from the conversation.
Whatever is shown is either the real message time or is unambiguously labelled as
the export time.

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test:run && pnpm build
```

## Root cause — one line

`src/core/parsers/base-parser.ts:138` sets `timestamp: new Date()` for **every**
message. No parser overrides it. So every "message time" in every export is the
moment of capture.

## Why it cannot be fixed by "extract the real timestamp instead"

**The DOM does not contain per-message times.** Measured across the three fresh
captures in `tmp/examples/` (2026-07-29):

| capture | `datetime=` | `data-*time*=` | ISO strings | `title="…HH:MM…"` |
| --- | --- | --- | --- | --- |
| `gemini-current.html` (4.3 MB) | none | none | none | none |
| `claude-artifact.html` | none | `data-build-timestamp` (the app build) | none | none |
| `claude-deep-research.html` | none | `data-build-timestamp` | none | none |

So this is not a selector task. **The data is not there**, and the current code
invents a plausible-looking substitute — which is worse than showing nothing,
because a reader cannot tell it is invented.

## The blast radius is larger than the reported symptom

Three shipped features are built on this fabricated value:

1. **Per-message times** (`includeTimestamps`) — always the export moment.
2. **The conversation date range** in the export header (`lo-3900`, PR #110) —
   derived from message timestamps, so it is always "today", for a conversation
   of any age.
3. **Day separators** (`lo-3900`) — emitted on a date change that, by
   construction, can never happen. The feature has never fired in real use.

The popup's meta line (`N pairs · date range`, PR #111) reads the same values.

## Second, separate defect: UTC

`formatTimestamp` and `formatTime` (`base-exporter.ts:92,103`) use
`toISOString()`, so every stamp renders in UTC regardless of the reader's zone.
This was **deliberate** — the comment explains that one clock keeps day separators
consistent with the times they imply — but a user in UTC+2 reading "13:00" for a
15:00 conversation is simply being shown the wrong time. Local time with a stable
zone for the whole document achieves the same internal consistency.

## Decide, and record the decision

Options, roughly in order of honesty:

1. **Stop emitting per-message times.** Drop the `includeTimestamps` option, keep
   a single "Exported: <local datetime>" line in the header. Truthful, smallest,
   and removes two features that never worked.
2. **Keep the option, relabel what it shows** — e.g. a per-message *ordinal*
   rather than a clock time, and an explicit "captured at" for the export.
3. **Extract real times where a platform does expose them.** No evidence any of
   the three does; ChatGPT is uncaptured, so it is unknown rather than ruled out.
   Do not build this on hope — if a capture shows real times, that is a separate
   task.

Whichever is chosen, **fix the UTC display for anything that survives**, and make
the date range and day separators either correct or gone. Do not leave a feature
that only works in tests.

## Tests

Whatever survives must be asserted against a conversation whose messages carry
*different* times from the export moment — the current tests all pass with
fabricated stamps, which is why nobody noticed.

## Location

`src/core/parsers/base-parser.ts`, `src/core/exporters/base-exporter.ts`,
`src/extension/popup/popup.ts` (meta line), `_locales/*` if an option is removed.
