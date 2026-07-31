/**
 * lo-9001: this script runs *inside* the sandboxed Deep Research iframe
 * (`*.web-sandbox.oaiusercontent.com`), reads the report it rendered, and
 * relays it to the parent page over `postMessage`. content-script.ts (tested
 * separately) is the receiving side.
 *
 * D-31/D-33: the relay prefers sanitized HTML (keeps headings/lists/tables
 * intact for the structure-parsing path) and falls back to flattened text --
 * today's behavior -- when the HTML path comes back empty, over its own
 * sanity bound, or (D-33, re-landing #196 after #198's revert) captures
 * materially less substance than the text tier would have.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { CHATGPT_PARENT_ORIGINS } from '../../../../src/shared/deep-research-relay';

/** Must match QUIET_PERIOD_MS in deep-research-frame.ts. */
const QUIET_PERIOD_MS = 500;

/** Must match MAX_PLAUSIBLE_LENGTH in deep-research-frame.ts. */
const MAX_PLAUSIBLE_LENGTH = 200_000;

/** Must match MAX_PLAUSIBLE_HTML_LENGTH in deep-research-frame.ts. */
const MAX_PLAUSIBLE_HTML_LENGTH = 600_000;

async function loadFrameScript(): Promise<void> {
  vi.resetModules();
  await import('../../../../src/extension/content/deep-research-frame');
}

/**
 * SEC-3: the relay now posts once per allowed origin instead of once with
 * `'*'` -- asserts the message reached every entry in the allowlist (order
 * doesn't matter -- `toHaveBeenCalledWith` searches all recorded calls, not
 * just the last) and that no call ever used the wildcard.
 */
function expectRelayed(
  postMessageSpy: MockInstance,
  content: { html: string } | { text: string }
): void {
  const message = { type: 'ai-chat-exporter:deep-research-report', ...content };
  for (const origin of CHATGPT_PARENT_ORIGINS) {
    expect(postMessageSpy).toHaveBeenCalledWith(message, origin);
  }
  expect(postMessageSpy.mock.calls.some(([, origin]) => origin === '*')).toBe(false);
}

