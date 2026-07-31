import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

/** Chrome's "no content script in this tab" rejection, matched by tab-messaging. */
const NO_RECEIVER = new Error('Could not establish connection. Receiving end does not exist.');

/** Let every pending microtask in the send/inject/retry chain settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// Module-scoped (not inside a describe) so the second describe block below
// can drive the same `chrome.runtime.onMessage` listener the module
// registers once at import time, without a second import.
let onMessageHandler: (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean | void;

describe('export keyboard shortcut', () => {
  let sendMessageMock: ReturnType<typeof vi.fn>;
  let executeScriptMock: ReturnType<typeof vi.fn>;
  let insertCSSMock: ReturnType<typeof vi.fn>;
  let setBadgeTextMock: ReturnType<typeof vi.fn>;
  let onCommandHandler: (command: string) => void;
  let onClickedHandler: (info: { menuItemId: string }, tab: { id: number } | undefined) => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    sendMessageMock = vi.fn();
    executeScriptMock = vi.fn().mockResolvedValue(undefined);
    insertCSSMock = vi.fn().mockResolvedValue(undefined);
    setBadgeTextMock = vi.fn();

    const chromeMock = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: {
          addListener: vi.fn((handler: typeof onMessageHandler) => {
            onMessageHandler = handler;
          }),
        },
        getManifest: vi.fn(() => ({
          version: '1.0.0',
          content_scripts: [{ js: ['content/content-script.js'], css: ['content/styles.css'] }],
        })),
      },
      action: {
        setBadgeText: setBadgeTextMock,
        setBadgeBackgroundColor: vi.fn(),
      },
      scripting: {
        executeScript: executeScriptMock,
        insertCSS: insertCSSMock,
      },
      tabs: {
        onUpdated: { addListener: vi.fn() },
        query: vi.fn((_query: unknown, callback: (tabs: { id: number }[]) => void) => {
          callback([{ id: 42 }]);
        }),
        sendMessage: sendMessageMock,
      },
      contextMenus: {
        removeAll: vi.fn((cb: () => void) => {
          cb();
        }),
        create: vi.fn(),
        onClicked: {
          addListener: vi.fn((handler: typeof onClickedHandler) => {
            onClickedHandler = handler;
          }),
        },
      },
      commands: {
        onCommand: {
          addListener: vi.fn((handler: (command: string) => void) => {
            onCommandHandler = handler;
          }),
        },
      },
      i18n: {
        getMessage: vi.fn((key: string) => key),
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
        sync: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    };

    globalThis.chrome = chromeMock as unknown as typeof chrome;

    // Import after the chrome mock is in place: the module registers its
    // listeners (including chrome.commands.onCommand) at import time.
    await import('../../../../src/extension/background/service-worker');
  });

  it('pressing the registered shortcut sends a message the content script handles', async () => {
    onCommandHandler('export-conversation');

    // Flush the tabs.query callback + StorageService promise microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const [tabId, message] = sendMessageMock.mock.calls[0] as [
      number,
      { type: string; format?: string },
    ];
    expect(tabId).toBe(42);
    // content-script.ts's onMessage listener only handles 'export_conversation',
    // 'print_conversation', and 'get_conversation' — anything else (e.g. the old
    // 'show_export_dialog') is silently dropped.
    expect(message.type).toBe('export_conversation');
    expect(message.format).toBeTruthy();
  });

  it('injects the content script and delivers the export when the tab has none', async () => {
    // Tab loaded before install / extension reloaded: nothing is listening yet.
    sendMessageMock.mockRejectedValueOnce(NO_RECEIVER).mockResolvedValueOnce({ success: true });

    onClickedHandler({ menuItemId: 'export-pdf' }, { id: 42 });
    await flush();

    expect(executeScriptMock).toHaveBeenCalledTimes(1);
    // Retried after the injection, so the export actually reaches the page.
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(sendMessageMock.mock.calls[1]?.[1]).toMatchObject({
      type: 'export_conversation',
      format: 'pdf',
    });
    expect(setBadgeTextMock).not.toHaveBeenCalledWith({ text: '!' });
  });

  it('surfaces exactly one failure on the badge when the injection fails', async () => {
    sendMessageMock.mockRejectedValueOnce(NO_RECEIVER);
    executeScriptMock.mockRejectedValueOnce(new Error('Cannot access contents of the page'));

    onClickedHandler({ menuItemId: 'export-pdf' }, { id: 42 });
    await flush();

    // No point retrying a tab nothing can be injected into.
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const flagged = setBadgeTextMock.mock.calls.filter(
      ([details]) => (details as { text: string }).text === '!'
    );
    expect(flagged).toHaveLength(1);
  });

  it('reports a genuine messaging fault as an error without injecting', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sendMessageMock.mockRejectedValueOnce(new Error('Tab was discarded'));

    onClickedHandler({ menuItemId: 'export-pdf' }, { id: 42 });
    await flush();

    expect(executeScriptMock).not.toHaveBeenCalled();
    expect(setBadgeTextMock).toHaveBeenCalledWith({ text: '!' });
    expect(
      errorSpy.mock.calls.some((call) =>
        call.some((arg) => typeof arg === 'string' && arg.includes('Tab was discarded'))
      )
    ).toBe(true);

    errorSpy.mockRestore();
  });
});

// SEC-1 (low): organizationId/conversationId reach a credentialed claude.ai
// fetch (`credentials: 'include'`) via raw interpolation. One id source
// (claude-api-service.ts's `orgId`/`organizationId` URL param) is fully
// page-controlled and unvalidated, unlike every other source, which is
// UUID-shaped by regex. This is the trust boundary the message crosses, so
// a non-UUID id must be rejected here rather than reaching `fetch`.
describe('fetch_claude_api_data message validation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const VALID_ORG = '11111111-1111-4111-8111-111111111111';
  const VALID_CONVO = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ ok: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  async function send(
    data: unknown
  ): Promise<{ success: boolean; error?: string; data?: unknown }> {
    return new Promise((resolve) => {
      // A rejected message (isClaudeApiFetchMessage returns false) falls
      // through to the generic handler, which calls sendResponse
      // synchronously; a valid one resolves it asynchronously after fetch.
      onMessageHandler({ type: 'fetch_claude_api_data', data }, {}, (response) =>
        resolve(response as { success: boolean; error?: string; data?: unknown })
      );
    });
  }

  it('fetches with a well-formed UUID pair', async () => {
    const response = await send({ organizationId: VALID_ORG, conversationId: VALID_CONVO });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      `/organizations/${VALID_ORG}/chat_conversations/${VALID_CONVO}`
    );
    expect(response.success).toBe(true);
  });

  it('never calls fetch when organizationId is not a UUID (e.g. a page-controlled path escape)', async () => {
    await send({ organizationId: '../../evil', conversationId: VALID_CONVO });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never calls fetch when conversationId is not a UUID', async () => {
    await send({ organizationId: VALID_ORG, conversationId: '<script>alert(1)</script>' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never calls fetch when data is missing entirely', async () => {
    await send(undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
