---
id: lo-c7ad
title: "A11Y-2: print-window code blocks are not keyboard-focusable (WCAG 2.1.1)"
priority: 5
workspace: "ACCESSIBILITY"
tags: ["a11y"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/224
---

Flagged by the `lo-4faf` (A11Y-1) worker as out of its own scope, and seeded per the
divergence rule. A11Y-1 fixed this for the **saved HTML exporter**; the **print
window** path was left with the same defect.

## What is expected

A scrollable code block must be reachable and scrollable via keyboard — axe rule
`scrollable-region-focusable`, WCAG 2.1.1. This is exactly the fix already applied
to the saved HTML exporter's `<pre>` elements in A11Y-1 (#216), so the expected
behaviour is already established in this codebase.

## What the code does

`renderMarkdownToCleanHtml()`'s marked.js code renderer emits:

```html
<pre><code class="hljs language-${...}">...</code></pre>
```

with **no `tabindex`**, so a horizontally-overflowing code block in the print window
has no focusable scroll target.

## Fix location

`src/extension/content/content-script.ts:487`

Mirror what A11Y-1 did for the HTML exporter rather than inventing a second
approach — if both paths need a focusable `<pre>`, the attribute belongs wherever
both can share it.

## Failure scenario

A keyboard-only user prints a Markdown-format conversation containing a long code
line. The print preview renders the code block clipped to its container width; Tab
skips the `<pre>` entirely, so there is no way to scroll it and reach the rest of
the line.

## Acceptance gate

The print-window code block carries a focusable scroll target, and a test asserts
it — not merely that the attribute string appears, but that the rendered `<pre>`
is focusable.

```bash
pnpm test:run tests/unit/accessibility/ tests/unit/extension/ && pnpm lint && pnpm typecheck
```

## Tests

- A test over `renderMarkdownToCleanHtml()` output asserting the emitted `<pre>`
  is keyboard-focusable. Confirm it fails before the fix.
- Keep the existing saved-HTML-exporter assertion from #216 green, so the two
  paths cannot drift apart again.

## Location

`src/extension/content/content-script.ts:487`
