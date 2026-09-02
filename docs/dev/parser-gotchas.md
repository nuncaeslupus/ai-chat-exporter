# Parser & exporter gotchas

Field notes from capturing real chatbot DOM. Written for whoever adds or repairs a
platform parser next — and for the parser-generator skill. Every item here cost a
debugging session or was caught only by looking at a live page.

Last live survey: **chatgpt.com, 2026-07-28** (Free tier, `gpt-5-5`).

---

## 1. Never trust a selector you have not re-run against a live page

The single highest-impact defect found in the 2026-07 survey: ChatGPT renamed its
turn wrapper from `<article data-turn="...">` to `<section data-turn="...">`.

`main article` matched **zero** elements. Because `ChatGPTParser.extractUserMessages()`
and `extractAssistantMessages()` hardcoded `article[data-turn="user"|"assistant"]`,
the parser extracted **nothing at all** from any live conversation — silently, with
no error. Every unit test still passed, because they run against a captured fixture
from 2026-01 that still had `<article>`.

**Rules that follow:**

- A fixture is a snapshot of a *past* DOM. Passing tests prove you did not regress
  against January; they prove nothing about today.
- Anything on the live-detection path (`canParse`, turn enumeration) needs a
  **liveness check** — a periodic re-capture, or a runtime warning when the primary
  turn selector matches zero nodes on a page the URL pattern claims to support.
- Prefer the most semantically stable attribute available. `data-message-author-role`
  and `data-turn` survived the migration; the *tag name* and Tailwind classes did not.

## 2. Selectors defined in `selectors.ts` but hardcoded in the parser

`CHATGPT_SELECTORS.custom.userTurn` existed and was correct-ish, but
`parser.ts:151`/`:217` ignored it and inlined the string. Fixing the selector file
would not have fixed the parser.

**Rule:** the parser must read every selector from its `SelectorSet`. A hardcoded
selector in parser logic is a defect even when it currently works — it is a repair
that will be applied to the wrong file.

## 3. Rendered maths is duplicated, not just hidden — and platforms differ

KaTeX emits up to three copies of the same formula:

| part | ChatGPT | Gemini |
|---|---|---|
| `.katex-mathml` (accessible copy) | present | **absent** |
| `annotation[encoding="application/x-tex"]` (LaTeX source, inside mathml) | present | absent |
| `.katex-html` (visual glyphs, `aria-hidden="true"`) | present | present |

Naive `textContent` on a ChatGPT formula yields `E=mc2E = mc^2E=mc2` — the rendered
form, the LaTeX source, and the visual form, concatenated.

This makes "strip `aria-hidden`" and "keep `aria-hidden`" **both wrong**:

- Strip it (old behaviour): Gemini loses the formula entirely — `.katex-html` is the
  only copy there.
- Keep it (current behaviour after `lo-74ed`): ChatGPT triplicates the formula.

**Rule:** treat `.katex` / `mjx-container` as an atomic unit and collapse it to **one**
chosen representation — preferring `annotation[encoding="application/x-tex"]` (the
real LaTeX source, the only lossless option), falling back to `.katex-mathml` text,
then `.katex-html` text. Never let a generic aria-hidden rule decide.

## 4. Code blocks may not be `<pre><code>` any more

ChatGPT renders code in an embedded **CodeMirror 6** instance:

```
pre.overflow-visible!            <- markdown-level wrapper, has data-start/data-end
  div#code-block-viewer.cm-editor
    div.cm-scroller
      pre.cm-content             <- a SECOND <pre>
        code                     <- no class at all
          span                   <- text
```

**What was actually wrong (measured, `lo-5a16`).** The first version of this note
predicted duplicate extraction from the nested `<pre>`. That did not happen:
`extractArtifacts()` selects `pre.overflow-visible\!`, which never matches the inner
`pre.cm-content` (different class), and `HtmlContentParser` treats a top-level
`<pre>` as one atomic code block without recursing. The real defect was the opposite
of duplication — **silent data loss**: the content and language selectors
(`div.h-9`, `code[class*="language-"]`, `code.whitespace-pre\!`) matched *zero*
elements, so code blocks came out empty.

Predicting the failure mode from the shape of the DOM was wrong. Measure which
selectors match zero before theorising about what matches twice.