describe('deep-research-frame relay', () => {
  let postMessageSpy: MockInstance;

  beforeEach(() => {
    document.body.innerHTML = '';
    postMessageSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
    vi.useRealTimers();
    // Each `loadFrameScript()` attaches a MutationObserver to `document.body`
    // that outlives the test (it disconnects only after MAX_OBSERVE_MS or a
    // long quiet period) -- swap in a fresh body so the next test's mutations
    // aren't also picked up by every previous test's still-live observer.
    const freshBody = document.createElement('body');
    document.documentElement.replaceChild(freshBody, document.body);
  });

  it("relays the frame's rendered content as HTML on load", async () => {
    document.body.innerHTML = '<h1>Report Title</h1><p>The full Deep Research report.</p>';

    await loadFrameScript();

    expectRelayed(postMessageSpy, {
      html: '<h1>Report Title</h1><p>The full Deep Research report.</p>',
    });
  });

  it('sends nothing when the frame has no rendered content yet', async () => {
    document.body.textContent = '   ';

    await loadFrameScript();

    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it('strips inlined <script>/<style> before relaying, never counting them toward the bound', async () => {
    document.body.innerHTML =
      '<p>Real content.</p>' + `<script>${'x'.repeat(500_000)}</script>` + '<style>body{}</style>';

    await loadFrameScript();

    expectRelayed(postMessageSpy, { html: '<p>Real content.</p>' });
  });

  it('re-relays updated content once mutations settle (progressive/virtualized rendering)', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<p>Partial report...</p>';

    await loadFrameScript();
    expect(postMessageSpy).toHaveBeenCalledTimes(CHATGPT_PARENT_ORIGINS.length);

    document.body.innerHTML = '<p>Partial report... now complete.</p>';
    // MutationObserver callbacks are queued as microtasks, not macrotasks --
    // flush the microtask queue before advancing the (faked) debounce timer.
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(QUIET_PERIOD_MS);

    // One post per relay tick per allowed origin -- two relay ticks so far.
    expect(postMessageSpy).toHaveBeenCalledTimes(2 * CHATGPT_PARENT_ORIGINS.length);
    expectRelayed(postMessageSpy, { html: '<p>Partial report... now complete.</p>' });
  });

  // lo-6333: on a live page the report doesn't render into this frame's own
  // document -- it renders into a nested, same-origin `about:blank` iframe
  // (`#root`) that the widget runtime creates inside it. None of this can be
  // exercised end-to-end here (no fixture can hold a cross-document nested
  // frame's content, and jsdom lacks `innerText`), but jsdom does support a
  // real, synchronously-accessible `contentDocument` for a plain same-origin
  // `<iframe>`, which is enough to unit-test the *selection* logic below with
  // a stubbed nested frame.
  describe('nested #root frame selection', () => {
    it("prefers the nested #root iframe's document over the shell's own content", async () => {
      document.body.textContent = 'shell noise, not the report';
      const iframe = document.createElement('iframe');
      iframe.id = 'root';
      document.body.appendChild(iframe);
      iframe.contentDocument!.body.innerHTML = '<p>The nested report.</p>';

      await loadFrameScript();

      expectRelayed(postMessageSpy, { html: '<p>The nested report.</p>' });
    });

    it('falls back to the first <iframe> when no #root id is present', async () => {
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      iframe.contentDocument!.body.innerHTML = '<p>Report via fallback iframe.</p>';

      await loadFrameScript();

      expectRelayed(postMessageSpy, { html: '<p>Report via fallback iframe.</p>' });
    });

    it('falls back to flattened text when HTML exceeds its sanity bound but the text does not', async () => {
      // A long attribute (not more elements) inflates sanitized-HTML length
      // without the DOM-element count that made an earlier, tag-repetition
      // version of this test slow under parallel load: one text char per
      // element, but ~9 KB of surviving `class` attribute per element, so a
      // handful of elements clears MAX_PLAUSIBLE_HTML_LENGTH while the
      // flattened text stays tiny -- the layered-fallback path, not just the
      // single bound the text-only relay used to have.
      const repeatCount = 100;
      const filler = 'x'.repeat(9_000);
      const unit = `<b class="${filler}">x</b>`;
      document.body.innerHTML = unit.repeat(repeatCount);
      expect(unit.repeat(repeatCount).length).toBeGreaterThan(MAX_PLAUSIBLE_HTML_LENGTH);
      expect('x'.repeat(repeatCount).length).toBeLessThan(MAX_PLAUSIBLE_LENGTH);

      await loadFrameScript();

      expectRelayed(postMessageSpy, { text: 'x'.repeat(repeatCount) });
    });

    it('relays nothing when both the HTML and the flattened text exceed their sanity bounds', async () => {
      // Plain text (no tags) makes the sanitized HTML the same length as the
      // flattened text, so a single string over the larger (HTML) bound
      // exceeds both tiers at once.
      document.body.textContent = 'x'.repeat(MAX_PLAUSIBLE_HTML_LENGTH + 1);

      await loadFrameScript();

      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it("re-attaches to the nested document on the iframe's load event", async () => {
      const iframe = document.createElement('iframe');
      iframe.id = 'root';
      document.body.appendChild(iframe);
      // Empty at first -- e.g. `about:blank` before the widget runtime has
      // populated it -- so there is nothing to relay yet.

      await loadFrameScript();
      expect(postMessageSpy).not.toHaveBeenCalled();

      // The child document is populated/navigated later; `load` re-fires.
      iframe.contentDocument!.body.innerHTML = '<p>Report loaded after navigation.</p>';
      iframe.dispatchEvent(new Event('load'));

      expectRelayed(postMessageSpy, { html: '<p>Report loaded after navigation.</p>' });
    });
  });

  // D-33 (re-land of D-31/#196, reverted in #198): on a live page the HTML
  // tier's `cloneNode()`-based capture missed almost the entire report body,
  // while the text tier (unchanged since #194) captured it in full -- the
  // whole export collapsed to one line of widget chrome. #196 shipped with NO
  // check comparing the two tiers' substance, so a "successful" (non-empty,
  // in-bounds) but near-empty HTML capture was relayed as if it were complete.
  //
  // jsdom cannot reproduce the live-page mechanism itself (no `innerText`, so
  // it cannot render across e.g. a Shadow DOM boundary the way real Chrome
  // does) -- but the defect is in the comparison the code makes, not in any
  // one browser quirk, so it is reproduced here by giving the body a real
  // `innerText` (simulating what real Chrome would report for a host element
  // whose substantial content the light-DOM clone cannot see) that is far
  // larger than what a `cloneNode()`-based capture of the same body finds.
  describe('HTML tier vs text tier substance comparison (D-33)', () => {
    const REALISTIC_REPORT_TEXT =
      'Uso de mangueras de agua en incendios grandes\n\n' +
      'Resumen ejecutivo\n' +
      'El agua enfria y sofoca las llamas en incendios de gran escala.\n\n' +
      'Tacticas de ataque directo\n' +
      'El chorro directo se emplea cuando el fuego esta en su fase de crecimiento.\n\n' +
      'Caso de estudio 1\n' +
      'Descripcion detallada del incidente, coordinacion entre unidades.\n\n' +
      'Caso de estudio 2\n' +
      'Otra descripcion detallada de un incidente distinto.\n';

    it('falls back to the text tier when the HTML tier is a near-empty shell next to it', async () => {
      // A sparse light DOM -- e.g. a host element whose real content lives
      // somewhere `cloneNode()` cannot reach -- so the HTML tier's own text
      // substance is tiny, while `innerText` (real Chrome) reports the full
      // rendered report.
      document.body.innerHTML = '<div id="widget-host"></div>';
      Object.defineProperty(document.body, 'innerText', {
        value: REALISTIC_REPORT_TEXT,
        configurable: true,
      });

      await loadFrameScript();

      expectRelayed(postMessageSpy, { text: REALISTIC_REPORT_TEXT.trim() });
    });

    it('still prefers HTML when its substance is close to the text tier (normal script/style stripping gap)', async () => {
      document.body.innerHTML =
        '<h1>Uso de mangueras de agua</h1><p>El agua enfria y sofoca las llamas.</p>';
      Object.defineProperty(document.body, 'innerText', {
        // Same substance, just how real Chrome would report it -- no material gap.
        value: 'Uso de mangueras de agua\nEl agua enfria y sofoca las llamas.',
        configurable: true,
      });

      await loadFrameScript();

      expectRelayed(postMessageSpy, {
        html: '<h1>Uso de mangueras de agua</h1><p>El agua enfria y sofoca las llamas.</p>',
      });
    });
  });
});
