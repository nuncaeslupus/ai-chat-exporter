---
name: parser-generator
description: Use whenever anything under src/core/parsers/ is being added or repaired — capturing a live DOM, deriving selectors, implementing a BaseParser subclass, and verifying live that every widget the chatbot renders survives into an export. Triggered by "add a parser for X", "support a new chatbot", "capture DOM selectors", "the parser stopped working", "exports come out empty", "deep research is missing from the export". Do NOT use for src/core/exporters/ work (see docs/dev/adding-exporters.md), nor for a parser change that touches no selector.
---

# parser-generator

Builds and repairs platform parsers for this extension: enumerate every widget the
chatbot can render, capture each one live, derive selectors that survive a redesign,
implement a `BaseParser` subclass, and prove in a real browser that the widget
reaches an exported file.

CANARY: parser-generator-loaded-2026-07-28-60d048f4-0d2567f35c16cbcd

## When to load

Load this skill when:

- Adding support for a new chatbot platform (Mistral, Grok, DeepSeek, …).
- A platform redesigned and an existing parser stopped extracting — exports are
  empty or a content type went missing.
- One widget (deep research, canvas, an artifact, a thinking panel) is absent from
  exports while the rest of the conversation is fine.
- Capturing a DOM snapshot to turn into a test fixture.
- Checking that a newly registered platform is actually reachable end to end.
- Reviewing a parser diff for selector fragility or missing widget coverage.

If the task is really about turning an already-parsed `Conversation` into a file
format, this is the wrong skill — that is exporter work.

## The two rules that matter most

**1. A passing test suite is no evidence that a parser works today.**

Fixtures are snapshots of a past DOM. In July 2026 ChatGPT renamed its turn wrapper
from `<article data-turn>` to `<section data-turn>`. The parser hardcoded `article`,
extracted **nothing** from every live conversation, and all 61 unit tests still
passed against a January fixture.

**2. One conversation is not the platform.**

A parser built against a single chat handles the widgets that chat happened to
contain and silently drops the rest. `GeminiParser` requires both a user-query node
and a `.markdown` content node in each container and returns early if either is
missing — so a Deep Research turn vanishes entirely, the question with it, with no
error and no failing test.

So the workflow starts at a live page and at a widget *list*, never at the existing
code and never at one conversation.

## Workflow

### 1. Enumerate the widgets before capturing anything

Build the per-platform matrix of widget classes the parser must survive — canvas,
deep research, artifacts, thinking panels, citations, uploads — and derive it from
the live product's own UI, not from memory or from a list in this repo. Seeds and
the matrix format: [widget coverage matrix](references/widget-coverage-matrix.md).

Then **capture one purpose-made conversation per widget class**. One widget per
capture file: a mega-fixture makes failures ambiguous and forces every widget to be
reproduced at once after the next redesign.

### 2. Drive the browser, do not just read the code

Use the Browser pane tools (`mcp__Claude_Browser__navigate`, `read_page`,
`get_page_text`, `javascript_tool`, `computer`) to open the conversation, trigger the
widget, wait for generation to finish, probe selectors, and capture `main.outerHTML`.
Recipes, timing traps and the capture snippet:
[live verification](references/live-verification.md).

Never capture a real user conversation — fixtures get committed to a public repo.
Use `main.outerHTML`, not `documentElement`: the sidebar carries every conversation
title in the account. Scan the saved file for personal identifiers, then analyse it
locally with grep rather than paging HTML back through the conversation.

### 3. Probe which selectors actually match

Before writing anything, run every candidate against the live page and record match
counts. Zero-match selectors are the defect; theorising about double-matches without
measuring wastes a session.

`pnpm probe` generates `dist-probe/selector-probe.js` for this: paste it into the
console and it reports a match count for **every** selector the parsers declare, the
class names of the page's real scroll containers, and a census of the `data-*`
attribute names actually in the DOM. It reads the selector values out of
`src/core/parsers/*/selectors.ts` at generation time, so it can never test a stale
transcription of them — which is the failure mode a hand-written probe has.

Hand-rolling one is still fine for a platform with no parser yet:

```js
const q = s => { try { return document.querySelectorAll(s).length } catch (e) { return 'ERR' } };
({ container: q('main#main'), turns: q('[data-turn]'), content: q('.markdown') })
```