**The language is not in the DOM as a class.** `code` carries no class. It is
recoverable from the sticky header's text next to the language icon — clone and strip
buttons first, or "Copy"/"Run" leak into it. Never infer the language from the code body.

**Token spans vary with length.** A short block puts the whole body in a single
`<span>` with real newlines. A longer, syntax-highlighted block splits into one span
per token (`ͼg`, `ͼj`, … CodeMirror highlight classes). `textContent` reconstructs
both correctly, but any logic that joins child nodes with a separator will mangle the
highlighted case.

**Virtualization: measured, not a problem at this size.** A deliberately generated
160-line block was captured live: all 160 lines present in the DOM, first and last
line intact. CodeMirror did not window it. The fixture
`tests/fixtures/dom-snapshots/chatgpt/longcode-160-lines-2026-07.html` pins this.
Unresolved: whether a *much* larger block (thousands of lines) is windowed. The outer
wrapper's `data-start`/`data-end` are exact character offsets of the full fenced block
and would make a good truncation signal — verified byte-exact on live captures — but
they are **not** reliable on the repo's older hand-authored fixtures, which use
round-number placeholders. Validate on real captures before building a detector on them.

## 5. Interactive chrome lives *inside* the scraped content

`.markdown` contains ChatGPT's own action buttons — 4 `<button>` ("Copy table",
"Copy code") inside a single message, measured live. Their `textContent` is empty
(icon-only), so plain-text extraction looks clean and their presence is invisible to
any text-based assertion.

**Correction (verified during `lo-62ce`).** The first version of this note claimed
these buttons leak into exported HTML. They do not: `cleanupElement()` in
`base-parser.ts` already removed every `<button>` and every `<svg>` outside
`pre`/`code`, so the CDN sprite refs never reached `htmlContent`. The claim was
inferred from seeing the buttons in the live DOM without checking the cleanup path —
a reminder that "I can see it in the DOM" and "it survives into the export" are two
different assertions, and only the second one matters.

The real gap was narrower: elements exposed as buttons via **ARIA role** rather than
the tag (`<span role="button">`) were not covered. Fixed by widening the selector to
`button, [role="button"]`.

**Rules that survive:**

- Strip interactive chrome during cleanup, and match on **role as well as tag** —
  a component library can produce a button without a `<button>`.
- Assert on `htmlContent`, not only on text. A defect invisible in `textContent` can
  still ship in three export formats — that is a real risk even though it did not
  happen here.
- Before writing the fix, check whether the existing cleanup already handles it. The
  gate scenario passing before you change anything is information, not an anticlimax.

## 6. Citation pills carry favicons that become "conversation images"

Web-citation pills (`[data-testid="webpage-citation-pill"]`) live **inside**
`.markdown` and each contains an `<img>` favicon. A generic "collect every `<img>` in
the turn" pass files these as conversation images. Same class of bug as artifact-
internal preview images (`lo-4b7f`, where an SVG artifact's decorative preview hung
the PDF exporter forever).

**Rule:** image collection must be scoped — exclude images inside citation pills,
artifact panels, buttons and other UI affordances. Enumerate what an `<img>` can mean
on the platform before treating all of them as content. Third-party favicon URLs also
leak the cited domains to a third party every time an export is opened (see `lo-8312`).

## 7. Screen-reader-only text is real text

Turn sections contain `.sr-only` nodes (e.g. an `<h4>` naming the speaker). They are
visually hidden but **not** `aria-hidden`, so both a text scrape and an
`aria-hidden` filter keep them. Scraping the turn wrapper rather than the content
root injects "You said:" / "ChatGPT said:" into the export.

**Rule:** scrape the narrowest content root (`.markdown` for assistant, the user
bubble for user), never the turn wrapper.

## 8. Hashed class names are not selectors

Observed: `TyagGW_tableWrapper`, `q9tKkq_viewer`, `ͼd ͼr`. These are CSS-module and
CodeMirror-generated hashes that change on every build.

**Rule:** select on `data-*` attributes, ARIA roles, or semantic tags. If a hashed
class is the only handle, that is a signal to match on structure instead.

## 9. Tooling gotchas when surveying a live page

- **The backend JSON API is not available from page context.** `/backend-api/conversation/<id>`
  returned non-OK for all 14 attempts. DOM is the only source of truth — which is
  correct anyway, since that is what the extension itself reads.
