# Selector-drift safety net — design

**Date:** 2026-07-29
**Status:** approved, ready for an implementation plan

## Problem

The extension scrapes three chat products it does not control. When any of them
changes its DOM, the parser degrades **silently** — no error, no warning, just
less output. Three real cases from the 2026-07-28/29 session:

| Case | Signature | How long it went unnoticed |
| --- | --- | --- |
| Claude `conversationContainer` (`overflow-y-scroll` → `overflow-y-auto`) | `canParse()` returned false — the parser never ran at all | unknown; found only by capture |
| Gemini `conversationTitle` | matched 0 elements, fell back to `'Gemini Conversation'` | since January |
| ChatGPT Deep Research | **parse succeeded**; the answer came out as the sr-only label `ChatGPT said:` | until a user reported a bad export |

The third case is the reason detection cannot be selector-based alone: nothing
missed, nothing errored, and the output was structurally well-formed garbage.

## Goals

1. Notice drift **at parse time**, on the user's machine.
2. Tell the user plainly that the export may be incomplete, without blocking it.
3. Let the user optionally hand the maintainer a report that is useful enough to
   fix the selector, and that provably contains no conversation content.

## Non-goals

- **No telemetry, no relay, no server.** Nothing is transmitted by the extension.
  A relay may be revisited if reports never materialise; the payload is designed
  so that adding one later is a single `send()` function, not a redesign.
- **No conversation content in the report, not even opt-in.** Rejected during
  design: a warned checkbox still gets clicked through, and the maintainer needs
  structure, not prose — all three cases above were diagnosed without reading a
  word of conversation.
- **No modal and no auto-opened tab.** Drift is frequent enough that anything
  demanding attention trains users to dismiss it.
- No blocking of export. A degraded export is usually still wanted.

## Architecture

Four units with one job each.

### 1. `SelectorHealth` — did the selectors match?

Each parser declares which of its `SelectorSet` keys are **required** (the parse
is meaningless without them) versus **optional** (a widget that may legitimately
be absent). After a parse, `BaseParser` runs each declared selector against the
document and records a match count.

- Required selector with 0 matches → a drift finding.
- Optional selector with 0 matches → recorded, never a finding on its own. This
  is the `webSearchFoo` lesson: absent widget and dead selector look identical,
  and only the required set can distinguish "broken" from "not present".

Output: `{ key, selector, matched }[]`.

### 2. `OutputSanity` — does the result look like a conversation?

Rules evaluated against the parsed result, extending the existing
`collectWarnings()`:

| Rule | Fires when |
| --- | --- |
| `no-pairs` | 0 pairs, yet ≥1 turn container is present in the DOM |
| `empty-answer` | an answer's content is under 20 characters |
| `chrome-as-content` | an answer equals a known UI string (`ChatGPT said:`, `You said:`, per-platform list) |
| `no-question` | a pair has an answer but no question, or vice versa |

`chrome-as-content` exists because that is precisely how the ChatGPT case
presented, and a length check alone would not have caught a 13-character label.

### 3. `SkeletonBuilder` — a structural report that cannot leak

Walks from the conversation container (or `document.body` when `canParse()` is
false, since that is the case where we know least), depth-limited, and emits:

- element tag names
- `class` attribute values
- `data-*` and ARIA attribute **names**
- attribute **values only from a strict safelist** of structural attributes with
  known-safe vocabularies: `data-turn`, `data-message-author-role`,
  `data-is-streaming`, `role`, `type`
- every text node replaced by `text(N)` where N is its character count

**Attribute values are excluded by default and safelisted in.** The inverse
(exclude a denylist) is unsafe: `aria-label="Artifact panel: <conversation
title>"` and `data-turn-id="<uuid>"` both carry identifying data, and the next
one is unknowable.

Bounded at 500 nodes / 32 KB with an explicit `…elided N nodes` marker, so a long
conversation cannot produce an unreadable or unsendable report.

Example output:

```
main#main
  div[data-testid][data-turn="user"]
    h4.sr-only text(9)
    div.whitespace-pre-wrap text(121)
  div[data-testid][data-turn="assistant"]
    h4.sr-only text(13)
    iframe[title][sandbox] text(0)
```

