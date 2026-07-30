/**
 * lo-9001: this script runs *inside* the sandboxed Deep Research iframe
 * (`*.web-sandbox.oaiusercontent.com`), reads the report it rendered, and
 * relays it to the parent page over `postMessage`. content-script.ts (tested
 * separately) is the receiving side.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

/** Must match QUIET_PERIOD_MS in deep-research-frame.ts. */
const QUIET_PERIOD_MS = 500;

/** Must match MAX_PLAUSIBLE_LENGTH in deep-research-frame.ts. */
const MAX_PLAUSIBLE_LENGTH = 200_000;

async function loadFrameScript(): Promise<void> {
  vi.resetModules();
  await import('../../../../src/extension/content/deep-research-frame');
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

  it("relays the frame's rendered text to the parent on load", async () => {
    document.body.textContent = 'The full Deep Research report.';

    await loadFrameScript();

    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'ai-chat-exporter:deep-research-report', text: 'The full Deep Research report.' },
      '*'
    );
  });

  it('sends nothing when the frame has no rendered text yet', async () => {
    document.body.textContent = '   ';

    await loadFrameScript();

    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it('re-relays updated text once mutations settle (progressive/virtualized rendering)', async () => {
    vi.useFakeTimers();
    document.body.textContent = 'Partial report...';

    await loadFrameScript();
    expect(postMessageSpy).toHaveBeenCalledTimes(1);

    document.body.textContent = 'Partial report... now complete.';
    // MutationObserver callbacks are queued as microtasks, not macrotasks --
    // flush the microtask queue before advancing the (faked) debounce timer.
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(QUIET_PERIOD_MS);

    expect(postMessageSpy).toHaveBeenCalledTimes(2);
    expect(postMessageSpy).toHaveBeenLastCalledWith(
      {
        type: 'ai-chat-exporter:deep-research-report',
        text: 'Partial report... now complete.',
      },
      '*'
    );
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
    it("prefers the nested #root iframe's document over the shell's own text", async () => {
      document.body.textContent = 'shell noise, not the report';
      const iframe = document.createElement('iframe');
      iframe.id = 'root';
      document.body.appendChild(iframe);
      iframe.contentDocument!.body.textContent = 'The nested report.';

      await loadFrameScript();

      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'ai-chat-exporter:deep-research-report', text: 'The nested report.' },
        '*'
      );
    });

    it('falls back to the first <iframe> when no #root id is present', async () => {
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      iframe.contentDocument!.body.textContent = 'Report via fallback iframe.';

      await loadFrameScript();

      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'ai-chat-exporter:deep-research-report', text: 'Report via fallback iframe.' },
        '*'
      );
    });

    it('relays nothing when the captured text exceeds the sanity bound', async () => {
      document.body.textContent = 'x'.repeat(MAX_PLAUSIBLE_LENGTH + 1);

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
      iframe.contentDocument!.body.textContent = 'Report loaded after navigation.';
      iframe.dispatchEvent(new Event('load'));

      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'ai-chat-exporter:deep-research-report', text: 'Report loaded after navigation.' },
        '*'
      );
    });
  });
});
