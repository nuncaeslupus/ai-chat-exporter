---
name: parser-generator
description: Use whenever anything under src/core/parsers/ is being added or repaired — capturing a live DOM, deriving selectors, implementing a BaseParser subclass. Triggered by "add a parser for X", "support a new chatbot", "capture DOM selectors", "the parser stopped working", "exports come out empty". Do NOT use for src/core/exporters/ work (see docs/dev/adding-exporters.md), nor for a parser change that touches no selector.
---

# parser-generator

Builds and repairs platform parsers for this extension: capture a live DOM, derive
selectors that survive a redesign, implement a `BaseParser` subclass, and prove it
against a committed fixture.

CANARY: parser-generator-loaded-2026-07-28-60d048f4-0d2567f35c16cbcd

## When to load

Load this skill when:

- Adding support for a new chatbot platform (Mistral, Grok, DeepSeek, …).
- A platform redesigned and an existing parser stopped extracting — exports are
  empty or a content type went missing.
- Capturing a DOM snapshot to turn into a test fixture.
- Reviewing a parser diff for selector fragility.

If the task is really about turning an already-parsed `Conversation` into a file
format, this is the wrong skill — that is exporter work.

## The rule that matters most

**A passing test suite is no evidence that a parser works today.**

Fixtures are snapshots of a past DOM. In July 2026 ChatGPT renamed its turn wrapper
from `<article data-turn>` to `<section data-turn>`. The parser hardcoded `article`,
extracted **nothing** from every live conversation, and all 61 unit tests still
passed against a January fixture.

So the workflow below starts at a live page, never at the existing code.

## Workflow

### 1. Capture a live DOM — from a purpose-made conversation

Never capture a real user conversation: fixtures get committed to a public repo.
Create one with invented data exercising the relevant element types (headings,
nested lists, tables, code, maths, citations, images).

In the browser console on that conversation:

```js
const m = document.querySelector('main');
const a = document.createElement('a');
a.href = URL.createObjectURL(new Blob([m.outerHTML], { type: 'text/html' }));
a.download = 'platform-feature-YYYY-MM.html';
document.body.appendChild(a); a.click(); a.remove();
```

Use `main.outerHTML`, **not** `documentElement` — the sidebar carries every
conversation title in the account. Scan the saved file for personal identifiers
before committing it.

Analyse the downloaded file locally with grep rather than paging HTML back through
the conversation: far cheaper, and it avoids secret-redaction heuristics mangling
long CSS-module hashes and URL query strings.

### 2. Probe which selectors actually match

Before writing anything, run every candidate against the live page and record match
counts. Zero-match selectors are the defect; theorising about double-matches without
measuring wastes a session.

```js
const q = s => { try { return document.querySelectorAll(s).length } catch (e) { return 'ERR' } };
({ container: q('main#main'), turns: q('[data-turn]'), content: q('.markdown') })
```

Scope every probe to one turn — `[...document.querySelectorAll('[data-turn="assistant"]')].pop()`
— then query inside it. A page-wide `querySelector` in a multi-turn document returns
the first match, which is rarely the intended one.

### 3. Choose selectors that survive a redesign

Ranked by durability:

1. `data-*` attributes carrying semantics (`data-message-author-role`, `data-turn`)
2. ARIA roles and semantic tags
3. Stable structural relationships

Never: tag names as identity (`article` to `section` broke everything), Tailwind
utility classes, or hashed CSS-module / CodeMirror class names
(`TyagGW_tableWrapper`, `ͼd`) which change every build.

### 4. Implement against the real `BaseParser`

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

Register in `src/core/parsers/index.ts` (`parserRegistry` and
`createParserForDocument`). `detectParser()` calls `canParse()` on each parser in
turn, so a `canParse()` gated on a stale container selector makes the parser
unreachable no matter how good the rest of it is.

### 5. Prove it, then re-check live

Write the fixture test, confirm it fails before the fix and passes after. A test
green *before* the fix is measuring something else — change the fixture until it
genuinely fails.

Then return to the live page and confirm the real thing works. The fixture only
proves the absence of a regression against the past.

## References — load on demand

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
- **Screen-reader text is real text.** Turn wrappers contain `.sr-only` nodes naming
  the speaker. Visually hidden but not `aria-hidden`, so a text scrape keeps them.
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
