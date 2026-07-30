/**
 * Runs *inside* the sandboxed cross-origin iframe ChatGPT uses for Deep
 * Research and sibling connector widgets (`*.web-sandbox.oaiusercontent.com`).
 * `allow-same-origin` keeps the frame's own origin, which is what lets a
 * content script attach here at all -- but the frame is still cross-origin
 * from the parent page, so this is the only way anything in the extension
 * ever gets to look at what the frame rendered (lo-9001).
 *
 * Relays the frame's own rendered text out to the parent page over
 * `postMessage`; the parent's content script (content-script.ts) matches the
 * message back to the right <iframe> element by `event.source` and stashes
 * the text there for the ChatGPT parser to read. If this script never runs,
 * never finds any text, or the message never arrives, the parser's fallback
 * (naming the widget, lo-f132) is what ships -- never an exception, never
 * fabricated content.
 */

import { createDeepResearchFrameMessage } from '../../shared/deep-research-relay';

/**
 * How long to wait after the last DOM mutation before treating the report as
 * settled and relaying it. Re-armed by every later mutation, which is what
 * catches a report that renders progressively or virtualizes while scrolling.
 */
const QUIET_PERIOD_MS = 500;

/**
 * Stop watching after this long: a report still mutating past this point
 * isn't worth an indefinite observer running in a background frame.
 *
 * ponytail: a fixed ceiling, not an adaptive one -- raise it if a real
 * capture shows a report still rendering past 30s.
 */
const MAX_OBSERVE_MS = 30_000;

function relay(): void {
  // `innerText` (real Chrome) reflects only rendered, visible text; jsdom
  // (tests) has never implemented it, so fall back to `textContent` there.
  const text = (document.body?.innerText ?? document.body?.textContent ?? '').trim();
  if (!text) {
    return;
  }
  window.parent.postMessage(createDeepResearchFrameMessage(text), '*');
}

function watch(): void {
  relay();

  const root = document.body ?? document.documentElement;
  if (!root) {
    return;
  }

  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = Date.now() + MAX_OBSERVE_MS;

  const observer = new MutationObserver(() => {
    if (Date.now() > deadline) {
      observer.disconnect();
      return;
    }
    clearTimeout(quietTimer);
    quietTimer = setTimeout(relay, QUIET_PERIOD_MS);
  });

  observer.observe(root, { childList: true, subtree: true, characterData: true });

  setTimeout(() => observer.disconnect(), MAX_OBSERVE_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', watch);
} else {
  watch();
}
