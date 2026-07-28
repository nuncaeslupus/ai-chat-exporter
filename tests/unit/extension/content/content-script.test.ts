/**
 * Content Script - export failure reporting tests
 *
 * Regression coverage for lo-2086: a failed export (or a conversation with
 * zero parsed pairs) must be reported to the popup as `success: false`,
 * not silently swallowed and reported as success.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('content-script print failure reporting (lo-f854)', () => {
  let printWindowStub: {
    document: { write: ReturnType<typeof vi.fn> };
    addEventListener: ReturnType<typeof vi.fn>;
    location: { href: string };
    close: ReturnType<typeof vi.fn>;
    print: ReturnType<typeof vi.fn>;
  };
  const spyOnWindowOpen = () => vi.spyOn(window, 'open');
  let openSpy: ReturnType<typeof spyOnWindowOpen>;

  beforeEach(() => {
    mockParse.mockReset();
    mockExport.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();

    printWindowStub = {
      document: { write: vi.fn() },
      addEventListener: vi.fn(),
      location: { href: '' },
      close: vi.fn(),
      print: vi.fn(),
    };
    openSpy = spyOnWindowOpen().mockReturnValue(printWindowStub as unknown as Window);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('reports success:false when printing fails', async () => {
    mockParse.mockReturnValue({ success: true, conversation: createTestConversation([]) });

    const listener = await loadMessageListener();
    const sendResponse = vi.fn();
    listener({ type: 'print_conversation', format: 'md' }, {}, sendResponse);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: expect.stringContaining('No conversation pairs found') as string,
    });
    // The pre-opened print window must not be left dangling on failure.
    expect(printWindowStub.close).toHaveBeenCalled();
  });

  it('reports success:false and never re-parses when the print popup is blocked', async () => {
    openSpy.mockReturnValue(null);
    mockParse.mockReturnValue({
      success: true,
      conversation: createTestConversation([createTestQAPair(0, 'Q', 'A')]),
    });

    const listener = await loadMessageListener();
    const sendResponse = vi.fn();
    listener({ type: 'print_conversation', format: 'md' }, {}, sendResponse);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: expect.stringContaining('popup') as string,
    });
    // window.open() must be the very first thing handlePrint does, before any
    // `await` — mockParse's only call is content-script's own module-load
    // initialize(), proving handlePrint's re-parse never ran after the
    // (blocked) open call.
    expect(mockParse).toHaveBeenCalledTimes(1);
  });

  it('opens the print window synchronously and fills it once content is ready', async () => {
    const pairs = [createTestQAPair(0, 'Q', 'A')];
    mockParse.mockReturnValue({ success: true, conversation: createTestConversation(pairs) });
    mockExport.mockResolvedValue({ success: true, blob: new Blob(['# hi']), mimeType: 'text/markdown' });

    const listener = await loadMessageListener();
    const sendResponse = vi.fn();
    listener({ type: 'print_conversation', format: 'html' }, {}, sendResponse);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(printWindowStub.location.href).toBe('blob:mock');
    expect(printWindowStub.close).not.toHaveBeenCalled();
  });
});

describe('content-script concurrent export/print isolation (lo-08b0)', () => {
  let printWindowStub: {
    document: { write: ReturnType<typeof vi.fn> };
    addEventListener: ReturnType<typeof vi.fn>;
    location: { href: string };
    close: ReturnType<typeof vi.fn>;
    print: ReturnType<typeof vi.fn>;
  };
  const spyOnWindowOpen = () => vi.spyOn(window, 'open');
  let openSpy: ReturnType<typeof spyOnWindowOpen>;

  beforeEach(() => {
    mockParse.mockReset();
    mockExport.mockReset();
    mockExtractIds.mockReset();
    mockFetchApiData.mockReset();
    mockEnrich.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();

    printWindowStub = {
      document: { write: vi.fn() },
      addEventListener: vi.fn(),
      location: { href: '' },
      close: vi.fn(),
      print: vi.fn(),
    };
    openSpy = spyOnWindowOpen().mockReturnValue(printWindowStub as unknown as Window);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('does not let a second export overwrite the first export in-flight conversation', async () => {
    const conversationA = {
      ...createTestConversation([createTestQAPair(0, 'Q-A', 'Answer-A')]),
      title: 'Conversation A',
    };
    const conversationB = {
      ...createTestConversation([
        createTestQAPair(0, 'Q-B1', 'Answer-B1'),
        createTestQAPair(1, 'Q-B2', 'Answer-B2'),
      ]),
      title: 'Conversation B',
    };
    mockParse
      .mockReturnValueOnce({ success: true, conversation: createTestConversation([]) }) // module-load initialize()
      .mockReturnValueOnce({ success: true, conversation: conversationA })
      .mockReturnValueOnce({ success: true, conversation: conversationB });
    mockExport.mockResolvedValue({ success: true, blob: new Blob(['x']) });

    const listener = await loadMessageListener();
    const sendResponseA = vi.fn();
    const sendResponseB = vi.fn();

    // Fire both without awaiting the first — an impatient double-click on Export.
    listener({ type: 'export_conversation', format: 'md' }, {}, sendResponseA);
    listener({ type: 'export_conversation', format: 'md' }, {}, sendResponseB);

    await vi.waitFor(() => {
      expect(sendResponseA).toHaveBeenCalled();
      expect(sendResponseB).toHaveBeenCalled();
    });

    expect(mockExport).toHaveBeenCalledTimes(2);
    const exportedConversations = mockExport.mock.calls.map((call) => call[0] as unknown);
    // Each export call must see its OWN parsed conversation — never the
    // other call's, and never both calls exporting the same (wrong) one.
    expect(exportedConversations).toContainEqual(conversationA);
    expect(exportedConversations).toContainEqual(conversationB);
  });

  it('does not let a concurrent export corrupt an in-flight print', async () => {
    const conversationPrint = {
      ...createTestConversation([createTestQAPair(0, 'Print-Q', 'Print-A')]),
      title: 'Print conversation',
    };
    const conversationExport = {
      ...createTestConversation([createTestQAPair(0, 'Export-Q', 'Export-A')]),
      title: 'Export conversation',
    };
    mockParse
      .mockReturnValueOnce({ success: true, conversation: createTestConversation([]) }) // module-load initialize()
      .mockReturnValueOnce({ success: true, conversation: conversationPrint })
      .mockReturnValueOnce({ success: true, conversation: conversationExport });
    mockExport.mockResolvedValue({ success: true, blob: new Blob(['x']), mimeType: 'text/html' });

    const listener = await loadMessageListener();
    const sendResponsePrint = vi.fn();
    const sendResponseExport = vi.fn();

    // Print starts first; Export fires while the print pipeline is mid-flight.
    listener({ type: 'print_conversation', format: 'html' }, {}, sendResponsePrint);
    listener({ type: 'export_conversation', format: 'md' }, {}, sendResponseExport);

    await vi.waitFor(() => {
      expect(sendResponsePrint).toHaveBeenCalled();
      expect(sendResponseExport).toHaveBeenCalled();
    });

    expect(mockExport).toHaveBeenCalledTimes(2);
    const exportedConversations = mockExport.mock.calls.map((call) => call[0] as unknown);
    expect(exportedConversations).toContainEqual(conversationPrint);
    expect(exportedConversations).toContainEqual(conversationExport);
  });
});
