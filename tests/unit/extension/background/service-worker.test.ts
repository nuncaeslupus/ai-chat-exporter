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
  // Controls what chrome.tabs.get(42) resolves the tab's URL to -- lets each
  // test decide whether the active tab is a supported chat host or not,
  // without re-importing the module. Defaults to a supported host so the
  // pre-existing injection tests keep exercising the same recovery path.
  let tabUrl: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    tabUrl = 'https://chatgpt.com/c/123';
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
        // Mirrors manifests/manifest.base.json's real two-entry shape (SEC-2):
        // a chat-host entry and an `all_frames` sandbox-only entry, so tests
        // catch injectContentScripts flattening both into every tab again.
        getManifest: vi.fn(() => ({
          version: '1.0.0',
          content_scripts: [
            {
              matches: [
                'https://chat.openai.com/*',
                'https://chatgpt.com/*',
                'https://claude.ai/*',
                'https://gemini.google.com/*',
              ],
              js: ['content/content-script.js'],
              css: ['content/styles.css'],
            },
            {
              matches: ['https://*.web-sandbox.oaiusercontent.com/*'],
              all_frames: true,
              js: ['content/deep-research-frame.js'],
            },
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
        get: vi.fn((id: number) => Promise.resolve({ id, url: tabUrl })),
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

  // TYPE-1 (high): `sendMessageToTab` treated a delivered reply (`result.ok`)
  // as the export having worked, without ever reading `result.response`. A
  // content script that correctly answers `{success: false, error}` — zero
  // pairs, no exporter for the format, an exporter throw, a blocked print
  // window — used to leave the badge cleared and log nothing.
  it('flags the badge when the content script replies with success: false', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sendMessageMock.mockResolvedValueOnce({
      success: false,
      error: 'No conversation pairs found to export',
    });

    onClickedHandler({ menuItemId: 'export-pdf' }, { id: 42 });
    await flush();

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(setBadgeTextMock).toHaveBeenCalledWith({ text: '!' });
    expect(
      errorSpy.mock.calls.some((call) =>
        call.some((arg) => typeof arg === 'string' && arg.includes('No conversation pairs found'))
      )
    ).toBe(true);

    errorSpy.mockRestore();
  });

  it('does not flag the badge when the content script replies with success: true', async () => {
    sendMessageMock.mockResolvedValueOnce({ success: true });

    onClickedHandler({ menuItemId: 'export-pdf' }, { id: 42 });
    await flush();

    expect(setBadgeTextMock).not.toHaveBeenCalledWith({ text: '!' });
  });

  // SEC-2 (high): chrome.commands.onCommand resolves whatever tab is active
  // with no host check, unlike the context menus (documentUrlPatterns) and
  // the popup (checkCurrentPage). Before the fix, the "no receiver" recovery
  // path injected the full content-script bundle into that tab regardless of
  // its URL -- the injection-scope fix in tab-messaging.ts's
  // injectContentScripts (honoring each manifest entry's `matches`) is what
  // actually closes this, since neither content_scripts entry matches an
  // unrelated host.
  it('does not inject anything when the keyboard shortcut fires on an unsupported site', async () => {
    tabUrl = 'https://mail.example.com/inbox';
    // No entry matches this host, so every attempt still finds nobody
    // listening -- there is no injection to eventually succeed. Fake timers
    // deterministically drain the full 5-attempt retry loop instead of
    // racing real 100ms delays, which would otherwise keep firing into
    // later tests.
    sendMessageMock.mockRejectedValue(NO_RECEIVER);

    vi.useFakeTimers();
    try {
      onCommandHandler('export-conversation');
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }

    expect(executeScriptMock).not.toHaveBeenCalled();
    expect(insertCSSMock).not.toHaveBeenCalled();
  });

  it('still recovers via the keyboard shortcut when the tab is a supported chat host', async () => {
    tabUrl = 'https://claude.ai/chat/1';
    sendMessageMock.mockRejectedValueOnce(NO_RECEIVER).mockResolvedValueOnce({ success: true });

    onCommandHandler('export-conversation');
    await flush();

    expect(executeScriptMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(sendMessageMock.mock.calls[1]?.[1]).toMatchObject({ type: 'export_conversation' });
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

// TEST-2: handleClaudeOrganizationsFetch (the sibling used by
// claude-api-service.ts's resolveOrganizationId to discover the org ID via
// the API instead of scraping the page) was reachable in production but
// unexercised by any test. Unlike fetch_claude_api_data this message carries
// no caller-supplied data -- the URL is hardcoded -- so there is no
// UUID-shaped input to validate; the gap is the request/response plumbing
// itself, most importantly that a failed fetch surfaces as failure (TYPE-1)
// rather than a silently empty result.
describe('fetch_claude_organizations message', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ organizations: [{ uuid: 'org-1' }] }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  async function send(
    message: unknown
  ): Promise<{ success: boolean; error?: string; data?: unknown }> {
    return new Promise((resolve) => {
      onMessageHandler(message, {}, (response) =>
        resolve(response as { success: boolean; error?: string; data?: unknown })
      );
    });
  }

  it('fetches the organizations endpoint and returns the parsed response', async () => {
    const response = await send({ type: 'fetch_claude_organizations' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://claude.ai/api/organizations');
    expect(response).toEqual({ success: true, data: { organizations: [{ uuid: 'org-1' }] } });
  });

  it('surfaces a non-OK response as a failure instead of a silent empty result', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve(undefined),
    });

    const response = await send({ type: 'fetch_claude_organizations' });

    expect(response.success).toBe(false);
    expect(response.error).toContain('500');
    expect(response.data).toBeUndefined();
  });

  it('does not fetch organizations for a non-object or differently-typed message', async () => {
    await send('fetch_claude_organizations');
    await send({ type: 'not_a_real_message' });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