Whichever you use, the output is counts and class names only — no message text — and
`pnpm probe` redacts every path segment of the URL it reports, so it is safe to paste
into an issue and safe to ask a *user* to run when the broken page is theirs and not
reachable from here. A probe you hand-roll carries whatever you put in it: if you add
the URL, redact it the same way, because a workspace slug or a username identifies a
person as surely as a session id does.

Scope every probe to one turn — `[...document.querySelectorAll('[data-turn="assistant"]')].pop()`
— then query inside it. A page-wide `querySelector` in a multi-turn document returns
the first match, which is rarely the intended one.

### 4. Choose selectors that survive a redesign

Ranked by durability:

1. `data-*` attributes carrying semantics (`data-message-author-role`, `data-turn`)
2. ARIA roles and semantic tags
3. Stable structural relationships

Never: tag names as identity (`article` to `section` broke everything), Tailwind
utility classes, or hashed CSS-module / CodeMirror class names
(`TyagGW_tableWrapper`, `ͼd`) which change every build.

### 5. Implement against the real `BaseParser`

`src/core/parsers/base-parser.ts`. A subclass supplies:

```ts
export class MyParser extends BaseParser {
  readonly platformInfo: PlatformInfo;            // id, name, urlPatterns
  readonly selectors: SelectorSet;                // from ./selectors.ts
  canParse(): boolean;
  getTitle(): string;
  getModel(): string | null;
  getButtonInjectionPoint(): HTMLElement | null;
  protected extractQAPairs(config: ParserConfig): QAPair[];   // the real work
}
```

Constructor is `(document: Document, config: Partial<ParserConfig> = {})`. Inherited
helpers worth using instead of reimplementing: `createMessage`, `createQAPair`,
`extractContent` (runs the shared cleanup), `buildConversation`, `generateId`,
`getUrl`.

**Every selector must come from the `SelectorSet`.** A selector inlined in parser
logic is a defect even when it currently works — it means a future repair applied to
`selectors.ts` silently does nothing. That is what made the ChatGPT break harder to
fix than it needed to be.

When a widget carries information no existing field can hold, **extend
`src/core/types/conversation.ts`** rather than flattening the widget into text —
flattening is irreversible, and no exporter can recover structure from a string.
Typed field vs `metadata`, and the mandatory per-exporter follow-through, are in the
[content type checklist](references/content-type-checklist.md).

### 6. Confirm the parser is actually reachable

Registration is not reachability. A correct, registered parser stayed dead because a
*second* hardcoded domain list gated it — `popup.ts`'s `checkCurrentPage` had
`gemini.google.com` commented out behind a stale TODO.

Grep every hardcoded platform/host list (`manifests/*.json`, the background service
worker, the popup, locales) and confirm the new platform appears in each, preferring
derivation from `parserRegistry` over another literal. Then load the build in a real
browser and confirm the popup recognises the page. See
[live verification](references/live-verification.md).

### 7. Prove it end to end

Write the fixture test, confirm it fails before the fix and passes after. A test
green *before* the fix is measuring something else — change the fixture until it
genuinely fails.

Then export the conversation in **all six formats** and open every file. A widget
can parse correctly and still vanish from five exporters. Finally return to the live
page and confirm the real thing works: the fixture only proves the absence of a
regression against the past.

### 8. Reconcile the count against the network truth

Both headline rules above describe the same failure: the parser drops something and
nothing complains. Steps 1-7 defend against that by enumerating widgets *by eye*,
which catches what you thought to look for. A HAR capture closes the rest, because
the transcript arrives over the network as JSON before the page renders any of it —
so the response body is an independent count of what the conversation actually
contains.

Load the `har` skill and reconcile. Two conditions have to hold before a number from
the capture means anything:

- **The response is actually there.** A capture can hold the transcript request with a
  null response, an empty body, or a body it cannot decode — a streamed or compressed
  response the recorder truncated. None of those is a count of zero; they are a capture
  that failed and has to be retaken. Check the body before comparing.
- **Both sides count the same thing.** The API's message array is not the parser's Q&A
  pairs: one pair spans two messages, and branches, edited turns, deleted turns and
  non-text records inflate the API side without owing the parser anything. Normalise to
  the same unit — active-branch messages on both sides, or pairs on both — before
  calling a difference a gap.

Once both hold, a residual gap is the bug, and you have it as a number rather than as a
suspicion. It is the only check here that does not depend on having anticipated the
widget.

