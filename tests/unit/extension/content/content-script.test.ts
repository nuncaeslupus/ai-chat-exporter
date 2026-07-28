/**
 * Content Script - export failure reporting tests
 *
 * Regression coverage for lo-2086: a failed export (or a conversation with
 * zero parsed pairs) must be reported to the popup as `success: false`,
 * not silently swallowed and reported as success.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestQAPair, createTestConversation } from '../../../utils/exporter-helpers';

const mockParse = vi.fn();
const mockExport = vi.fn();
const mockExtractIds = vi.fn();
const mockFetchApiData = vi.fn();
const mockEnrich = vi.fn();

vi.mock('../../../../src/core/parsers', () => ({
  detectParser: () => ({
    platformInfo: { id: 'chatgpt', name: 'ChatGPT', urlPatterns: [] },
    parse: mockParse,
  }),
}));

vi.mock('../../../../src/core/services/claude-api-service', () => ({
  ClaudeApiService: {
    extractIdsFromPage: (...args: unknown[]) => mockExtractIds(...args) as unknown,
    fetchConversationData: (...args: unknown[]) => mockFetchApiData(...args) as unknown,
    enrichConversationWithArtifacts: (...args: unknown[]) => mockEnrich(...args) as unknown,
  },
}));

vi.mock('../../../../src/core/exporters', () => ({
  getExporter: () => ({
    extension: 'md',
    mimeType: 'text/markdown',
    export: mockExport,
  }),
}));

/** Grab the message listener content-script.ts registers on import. */
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

describe('content-script export failure reporting', () => {
  beforeEach(() => {
    mockParse.mockReset();
    mockExport.mockReset();
  });

  it('reports success:false when the exporter throws', async () => {
    const pairs = [createTestQAPair(0, 'Q', 'A')];
    mockParse.mockReturnValue({ success: true, conversation: createTestConversation(pairs) });
    mockExport.mockRejectedValue(new Error('boom'));

    const listener = await loadMessageListener();
    const sendResponse = vi.fn();
    listener({ type: 'export_conversation', format: 'md' }, {}, sendResponse);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'boom' });
  });

  it('reports a parse failure when the conversation has zero pairs', async () => {
    mockParse.mockReturnValue({ success: true, conversation: createTestConversation([]) });

    const listener = await loadMessageListener();
    const sendResponse = vi.fn();
    listener({ type: 'export_conversation', format: 'md' }, {}, sendResponse);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: expect.stringContaining('No conversation pairs found') as string,
    });
    expect(mockExport).not.toHaveBeenCalled();
  });
});

describe('content-script degraded-export reporting (lo-872a)', () => {
  beforeEach(() => {
    mockParse.mockReset();
    mockExport.mockReset();
    mockExtractIds.mockReset();
    mockFetchApiData.mockReset();
    mockEnrich.mockReset();
    // jsdom has no object-URL support; these tests reach the download path.
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  it('reports the enrichment skip to the popup instead of exporting silently', async () => {
    const pairs = [createTestQAPair(0, 'Q', 'A')];
    const conversation = { ...createTestConversation(pairs), platform: 'claude' as const };
    mockParse.mockReturnValue({ success: true, conversation });
    mockExport.mockResolvedValue({ success: true, blob: new Blob(['# hi']) });
    mockExtractIds.mockReturnValue({ organizationId: 'org-1', conversationId: 'conv-1' });
    mockFetchApiData.mockResolvedValue({ chat_messages: [] });
    mockEnrich.mockReturnValue({
      conversation,
      warning: 'Artifact contents could not be matched to this conversation.',
    });

    const listener = await loadMessageListener();
    const sendResponse = vi.fn();
    listener({ type: 'export_conversation', format: 'md' }, {}, sendResponse);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });
    // The export still happens (a partial export beats no export) — but the
    // user is told the artifacts are missing.
    expect(mockExport).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      warning: expect.stringContaining('Artifact contents') as string,
    });
  });

  it('reports no warning when enrichment succeeds', async () => {
    const pairs = [createTestQAPair(0, 'Q', 'A')];
    const conversation = { ...createTestConversation(pairs), platform: 'claude' as const };
    mockParse.mockReturnValue({ success: true, conversation });
    mockExport.mockResolvedValue({ success: true, blob: new Blob(['# hi']) });
    mockExtractIds.mockReturnValue({ organizationId: 'org-1', conversationId: 'conv-1' });
    mockFetchApiData.mockResolvedValue({ chat_messages: [] });
    mockEnrich.mockReturnValue({ conversation });

    const listener = await loadMessageListener();
    const sendResponse = vi.fn();
    listener({ type: 'export_conversation', format: 'md' }, {}, sendResponse);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });
});
