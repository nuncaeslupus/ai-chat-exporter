/**
 * lo-9001: this script runs *inside* the sandboxed Deep Research iframe
 * (`*.web-sandbox.oaiusercontent.com`), reads the report it rendered, and
 * relays it to the parent page over `postMessage`. content-script.ts (tested
 * separately) is the receiving side.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Must match QUIET_PERIOD_MS in deep-research-frame.ts. */
const QUIET_PERIOD_MS = 500;

async function loadFrameScript(): Promise<void> {
  vi.resetModules();
  await import('../../../../src/extension/content/deep-research-frame');
}

describe('deep-research-frame relay', () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

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
});