The same capture answers what the DOM never renders — per-message timestamps, model
ids, edit history — which is where a parser has to go when the visible page simply
does not carry the field.

Be clear about what it does **not** do: **a HAR contains no DOM.** These are SPAs;
the markup is assembled client-side and never crosses the wire. Selector drift is
invisible in a capture, so step 3 stays the tool for that — the two are complements,
not alternatives.

The capture has to come from a browser logged in to the site. `capture_har.py` opens
a **fresh context by design** (no cookies, so a capture is safe to attach to an
issue), and a cloud session additionally cannot reach these hosts at all. So for
this project the HAR comes from a person: DevTools → Network → *Export HAR*. Ask for
one rather than assuming it can be taken here.

→ [HAR reconciliation](references/har-reconciliation.md) for the commands.

## References — load on demand

- [Widget coverage matrix](references/widget-coverage-matrix.md) — load before capturing anything: the per-platform list of widgets to exercise, and why one conversation is never enough.
- [Live verification](references/live-verification.md) — load when driving the browser: capture recipes, reachability greps, and the end-to-end export check.
- [HAR reconciliation](references/har-reconciliation.md) — load at step 8: turning a user's HAR export into a message count to check the parser against, and into the endpoint behind a field the DOM never shows.
- [Content type checklist](references/content-type-checklist.md) — load when deciding what a parser must handle: maths, code, tables, images, citations, and the trap in each.

## Gotchas

- **Rendered maths is duplicated, and platforms disagree about how.** KaTeX emits up
  to three copies — `.katex-mathml`, a LaTeX `annotation`, and `aria-hidden`
  `.katex-html`. ChatGPT has all three, so naive `textContent` yields
  `E=mc2E = mc^2E=mc2`; Gemini has only the aria-hidden copy, so stripping it loses
  the formula entirely. Collapse `.katex` / `mjx-container` to one representation,
  preferring `annotation[encoding="application/x-tex"]`. A generic aria-hidden rule
  cannot get both platforms right.
- **Code may not be `<pre><code>`.** ChatGPT embeds CodeMirror 6: a nested second
  `<pre class="cm-content">`, a `code` with no class, and no language in the DOM.
  Short blocks hold the body in one `<span>`; longer highlighted ones split into one
  span per token. `textContent` handles both, but joining child nodes with a
  separator will not. Do not infer the language from the code body — a guess ships a
  wrong `language-*` class into every export and no test will catch it.
- **Not every `<img>` is content.** Citation-pill favicons, artifact previews and
  button icons all sit inside the message body. Collecting them all files UI chrome
  as conversation images — and one such image, an undecodable SVG data URI, hung the
  PDF exporter forever. Scope collection to explicitly enumerated containers, and
  prefer a structural check to a URL substring sniff: an `includes('icon')` filter
  once made a bug's test pass by coincidence.
- **A guard inside the turn loop deletes the question too.** `if (!content) return;`
  in a per-container loop drops the whole turn, not just the missing half — which is
  how a Deep Research turn disappears from a Gemini export without an error. A turn
  that matches the container selector but not the content selector is a finding to
  log or fall back from, never a silent skip.
- **Screen-reader text is real text, and its class is framework-specific.** Turn
  wrappers carry visually-hidden nodes naming the speaker: `.sr-only` on Tailwind
  (ChatGPT), `.cdk-visually-hidden` on Angular (Gemini). Hidden but not
  `aria-hidden`, so a text scrape keeps them. Identify the site's framework, look up
  its visually-hidden convention, verify against the capture, and put the fix in the
  shared `BaseParser` cleanup — a per-parser fix makes the next platform relearn it.
  Scrape the narrowest content root, never the turn wrapper.
- **A defect can be invisible in `textContent`.** Icon-only buttons have empty text,
  but their markup lands in `htmlContent`, which three exporters consume. Assert on
  `htmlContent` as well as text.
- **Do not probe mid-stream.** A "wait until length stops changing" loop exits while
  the response is still generating and reports elements missing that appear seconds
  later. Wait for the stop control to disappear *and* for length to hold steady
  across several polls. Keep each in-page wait under the browser-bridge evaluation
  timeout (~45s); one long `await` loop kills the tab connection instead of
  returning.

Full field notes, including the incidents these were distilled from, live in
`docs/dev/parser-gotchas.md`.
