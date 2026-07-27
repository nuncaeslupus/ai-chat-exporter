import { describe, it, expect, vi, beforeAll } from 'vitest';

describe('export keyboard shortcut', () => {
  let sendMessageMock: ReturnType<typeof vi.fn>;
  let onCommandHandler: (command: string) => void;

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
        onClicked: { addListener: vi.fn() },
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
});
