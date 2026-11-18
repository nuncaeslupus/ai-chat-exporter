# Session handover

_Written 2026-11-13, end of the ChatGPT 2026-11 / v1.3.1 release session._

## What this session did

1. **Diagnosed the "chat not detected" reports.** chatgpt.com rebuilt its app shell in
   November 2026: the conversation lives in `[data-turn-key]` turns whose messages are
   `[data-content-search-unit-key]` units. The old selectors matched nothing, so the popup
   said "no conversation" and exports came out empty. Probed live in the user's browser.
2. **Scheduled tasks** (ChatGPT's own answer with no question from the user) parsed to
   nothing; empty questions are now carried through every exporter.
3. **Virtualization.** Both chatgpt.com and claude.ai mount and unmount turns on scroll, so
   a parse only ever sees one window. `src/extension/content/scroll-to-load.ts` walks the
   scroller bottom-to-top and stitches the windows, falling back to the plain parse unless
   the walk contains everything the plain parse held.
4. **Released v1.3.1** — merged #292, #294, #296, #299.

## Where things stand

| Thing | State |
|---|---|
| PR #292 (ChatGPT 2026-11 DOM) | merged, `a4553e3` |
| PR #299 (release v1.3.1) | merged, `e0f19c9` |
| Firefox Add-ons | v1.3.1 **submitted** (version 6706086), source package included; awaiting Mozilla review |
| AMO listing text | updated to the v1.3.1 "What's New" and version history |
| Chrome Web Store | **not done** — see below |
| Tag `v1.3.1` + GitHub release | done — tagged at `e0f19c9`, release carries the three zips |

## Blocked, needs the user

- **Chrome Web Store.** Neither browser can drive it: Chrome refuses to script
  `chrome.google.com` (extensions gallery), and the in-app pane cannot load it at all. The
  upload and the listing text are a manual job, or the CWS publishing API
  (`googleapis.com/chromewebstore/v1.1`) can upload and publish the zip — it cannot edit
  listing text or screenshots.
  Package: `dist/ai-chat-exporter-v1.3.1-chrome.zip`. Copy: `docs/store-listings/chrome-web-store-v1.3.1.txt`.

## Queued follow-ups (filed as `arsenal:queue`, import them next session)

- #300 — the stitched result keeps `base.drift` from a partial window.
- #301 — `countTurnContainers` counts units, not turns, so `turns-dropped` can fire falsely
  (CodeRabbit Minor on #292, answered as declared-and-queued).
- #302 — `deep-research-frame.test.ts` leaks a timer that throws after teardown.

## Notes for whoever picks this up

- `docs/dev/parser-gotchas.md` §17 is the written-down version of the ChatGPT DOM work;
  read it before touching the ChatGPT selectors again.
- `subsumes()` in `scroll-to-load.ts` is gated on the **pair id**, and the ChatGPT parser
  feeds that id from the turn's own `data-turn-key`. On text alone it folds two distinct
  exchanges whose answers nest. Do not relax that gate.
- CodeRabbit allows roughly one review an hour on this plan. Two of this session's
  afternoon hours went to waiting on it. `CLAUDE.md` permits a recorded self-review
  instead — use it rather than waiting.
