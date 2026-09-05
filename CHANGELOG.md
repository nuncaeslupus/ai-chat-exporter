# Changelog

All notable changes to AI Chat Exporter are recorded here.

## [1.3.0] — 2026-09-05

### Added

- **A language setting.** The extension only ever spoke the browser's language.
  A new setting in the gear view pins one instead — for the popup *and* for the
  exported file — defaulting to "Browser language", which is what every install
  does today. An untranslated key falls back to English rather than showing a
  raw key.
- **`pnpm probe`.** Generates a DevTools-console snippet from the selector
  modules themselves, so selector drift on a login-walled site can be diagnosed
  by whoever has the page open. Its report is match counts, class names and
  attribute names only — safe to paste into a public issue.

### Fixed

- **Claude conversations parse against the 2026 markup again.** Extraction still
  walked `div[data-test-render-count]` alone while detection had already moved to
  seven independent signals, so stripping that render-debug attribute produced an
  empty export on a page the popup reported as supported — and no drift warning,
  because the count used the old walk too. Turns now fall back to the same
  turn-level role markers detection trusts, with artifact panels excluded and
  nested matches filtered so a turn is never counted twice. Asymmetric threads
  (an unanswered turn, a regenerated one) parse correctly.
- **Claude pages are detected reliably again.** Detection required a Tailwind
  utility chain on a layout div, so any spacing tweak on claude.ai retired it and
  the popup reported the page as unsupported — the one drift a report cannot warn
  about, because no other selector is ever consulted. Detection now ORs several
  independent turn-level signals.
- **The popup no longer opens with the Export button looking half-pressed.**
  Painting the closed format menu restored focus to its chevron before anything
  had been touched, and Chrome's first programmatic focus matches
  `:focus-visible`.
- **One way back out of a submenu.** The header chevron and the footer Done
  button both did nothing but return to the parent view; Done and its footer band
  are gone.

### Changed

- **The PDF library's optional dependencies are stubbed at build time.** jsPDF
  lazily imports canvg, html2canvas and dompurify from code paths this extension
  never uses; the bundler still emitted ~380 KB of chunks, one of which builds a
  `javascript:` string that the Chrome Web Store scanner flags as obfuscated code.

## [1.2.0] — 2026-07-31

The headline is **Gemini support**, a **rebuilt popup**, **complete exports of long
Claude conversations**, and a **safety net that tells you when a chat site changes
its page structure** instead of quietly exporting less.

### Added

- **Gemini support.** `gemini.google.com` is now a supported platform:
  parser, detection, artifact chips and thinking extraction, with DOM fixtures
  behind it.
- **Selector-drift safety net.** Every export is checked against what the parser
  expected. When a site changes its structure, the popup shows a non-blocking
  amber notice and offers a structural report you can hand to the developer. The
  report contains **no part of your conversation** — every piece of text is
  replaced by its character count, and you see the exact text before it is
  copied. Nothing is ever transmitted by the extension.
- **Q&A pair selection.** Choose which exchanges to export instead of all or
  nothing.
- **Export options and filename templates**, including a metadata/timestamp
  toggle and a formatted print view.
- **ChatGPT Deep Research** answers are now read out of the sandboxed frame they
  render in, instead of exporting as the screen-reader label.
- **Claude artifacts, thinking panels and web-search results** are captured.
- **Dark mode** in the popup and in exported HTML.

### Fixed

- **Long Claude conversations export completely.** claude.ai renders long chats in
  a windowed list that only ever holds a handful of exchanges, so an export could
  contain as little as one exchange out of twelve — and said only that "artifact
  contents and message times were left out". Every exchange is now recovered, and
  the warning that used to blame an edited or regenerated turn (and suggest a
  reload, which could not help) has been corrected.
- **Gemini tables export as tables.** Content nested inside a platform's custom
  elements was being flattened to plain text, which destroyed every Gemini table
  and also silently dropped code blocks and images. Fixed for every platform at
  once, not just Gemini.
- **Per-message timestamps are no longer invented.** No platform exposes a real
  time for every message, so the extension had been stamping the moment of
  export onto each one — and rendering it in UTC. Times now appear only where a
  real one exists, in your own timezone.
- **Supported pages no longer report "no conversation to export"** when the
  parser simply found nothing, and a conversation with zero exchanges no longer
  offers a normal export of nothing.
- **Export and print failures are reported as failures**, not silently as
  success.
- Code blocks survive DOCX export; syntax highlighting no longer corrupts blocks
  containing keywords; rendered maths is no longer stripped; PDF substitutes
  representable characters instead of deleting them; artifacts are no longer
  rendered twice; web-search titles and URLs survive markdown, text and DOCX.
- Q&A pairs no longer mis-pair when a message is dropped.
- The popup and exported HTML meet WCAG AA contrast; the popup has an aria-live
  region and no hardcoded English. Focus is no longer lost when the popup changes
  view, and scrollable code blocks can be reached and scrolled from the keyboard
  in both saved HTML and the print view.
- **Exported document metadata is translated.** Platform, model, export time, URL
  and the role labels were English regardless of your language in the text and
  Word formats, while the same export in Markdown, HTML or PDF was translated.
- The PDF's shaded question block now covers the whole question instead of
  stopping at the first page break, and text-format artifacts wrap to the same
  width as the rest of the export.
- The "Copy & report" button now opens a pre-filled issue instead of a blank form.
- Warnings raised while reading the page are shown instead of being discarded.
- Exported HTML no longer fetches favicons from Google, which leaked the domains
  you had visited.

### Security

- The export keyboard shortcut no longer injects the content script into whatever
  site happens to be open — injection is scoped to the platforms the extension
  declares, matching the privacy claim in the documentation.
- The ChatGPT Deep Research relay now posts its report to the ChatGPT origins only,
  instead of any listener.
- The HTML sanitizer was rebuilt as an allowlist. The previous version was a
  five-tag denylist whose URL check could be bypassed, letting a crafted link run
  script in the print preview.

### Changed

- The popup was rebuilt: larger type, one fixed-height body, a format menu, and
  submenus for content, options and filenames.
- Scraped HTML is sanitized on the re-injection paths.
- The suite now enforces its own coverage thresholds instead of ignoring them.

### Permissions

Three additions since 1.1.1, all needed for features above and all documented in
[`docs/PRIVACY.md`](docs/PRIVACY.md):

- `gemini.google.com` — Gemini support.
- `*.web-sandbox.oaiusercontent.com` — reading a ChatGPT Deep Research report,
  which renders in a sandboxed frame served from that host. Scoped to that
  subdomain, not the whole user-content domain.
- `scripting` — putting the content script back into a chat tab that was already
  open when the extension was installed or updated.

The extension still has no server and still sends none of your data anywhere.

## [1.1.1]

See the repository history for releases up to 1.1.1.
