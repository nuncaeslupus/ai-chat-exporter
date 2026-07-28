import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

/** Chrome's "no content script in this tab" rejection, matched by tab-messaging. */
const NO_RECEIVER = new Error(
  'Could not establish connection. Receiving end does not exist.',
);

/** Let every pending microtask in the send/inject/retry chain settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('export keyboard shortcut', () => {
  let sendMessageMock: ReturnType<typeof vi.fn>;
  let executeScriptMock: ReturnType<typeof vi.fn>;
  let insertCSSMock: ReturnType<typeof vi.fn>;
  let setBadgeTextMock: ReturnType<typeof vi.fn>;
  let onCommandHandler: (command: string) => void;
  let onClickedHandler: (
    info: { menuItemId: string },
    tab: { id: number } | undefined,
  ) => void;

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
        onMessage: { addListener: vi.fn() },
        getManifest: vi.fn(() => ({
          version: '1.0.0',
          content_scripts: [
            { js: ['content/content-script.js'], css: ['content/styles.css'] },
          ],
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
      ([details]) => (details as { text: string }).text === '!',
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
        call.some((arg) => typeof arg === 'string' && arg.includes('Tab was discarded')),
      ),
    ).toBe(true);

    errorSpy.mockRestore();
  });
});
