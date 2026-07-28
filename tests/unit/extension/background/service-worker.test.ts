import { describe, it, expect, vi, beforeAll } from 'vitest';

describe('export keyboard shortcut', () => {
  let sendMessageMock: ReturnType<typeof vi.fn>;
  let onCommandHandler: (command: string) => void;
  let onClickedHandler: (
    info: { menuItemId: string },
    tab: { id: number } | undefined,
  ) => void;

  beforeAll(async () => {
    sendMessageMock = vi.fn();

    const chromeMock = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
        getManifest: vi.fn(() => ({ version: '1.0.0' })),
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

  it('surfaces chrome.runtime.lastError when the content script is missing from a context-menu export', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Simulate the tab having no content script injected (tab loaded before
    // install / extension reloaded / unsupported page): sendMessage's
    // callback fires with chrome.runtime.lastError set and no response.
    sendMessageMock.mockImplementationOnce(
      (_tabId: number, _message: unknown, callback?: () => void) => {
        (chrome.runtime as unknown as { lastError?: { message: string } }).lastError = {
          message: 'Could not establish connection. Receiving end does not exist.',
        };
        callback?.();
        delete (chrome.runtime as unknown as { lastError?: { message: string } }).lastError;
      },
    );

    onClickedHandler({ menuItemId: 'export-pdf' }, { id: 42 });

    expect(errorSpy).toHaveBeenCalled();
    const loggedError = errorSpy.mock.calls.some((call) =>
      call.some(
        (arg) =>
          typeof arg === 'string' &&
          arg.includes('Could not establish connection'),
      ),
    );
    expect(loggedError).toBe(true);

    errorSpy.mockRestore();
  });
});