### 4. `DriftReport` — assemble, fingerprint, present

Combines the above with: extension version, platform id, browser, UTC date, the
failing selector keys, and the failing sanity rule ids.

**Fingerprint** = short hash of `platform + extensionVersion + sorted(failing
selector keys) + sorted(failing rule ids)`. It is the report's title, so
duplicates collapse visually in a tracker, and it is the suppression key.

## Data flow

```
parse() ─┬─> SelectorHealth ─┐
         └─> OutputSanity ───┴─> DriftReport ─> ParseResult.drift?
                                                     │
                    popup renders amber row ─────────┘
                                                     │
                       user opens `report` view ─> SkeletonBuilder (lazy)
                                                     │
                                        Copy report / Copy & report
```

The skeleton is built **only when the user opens the report view** — it is
pointless work on every parse, and building it lazily means a user who never
opens it never has one in memory.

## UI

Two surfaces, both already built by the redesign:

- **Ready view**: a compact amber row above the action bar, the same treatment as
  R7's "no pairs selected" warning. Non-blocking.
- **Post-export warning state**: the existing state that already keeps the popup
  open when a response carries `warning`.

Tapping either opens a **new `report` view** — the R1 router accepts a new view
with no router change — laid out in the same three bands as the pair chooser:
header with back, scrollable monospace preview in the fixed 320 px body, footer
with the actions.

Two actions:

- **Copy report** — `navigator.clipboard.writeText()` runs in the popup, so the
  popup **stays open** and the button confirms inline. Nothing is transmitted.
- **Copy & report** — copies, then opens the issue tracker in a tab. The popup
  closes at that point, which is acceptable because it is the final step: the
  payload is on the clipboard and the user pastes it into whatever they prefer —
  a GitHub issue, an email, a store review.

**The preview is byte-identical to what is copied.** Not a summary of it. This is
what makes "you can see nothing else is sent" verifiable rather than a promise.

### Suppression

A fingerprint that has been dismissed or copied is not raised again. Stored in
`chrome.storage.local` keyed by fingerprint, which already contains the extension
version — so shipping a fix restores the prompt automatically without a migration
or a cleanup job.

## Privacy invariants

1. The extension transmits nothing. Ever. Both actions are clipboard + tab-open.
2. The skeleton contains no text-node content and no non-safelisted attribute
   value.
3. `docs/PRIVACY.md` needs **no change**: "your conversations never leave your
   browser. We have no server" stays literally true.

Invariant 2 gets a dedicated test, described below, because it is the one a
future refactor could quietly break.

## Error handling

- Every stage is best-effort. A throw in `SelectorHealth`, `OutputSanity` or
  `SkeletonBuilder` is caught and degrades to no drift finding — **the safety net
  must never break an export.**
- Clipboard write failure surfaces inline in the report view ("couldn't copy —
  select the text above") rather than silently doing nothing.
- If the skeleton exceeds its cap, it is truncated with the elision marker; it is
  never dropped.

## Testing

| Test | Proves |
| --- | --- |
| **Leak property test** — build a skeleton from a fixture seeded with distinctive strings; assert **none** appear in the output | invariant 2, the one that matters |
| Each of the three real 2026-07 cases, as fixtures, produces a finding | the net catches what it was built for |
| A healthy plain conversation produces **no** finding | no false positives — the failure mode that kills safety nets |
| An absent optional widget produces no finding | "absent" ≠ "broken" |
| Same breakage → same fingerprint; different breakage → different | suppression and dedup |
| A throwing detector still yields a successful export | best-effort guarantee |
| Locale key parity across all 7 bundles | enforced by the existing suite |

## i18n

All new strings via `getMessage()` with keys in all seven locales. The report
**body** stays in English regardless of UI locale — it is a bug report read by
one maintainer, and a localised payload would be worse for its only reader.

## Deferred

- A relay for a true one-click Send, if reports do not arrive by other means.
- Reporting drift from the content script's context (currently the popup is the
  only surface; a context-menu export that degrades has nowhere to show this).
