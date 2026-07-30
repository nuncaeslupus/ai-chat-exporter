/**
 * Runs *inside* the sandboxed cross-origin iframe ChatGPT uses for Deep
 * Research and sibling connector widgets (`*.web-sandbox.oaiusercontent.com`).
 * `allow-same-origin` keeps the frame's own origin, which is what lets a
 * content script attach here at all -- but the frame is still cross-origin
 * from the parent page, so this is the only way anything in the extension
 * ever gets to look at what the frame rendered (lo-9001).
 *
 * The report itself does not live in this frame's own document -- it renders
 * in a nested, same-origin `about:blank` iframe (`#root`) that the widget
 * runtime creates inside the shell (lo-6333, measured live: shell body is 5
 * chars, the nested iframe's body holds the full report). `allow-same-origin`
 * on the shell is what makes that nested document reachable via
 * `contentDocument` despite being cross-document from this script's own.
 *
 * Relays the rendered text out to the parent page over `postMessage`; the
 * parent's content script (content-script.ts) matches the message back to the
 * right <iframe> element by `event.source` and stashes the text there for the
 * ChatGPT parser to read. If this script never runs, never finds any text, or
 * the message never arrives, the parser's fallback (naming the widget,
 * lo-f132) is what ships -- never an exception, never fabricated content.
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

/**
 * A real report is tens of KB of rendered text. Reading the *nested* frame's
 * raw `textContent` measured ~13.3 MB on a live page -- it includes inlined
 * `<script>` bodies. Anything past this bound means capture grabbed markup,
 * not rendered text; refuse to relay it rather than ship a multi-megabyte
 * blob into every exporter.
 */
const MAX_PLAUSIBLE_LENGTH = 200_000;

/**
 * Finds the nested frame the report renders into. `#root` is what the widget
 * runtime currently names it; fall back to the first `<iframe>` in case that
 * id changes.
 */
function findFrame(): HTMLIFrameElement | null {
  return (
    document.querySelector<HTMLIFrameElement>('iframe#root') ??
    document.querySelector<HTMLIFrameElement>('iframe')
  );
}

/** `contentDocument` throws instead of returning null if the frame is ever cross-origin. */
function nestedDocument(iframe: HTMLIFrameElement | null): Document | null {
  if (!iframe) {
    return null;
  }
  try {
    return iframe.contentDocument;
  } catch {
    return null;
  }
}

/**
 * The document actually holding the report: the nested frame's when one
 * exists and is reachable, otherwise this script's own document (some
 * connector widgets that reuse this same content script render directly into
 * the shell, with no nested frame at all).
 */
function targetDocument(): Document {
  return nestedDocument(findFrame()) ?? document;
}

function extractText(doc: Document): string {
  const body = doc.body;
  if (!body) {
    return '';
  }
  // `innerText` (real Chrome) reflects only rendered, visible text. jsdom
  // (tests) has never implemented it -- approximate it there by stripping
  // <script>/<style> rather than falling back to raw `textContent`, which
  // would include inlined script bodies (the 13.3 MB measurement above).
  if (typeof body.innerText === 'string') {
    return body.innerText.trim();
  }
  const clone = body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, style').forEach((el) => el.remove());
  return (clone.textContent ?? '').trim();
}

function relay(): void {
  const text = extractText(targetDocument());
  if (!text) {
    return;
  }
  if (text.length > MAX_PLAUSIBLE_LENGTH) {
    // Never relay partial-looking-complete or markup-sized content -- the
    // honest placeholder is better than a multi-megabyte blob.
    console.warn(
      `[ai-chat-exporter] deep-research-frame: captured ${text.length} chars, ` +
        `over the ${MAX_PLAUSIBLE_LENGTH} sanity bound -- not relaying`
    );
    return;
  }
  window.parent.postMessage(createDeepResearchFrameMessage(text), '*');
}

function watch(): void {
  relay();

  const deadline = Date.now() + MAX_OBSERVE_MS;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | undefined;
  let observedIframe: HTMLIFrameElement | null = null;

  function scheduleRelay(): void {
    if (Date.now() > deadline) {
      observer?.disconnect();
      return;
    }
    clearTimeout(quietTimer);
    quietTimer = setTimeout(relay, QUIET_PERIOD_MS);
  }

  // Observes whichever document currently holds the report. Re-attaching (not
  // just re-reading) matters because a MutationObserver only sees mutations
  // in the document it was attached to -- one bound to the shell's body can
  // never see mutations inside a separate, nested document.
  function attachObserver(): void {
    const doc = targetDocument();
    const root = doc.body ?? doc.documentElement;
    if (!root) {
      return;
    }
    observer?.disconnect();
    observer = new MutationObserver(onMutation);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }

  function onNestedFrameReady(): void {
    attachObserver();
    relay();
  }

  function onMutation(): void {
    // The nested #root iframe can appear (or navigate to a new document)
    // after we started watching -- notice it and switch what we observe so
    // we never stay latched onto a stale or empty document (lo-6333).
    const iframe = findFrame();
    if (iframe && iframe !== observedIframe) {
      observedIframe = iframe;
      iframe.addEventListener('load', onNestedFrameReady);
      if (nestedDocument(iframe)) {
        attachObserver();
      }
    }
    scheduleRelay();
  }

  observedIframe = findFrame();
  observedIframe?.addEventListener('load', onNestedFrameReady);
  attachObserver();

  setTimeout(() => observer?.disconnect(), MAX_OBSERVE_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', watch);
} else {
  watch();
}