- **Do not probe mid-stream.** A "wait until length stops changing" loop exited while
  the response was still generating and reported `h2: 0, table: 0` on a page that
  clearly had both. Wait for the stop-button to disappear *and* for length to be
  stable across several polls, then re-verify.
- **Dump structure, not content.** Sending element text through the browser bridge
  trips secret-redaction heuristics (long CSS-module hashes were flagged as JWTs,
  URL query strings as cookie data) and wastes context. Emit tag names, attribute
  *names*, and counts.
- **Download rather than paginate.** For anything large, build a Blob in the page and
  click a synthetic `<a download>`, then analyse the file locally with grep. Vastly
  cheaper than round-tripping HTML through the conversation.

## 10. Fixtures must be synthetic

Real conversations are private and fixtures get committed to a public repo. Capture
fixtures from a conversation you created for the purpose, with invented data, and
scan the file for personal identifiers before committing. `main.outerHTML` (not
`documentElement`) excludes the sidebar, which would otherwise leak every
conversation title in the account.

---

## 11. A fixture can make a test pass for the wrong reason

While fixing the citation-pill favicons (`lo-37b2`), the first fixture used a
Google-favicon-service URL. The parser has a crude filter, `!src.includes('icon')`.
The URL contained the substring `icon`, so the favicon was excluded **by accident** —
the new test went green before any fix existed.

Two lessons, both general:

- **A test that is green before you write the fix has not been verified.** RED is not
  a formality. If the "before" state passes, the test is measuring something other
  than the defect. Change the fixture until it genuinely fails, then fix.
- **Substring filters over URLs are accidental logic.** `includes('icon')` was doing
  load-bearing work nobody designed: real favicons whose URL happens not to contain
  `icon` always got through, and unrelated content images whose URL happens to
  contain `icon` were always dropped. Prefer a structural test (is this `<img>` inside
  a citation pill / artifact panel / button?) over a string sniff.

## 12. Fix the misclassification once, extend it — do not add a parallel rule

Three separate defects this round were the same underlying bug: *an `<img>` that is
part of the UI being treated as conversation content*.

- `lo-4b7f` — an SVG artifact's decorative preview image, which additionally hung the
  PDF exporter forever on an image that never decodes.
- `lo-37b2` — citation-pill favicons.
- (adjacent) `lo-62ce` — copy buttons, the same problem for non-image chrome.

The right shape was one container-exclusion check that later tasks widen, not three
independent filters. When a second instance of a defect class appears, extend the
first fix; a parallel mechanism guarantees the third instance gets a third one.

Related: prefer an allow-list when the legitimate cases have a distinguishing
wrapper, and an exclusion list when they do not. Here the illegitimate cases were the
ones with stable containers, so exclusion was the smaller, more honest diff.

## 12b. A turn's content is not always inside the turn

Gemini Deep Research renders the report **outside** `.conversation-container`.
Measured on a live capture (2026-07-28):

```
chat-window
├── …/infinite-scroller
│     ├── .conversation-container   turn 1: question + deep-research-confirmation-widget (the plan)
│     └── .conversation-container   turn 2: "Start research" + "I've completed your research" + immersive-entry-chip
└── immersive-panel                                          <- SIBLING of the chat history
      └── deep-research-immersive-panel
            ├── toolbar … h2.title-text                      report title
            ├── structured-content-container
            │     └── message-content > div.markdown         REPORT BODY (32k chars)
            ├── deep-research-source-lists
            │     ├── div.source-list.used-sources    ×55 browse-web-item   cited
            │     └── div.source-list.unused-sources  ×144 browse-web-item  read, not cited
            └── thinking-panel > div.thinking-panel   ×42 div.item-container (60k chars)
```

`GeminiParser.extractQAPairs` iterates `.conversation-container` only, so the
entire report, its sources and its research steps were missing from every export
— with no warning, because both turns *did* have a question and a
`message-content .markdown`, so the loop's early `return` never even fired.

**Rules:**

- Enumerating turn wrappers finds the *conversation*, not necessarily the
  *content*. Before assuming a wrapper is complete, diff what is inside it
  against what the page shows.
- The predicted failure mode (the early `return` swallowing the pair) was not
  the actual one. Gotcha 4 again: measure which selector matches what, do not
  reason from the shape of the code.
