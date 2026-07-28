# Widget coverage matrix

A parser is built against one conversation and silently drops every widget that
conversation did not contain. This reference is the antidote: enumerate what the
platform can render, capture one conversation per widget class, and track each one
through to a verified export.

Part of the parser-generator skill.

## Why a matrix, not a checklist

Content types (tables, code, maths) are generic across platforms. **Widgets** are
product features — deep research, canvas, artifacts, thinking panels — and each one
wraps its content in a different DOM shape. A parser that handles every content type
still returns nothing for a widget whose container it does not recognise.

The failure is silent by construction. `GeminiParser.extractQAPairs` iterates
`.conversation-container` and does:

```ts
const questionElement = container.querySelector(this.selectors.userMessage);
const answerElement = container.querySelector(this.selectors.messageContent);
if (!questionElement || !answerElement) {
  return;   // skips the WHOLE turn
}
```

A Deep Research turn has no `message-content .markdown`, so the guard fires and the
entire turn disappears — the user's question along with it. No error, no empty
string, no test failure. Every per-turn loop with a `continue`/`return` guard has
this property: **a missing widget selector deletes the question too.**

Rule: a turn that matches the container selector but not the content selector is a
*finding*, not a skip. Log it, count it, or fall back to a wider content root — never
drop the turn silently.

## The matrix

One row per widget class per platform. A row is not done until the last column is.

| widget | how to produce one | capture file | fixture test | export verified |
|---|---|---|---|---|
| … | prompt or UI action that renders it | `tests/fixtures/dom-snapshots/<platform>/<widget>-YYYY-MM.html` | test name | which of the 6 formats were opened and checked |

Fill "export verified" by opening the exported file, not by asserting on the parsed
`Conversation`. A widget can survive parsing and still vanish in three of six
exporters — see "Extending the data model" in the content type checklist.

## Seed lists — re-derive these, do not trust them

The lists below are what existed at the 2026-07 survey. Chatbot products ship
weekly; treat this as a starting prompt for your own enumeration, not as the
specification. **Before using it, walk the live product's own UI** — the model
picker, the tools and attachment menus, the onboarding tour — and add everything
found there. A widget missing from this table is exactly the widget the parser will
drop.

**ChatGPT**

- canvas / textdoc
- deep research
- image generation
- web-search citation pills
- code artifacts
- CodeMirror-rendered code blocks
- KaTeX maths (three representations — see the content type checklist)
- tables
- `sr-only` speaker labels
- file uploads

**Claude**

- artifacts: image, react, document, diagram, code (five distinct render paths)
- web search with result lists
- uploaded images
- thinking panel

**Gemini**

- deep research
- `immersive-entry-chip` artifacts
- `model-thoughts` thinking panel
- KaTeX — `.katex-html` only, no MathML or LaTeX-annotation fallback
- `cdk-visually-hidden` chrome (Angular's visually-hidden convention)

## Producing a capture per widget

Widgets are gated behind account tier, model choice and rollout flags. Some will be
unreachable; record that rather than concluding the widget does not exist. The
2026-07 ChatGPT survey could not reach Canvas or Deep Research on a Free-tier
account, and "unreachable on my account" was quietly read as "not a concern".

For each reachable widget, in one purpose-made conversation per widget class:

1. Trigger the widget with invented data — never a real conversation, since captures
   are committed to a public repo.
2. Wait for generation to finish: the stop control gone *and* text length stable
   across several polls.
3. Capture `main.outerHTML` (see the live verification reference).
4. Probe match counts for the selectors the parser will use, scoped to that turn.
5. Commit the capture as a fixture and write the test that fails without the fix.
6. Export all six formats and open them.

One widget per capture file matters: a single mega-fixture makes a failing assertion
ambiguous, and re-capturing after a redesign then means reproducing every widget in
one sitting.

## Auditing an existing parser

Run the matrix backwards. For each widget class, grep the parser and its
`SelectorSet` for a handler. A widget with no selector, no branch and no test is
being dropped right now — check a live conversation before assuming otherwise.
