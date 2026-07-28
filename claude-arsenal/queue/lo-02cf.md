# Payload: lo-02cf — Contrast failures

## Acceptance gate

**Gate**: every text/background pair in the popup and the exported HTML meets WCAG AA (4.5:1 normal text, 3:1 large).


Prose-only gate — verified by worker judgment, no script to run.

`src/extension/popup/popup.css:279` and several pairs in the exported HTML template fall below 4.5:1. Measure each pair, then fix by adjusting the palette — not by enlarging text to qualify for the 3:1 large-text threshold.

Accessibility basics are not a nice-to-have here: a low-contrast status line is the one piece of UI a user needs to read when an export fails.

Pairs naturally with `lo-2420` (aria-live + hardcoded strings) and `lo-934c` (dark mode) — same files, one pass.
