# Live verification

How to drive the real product with the Browser pane tools, and how to prove a widget
survives all the way into an exported file. Static fixture tests are necessary and
not sufficient — they only prove the absence of a regression against a past DOM.

Part of the parser-generator skill.

## Contents

- [Tools](#tools)
- [The loop, per widget](#the-loop-per-widget)
- [Probing](#probing)
- [Capturing](#capturing)
- [Accessibility chrome differs per framework](#accessibility-chrome-differs-per-framework)
- [Registration is not reachability](#registration-is-not-reachability)
- [The export check](#the-export-check)

## Tools

The Browser pane exposes `mcp__Claude_Browser__*`:

| tool | use it for |
|---|---|
| `navigate` | open the purpose-made conversation |
| `read_page` | accessibility tree — structure and refs, cheap to read |
| `get_page_text` | what a naive text scrape would produce; the fastest leak detector |
| `javascript_tool` | selector match counts, `outerHTML` capture, download trigger |
| `computer` | click, type, scroll — needed to trigger widgets from the UI |
| `read_console_messages` | the extension's own errors while it parses |

`javascript_tool` is for inspection and capture. Never use it to patch page state and
call that a fix — the fix belongs in the parser source.

## The loop, per widget

1. `navigate` to the conversation (or `computer` through the UI to create it).
2. Trigger the widget with invented data.
3. Wait for generation to end — the stop control gone *and* text length stable across
   several polls. Keep each in-page wait under the bridge's evaluation timeout
   (~45 s); one long `await` loop kills the tab connection instead of returning.
4. Probe selector match counts, scoped to the turn.
5. Capture `main.outerHTML`.
6. Run the extension's export on that live page and open the resulting file.

## Probing

Scope to the turn first. A page-wide `querySelector` in a multi-turn document
returns the first match, which is rarely the intended one.

```js
const turn = [...document.querySelectorAll('.conversation-container')].pop();
const q = s => { try { return turn.querySelectorAll(s).length } catch { return 'ERR' } };
({ user: q('user-query-content'), content: q('message-content .markdown'),
   thoughts: q('model-thoughts'), chip: q('immersive-entry-chip') });
```

Record counts. A zero is the defect; theorising about double-matches without
measuring wastes a session.

Emit tag names, attribute *names* and counts — not element text. Sending page text
through the bridge trips secret-redaction heuristics (long CSS-module hashes read as
JWTs, query strings as cookies) and burns context for nothing.

## Capturing

```js
const m = document.querySelector('main');
const a = document.createElement('a');
a.href = URL.createObjectURL(new Blob([m.outerHTML], { type: 'text/html' }));
a.download = 'platform-widget-YYYY-MM.html';
document.body.appendChild(a); a.click(); a.remove();
```

`main.outerHTML`, **not** `documentElement` — the sidebar carries every conversation
title in the account. Scan the saved file for personal identifiers before committing,
and analyse it locally with grep rather than paging HTML back through the
conversation.

## Accessibility chrome differs per framework

Screen-reader-only labels are visually hidden but **not** `aria-hidden`, so a text
scrape keeps them and they land in the export as "You said:" / "Tú dijiste:".

The class name is a framework convention, not a web standard:

| framework | convention | seen on |
|---|---|---|
| Tailwind | `.sr-only` | ChatGPT |
| Angular CDK | `.cdk-visually-hidden` | Gemini (e.g. `screen-reader-user-query-label`) |
| Bootstrap | `.visually-hidden` (`.sr-only` pre-5) | — |
| hand-rolled | `position:absolute; width:1px; height:1px; overflow:hidden` | — |

Generalise rather than adding one class per platform: identify the framework the site
is built with, look up its visually-hidden utility, confirm it against the capture
(`get_page_text` before and after removing candidates), and add it to the shared
cleanup in `BaseParser` so every parser inherits it. A per-parser fix guarantees the
next platform re-learns the lesson.

Scraping the narrowest content root instead of the turn wrapper avoids most of this;
the cleanup is the backstop for labels that live inside the content root.

## Registration is not reachability

A parser can be fully implemented, correct, and registered in `parserRegistry` — and
still never run, because a *second* hardcoded list gates it. `popup.ts`'s
`checkCurrentPage` carried its own domain array with `gemini.google.com` commented out
behind a stale TODO, so the popup reported "not supported" on a platform whose parser
had shipped.

Before believing a new platform works, grep every hardcoded host list:

```bash
grep -rn 'chatgpt\.com' manifests/ src/ _locales/ --include='*.json' --include='*.ts'
```

In this repo that surfaces, at minimum:

- `manifests/manifest.base.json` — `host_permissions` *and* `content_scripts[].matches`
- `manifests/manifest.chrome.json`, `manifests/manifest.firefox.json` —
  `web_accessible_resources[].matches`
- `src/extension/background/service-worker.ts` — a hostname array and a URL-pattern array
- `src/extension/popup/popup.ts` — derive from `parserRegistry`, never re-list

Prefer deriving from the registry over adding an entry. Where a literal is
unavoidable (manifest JSON cannot import), there is a manifest test — extend it so a
missing host fails the suite.

Then verify in a real browser: load the unpacked build, open a conversation on the
new platform, and confirm the popup recognises the page and the export button is
live. A grep proves the string exists; only the browser proves the gate opens.

## The export check

Parsing correctly is half the job. For each widget, export **all six formats**
(pdf, md, txt, json, docx, html) and open each file:

- `json` first — it shows what the parser actually produced, including metadata that
  the other five may or may not render.
- Then confirm the widget's content appears in the other five. A content type that
  only one exporter knows about vanishes silently from the rest.

Assert on `htmlContent` as well as text in fixture tests: a defect invisible in
`textContent` (icon-only buttons, empty wrappers) still ships in the HTML-consuming
formats.
