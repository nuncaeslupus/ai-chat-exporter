# Changelog

All notable changes to AI Chat Exporter are recorded here.

## [1.2.0] — unreleased

148 pull requests since 1.1.1. The headline is **Gemini support**, a **rebuilt
popup**, and a **safety net that tells you when a chat site changes its page
structure** instead of quietly exporting less.

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
  region and no hardcoded English.
- Exported HTML no longer fetches favicons from Google, which leaked the domains
  you had visited.

### Changed

- The popup was rebuilt: larger type, one fixed-height body, a format menu, and
  submenus for content, options and filenames.
- Scraped HTML is sanitized on the re-injection paths.
- The suite now enforces its own coverage thresholds instead of ignoring them.

### Permissions

Two additions since 1.1.1, both needed for features above and both documented in
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