- A turn missing one expected part should degrade — emit what exists and warn —
  never drop the pair. The question is data too.
- The fix reuses `Message.content`/`htmlContent` and `metadata.webSearches`
  rather than adding a field: content merged into the answer renders in all six
  registered exporters for free, and `webSearches` is the shape ChatGPT and
  Claude already emit for citations. Prefer an existing field over a new one —
  a new field is six exporters of work and five places to forget it (see
  gotcha 16).

## 12c. Screen-reader-only classes are per design system

Gotcha 7 said "scrape the narrowest content root". True, but insufficient: the
cleanup only stripped `.sr-only`. Gemini is Angular CDK, which names the same
thing `.cdk-visually-hidden`, so **every** Gemini question exported as
`"You said <question>"` and every citation trailed `"Opens in a new window"`.
`.sr-only` is a Tailwind convention, not a web standard. Match on
`[class*="visually-hidden"]` as well, and check the target platform's own
convention before assuming one name covers it.

## 12d. Live-capture drift found in passing (2026-07-28, gemini.google.com)

`.conversation-title` and `[data-test-id="bard-text"]` match **zero** elements
on a current Gemini page: the top bar no longer carries the conversation title,
and `bard-mode-switcher` moved into the composer (`input-container`), where it
reads "Flash"/"Pro"/"Extended" rather than a model name. `getTitle()` and
`getModel()` therefore silently fell back. Exactly the gotcha-1 failure mode:
the January fixture still had both, so the selector-liveness test stayed green
for six months.

**Fixed 2026-07-29 (lo-3c90)** against a fresh capture:

- Title now comes from the sidebar row for the open conversation
  (`gem-nav-list-item[data-test-id="conversation"] a[aria-current="page"]
  .title-text`). `aria-current="page"` is the only occurrence in the page, and
  the only semantic marker of *which* conversation is open — matching
  `.title-text` unscoped would return whichever row is first. `document.title`
  is not a second source: Gemini leaves it as the bare app name.
- `getModel()` returns `Gemini (<label> mode)`, not the bare label. The control
  is a *mode* picker by the page's own account (`aria-label="Open mode picker,
  currently Flash"`) and its value is sometimes a model family ("Flash", "Pro")
  and sometimes an effort tier ("Extended"). `Model: Extended` in an export
  header names a model that does not exist; an absent value beats a confidently
  wrong one, and the mode phrasing is true either way without losing anything.

**Rule the recurrence taught:** a selector-liveness test proves the selector
matches *the fixture*, never the product — it cannot detect drift, by
construction. Two things that help and cost nothing:

- assert the returned **value**, with a negative control (the title is the
  active row's, *not* the first row's), so a selector that drifts into matching
  the wrong element fails instead of quietly matching something;
- assert the retired markup is **absent** from the fixture, so re-adding dead
  markup to force a test green is an explicit act rather than an accident.

Neither substitutes for re-capturing. Any parser change should start from a
fresh capture, and a capture older than the last redesign is a liability.

## 13. Orchestration: worktrees can start from a stale base

Observed on three workers in one session. A worker's worktree was cut from a commit
older than both `main` and the queue branch, causing:

- its own task payload to be missing from disk (readable only via
  `git show arsenal-queue:claude-arsenal/queue/<id>.md`);
- `open_task_pr.sh` to hard-fail at `git checkout -b <branch> FETCH_HEAD` because
  uncommitted edits conflicted with newer content on `main` — no real conflict, just a
  stale base. Recovery was: save a patch, reset, branch fresh off `FETCH_HEAD`, reapply;
- a stale `node_modules` missing a newly-added devDependency (`jszip`), which broke
  the integration test and `pnpm typecheck` in ways unrelated to the worker's change.

**Mitigation until the tooling is fixed:** every worker should `git fetch origin`,
branch off up-to-date `origin/main`, and run `pnpm install` before doing anything.
The real fix belongs in the worktree setup and in `open_task_pr.sh`, which should
rebase rather than hard-fail.

## 14. Coverage percentages move when you add tests — in both directions

Coverage counts only files the suite actually imports. A floor measured on an isolated
branch does not survive a merge with other test-adding branches: merging this session's
work took the function count from 138 to 224 and *dropped* functions coverage from
81% to 75%, turning `main` red on a floor that had been correct when it was set.

