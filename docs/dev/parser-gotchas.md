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

ChatGPT now renders code in an embedded **CodeMirror 6** instance:

```
pre.overflow-visible!            <- markdown-level wrapper, has data-start/data-end
  div#code-block-viewer.cm-editor
    div.cm-scroller
      pre.cm-content             <- a SECOND <pre>
        code                     <- no class at all
          span                   <- text, real newlines inside
```

Consequences:

- **Nested `<pre>`**: a naive `pre code` walk matches the outer wrapper *and* the
  inner `cm-content`, producing duplicated code blocks.
- **Language is gone from the DOM.** The old `code[class*="language-"]` and the
  `div.h-9` label are both absent; `code` carries no class. If the language matters,
  it has to come from somewhere else (markdown source offsets, or heuristics) — or
  be dropped honestly rather than guessed.
- **Virtualization risk**: CodeMirror only renders visible lines for large documents.
  A long code block may be *partially present* in the DOM. Scraping it can silently
  truncate. This was not reproduced on short blocks (a single `<span>` held the whole
  body with real newlines), but any parser reading a `.cm-content` must be treated as
  reading a possibly-windowed view.

**Rule:** when a platform embeds an editor component, find the underlying source
rather than scraping the rendered viewport, or detect and report truncation. Do not
assume the DOM holds the whole document.

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
