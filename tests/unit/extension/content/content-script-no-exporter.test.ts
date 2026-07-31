/**
 * I18N-1: `getExporter(format)` returning nothing (should be unreachable
 * from the popup's own format list, but is a real defensive branch) used to
 * throw a raw English literal instead of a locale key. Isolated in its own
 * file — unlike content-script.test.ts's shared getExporter mock, this one
 * needs `getExporter` to always return undefined, and per-test overrides of
 * a hoisted `vi.mock()` factory are not safely reversible across the many
 * describe blocks in that file.
 */
import { describe, it, expect, vi } from 'vitest';
import { createTestQAPair, createTestConversation } from '../../../utils/exporter-helpers';
import { ERROR_KEYS } from '../../../../src/shared/constants';

const mockParse = vi.fn();

vi.mock('../../../../src/core/parsers', () => ({
  detectParser: () => ({
    platformInfo: { id: 'chatgpt', name: 'ChatGPT', urlPatterns: [] },
    parse: mockParse,
  }),
}));

vi.mock('../../../../src/core/exporters', () => ({
  getExporter: () => undefined,
}));

async function loadMessageListener() {
  vi.resetModules();
  await import('../../../../src/extension/content/content-script');
  // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mocks don't use `this`
  const addListener = chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>;
  const calls = addListener.mock.calls;
  const lastCall = calls[calls.length - 1];
  if (!lastCall) {
    throw new Error('chrome.runtime.onMessage.addListener was not called');
  }
  return lastCall[0] as (
    message: unknown,
    sender: unknown,
    sendResponse: (response: unknown) => void
  ) => boolean;
}

describe('content-script: no exporter registered for the format', () => {
  it('reports a locale key, not an English literal', async () => {
    const pairs = [createTestQAPair(0, 'Q', 'A')];
    mockParse.mockReturnValue({ success: true, conversation: createTestConversation(pairs) });

    const listener = await loadMessageListener();
    const sendResponse = vi.fn();
    listener({ type: 'export_conversation', format: 'md' }, {}, sendResponse);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: ERROR_KEYS.NO_EXPORTER,
    });
  });
});