**Rule:** set floors from a measurement on the integration branch, not on your own; and
re-measure before raising one. "Adding tests lowered coverage" is normal, not a bug.

## 15. `querySelector` returns the *first* match, and the one you want is often the last

Bit me twice in one session while probing a live page. `document.querySelector('.markdown')`
returned an unrelated/empty node while the assistant's real content was the *last*
`.markdown` on the page — producing "the content is not in `.markdown`!" twice, both
times wrong.

When probing a conversation, scope to the turn first
(`[...document.querySelectorAll('[data-turn="assistant"]')].pop()`) and query within
it. A page-wide `querySelector` in a multi-turn document is almost always a bug.

Related timing trap: probing while the response is still streaming reports missing
elements that appear seconds later. Wait for the stop-button to disappear **and** for
text length to hold steady across several polls. And keep each in-page wait loop under
the CDP call timeout (~45s) — a long `await` loop inside one evaluation kills the tab
connection rather than returning.

## 16. A metadata field implemented in one exporter is a bug in five

`metadata.webSearches` had been read by `html`, `pdf` and `json` since it was
added, and never by `md`, `txt` or `docx` — a gap the integration suite pinned
as *expected* behaviour (`does NOT carry a web-search result URL through (known
bug lo-23fb)`) rather than fixing. Any parser that filed citations there shipped
them to half the formats. Closed while wiring Gemini Deep Research, which uses
the same field.

**Rules:**

- `src/core/exporters/index.ts` is the authority on what "every exporter" means:
  `md` (structured), `txt`, `json`, `pdf`, `docx`, `html`. The old unregistered
  `md-exporter.ts` and `html-pdf-exporter.ts` shipped to nobody and were
  deleted; don't resurrect dead exporter files instead of wiring the registry.
- The integration suite's `describe.each(exporterRegistry.keys())` block is the
  cheapest place to enforce it: assert the new field for *all* formats, not for
  the subset that happens to pass.
- Pinning a known gap as an assertion is better than a silent hole, but only if
  the assertion is flipped when the gap closes — the failing test is the point.

## Diagnosing selector drift without a browser

The parsers cannot be checked against the live sites from CI or from a cloud
session: claude.ai, chatgpt.com and gemini.google.com all render the
conversation only behind a login, so there is no unauthenticated page to fetch
and no captured HAR contains the rendered DOM (the transcript arrives as API
JSON and is assembled client-side). The evidence has to come from someone with
the page open.

`pnpm probe` generates `dist-probe/selector-probe.js`: a self-contained snippet
to paste into the DevTools console on the broken page. It reads the selector
values out of `src/core/parsers/*/selectors.ts` at generation time, so it can
never test a stale transcription of them.

It prints (and clipboard-copies) a JSON report of:

- a match count for every selector, and the list of those matching **zero**
  elements — the drifted ones;
- the class names of the page's real scroll containers, which is what to
  rewrite `conversationContainer` against;
- a frequency census of the `data-*` attribute names actually in the DOM —
  the stable hooks worth moving a selector onto.

The report carries counts, class names and attribute *names* only: no message
text, no attribute values, no URLs beyond the path with ids masked. That is
deliberate — it is meant to be pasteable into a public issue.

**Detection is the failure worth designing against.** A drifted content
selector costs one field in the export and raises a drift warning. A drifted
selector inside `canParse()` costs *everything*: the popup reports the page as
unsupported and no other selector is ever consulted, so the drift report that
would have named the problem is never built. Hence `ClaudeParser.canParse()`
ORs several independent turn-level hooks rather than requiring the
`conversationContainer` utility chain — see `custom.conversationSignals`.

**Extraction has to be at least as broad as detection.** Widening `canParse()`
without widening the walk moves the failure rather than fixing it: the page is
claimed off any of seven signals, the walk still needs
`data-test-render-count`, and if that render-debug attribute is stripped the
export comes back empty from a page the popup just called supported — an
outcome that looks like an app bug, not selector drift, because no warning
fires. So `ClaudeParser` resolves its turns through a fallback: the wrapper
when it exists, otherwise the same turn-level role markers detection trusts,
with nested matches filtered out so one turn is never counted twice. The rule
generalises — every selector guarding detection needs a path through
extraction that does not depend on a selector detection no longer requires.
