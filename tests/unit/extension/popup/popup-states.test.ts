/**
 * Popup — secondary states (lo-18d4 / R7)
 *
 * The five states that are not the plain "ready" screen: detecting, nothing
 * selected, exported-with-warnings, unsupported page, and reload-needed. Each
 * has to reach its own condition from the real code path, not a test hook, and
 * paint inside the same fixed box — so every assertion here drives the popup
 * through `checkCurrentPage()` / `handleExport()` rather than poking state.
 *
 * The DOM is the real popup.html so a markup change that drops an element
 * these tests drive fails here rather than in the browser.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createTestQAPair } from '../../../utils/exporter-helpers';
import { WARNING_KEYS } from '../../../../src/shared/constants';

const mockTabsQuery = vi.fn();
const mockTabsGet = vi.fn();
const mockTabsSendMessage = vi.fn();
const mockTabsCreate = vi.fn();
const mockTabsReload = vi.fn();
const mockExecuteScript = vi.fn();
const mockInsertCSS = vi.fn();

/**
 * What the shipped manifest declares; the injection helper reads it from
 * there and (SEC-2) filters entries by `matches` against the tab's URL via
 * `chrome.tabs.get`, so the stub needs `matches` too, not just file lists.
 */
const MANIFEST = {
  version: '1.1.1',
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
  ],
};

/** Chrome's wording for "nobody is listening in that tab". */
const NO_RECEIVER = 'Could not establish connection. Receiving end does not exist.';

const EN_MESSAGES: Record<string, string> = {
  statusReady: 'Ready',
  statusNotSupported: 'Not supported',
  statusNoConversation: 'No conversation',
  statusReloadNeeded: 'Reload needed',
  statusPageCheckFailed: 'Check failed',
  statusArtifactsMissing: 'Artifacts missing',
  noConversationFoundTitle: "Couldn't find a conversation here",
  noConversationFoundMessage: 'This page is supported, but no messages could be read.',
  conversationUntitled: 'Untitled',
  platformChatGPT: 'ChatGPT',
  platformClaude: 'Claude',
  platformGemini: 'Gemini',
  rowContent: 'Content',
  rowContentAll: 'Whole conversation',
  rowContentNoSelection: 'No pairs selected',
  rowContentChoosePairs: 'Choose pairs',
  exportButtonFormat: 'Export $1',
  exportButtonAgain: 'Export again',
  exportWarningTitle: 'Saved, but incomplete',
  exportWarningRetry: 'Retry',
  warningArtifactsIdsMissing:
    "Artifact contents and Claude's per-message timestamps were left out of this export because this page's conversation details couldn't be found. Reload the page, make sure you're signed in to claude.ai, then export again.",
  warningArtifactsFetchFailed:
    "Artifact contents and Claude's per-message timestamps were left out of this export because Claude's conversation data couldn't be fetched. This can be temporary — try exporting again.",
  formatNameMD: 'Markdown',
  platformLinkOpen: 'Open $1 in a new tab',
  reloadPageButton: 'Reload the page',
};

function mockI18n() {
  return {
    getUILanguage: () => 'en',
    getMessage: (key: string, substitutions?: string | string[]) => {
      const message = EN_MESSAGES[key] ?? key;
      if (!substitutions) return message;
      const values = Array.isArray(substitutions) ? substitutions : [substitutions];
      return values.reduce((text, value, i) => text.replace(`$${String(i + 1)}`, value), message);
    },
  };
}

const POPUP_HTML = readFileSync(
  resolve(__dirname, '../../../../src/extension/popup/popup.html'),
  'utf-8'
)
  .replace(/[\s\S]*<body>/, '')
  .replace(/<\/body>[\s\S]*/, '')
  .replace(/<script[\s\S]*?<\/script>/g, '');

const POPUP_CSS = readFileSync(
  resolve(__dirname, '../../../../src/extension/popup/popup.css'),
  'utf-8'
);

const CONVERSATION = {
  id: 'conv-1',
  title: 'Test conversation',
  platform: 'claude',
  pairs: [
    createTestQAPair(0, 'First question', 'First answer'),
    createTestQAPair(1, 'Second', 'Answer'),
  ],
  url: 'https://claude.ai/chat/abc',
};

function uiState(): string | null {
  return document.getElementById('popup-body')?.getAttribute('data-ui-state') ?? null;
}

/**
 * Boot the popup against the real markup. `beforeImport` runs after the module
 * registry is reset but before popup.ts loads, which is the only window where
 * a fake parser can be registered into the very `parserRegistry` instance the
 * popup will import.
 */
async function loadPopup(beforeImport?: () => Promise<void>): Promise<void> {
  document.body.innerHTML = POPUP_HTML;
  vi.resetModules();
  if (beforeImport) await beforeImport();
  await import('../../../../src/extension/popup/popup');
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

function baseChrome(): void {
  mockTabsQuery.mockReset();
  // Only the injection-recovery tests exercise this; default it to the same
  // tab those tests already drive everything else with.
  mockTabsGet.mockReset().mockResolvedValue({ id: 1, url: 'https://claude.ai/chat/abc' });
  mockTabsSendMessage.mockReset();
  mockTabsCreate.mockReset();
  mockTabsReload.mockReset();
  mockExecuteScript.mockReset().mockResolvedValue([]);
  mockInsertCSS.mockReset().mockResolvedValue(undefined);
  Object.assign(chrome, {
    tabs: {
      query: mockTabsQuery,
      get: mockTabsGet,
      sendMessage: mockTabsSendMessage,
      create: mockTabsCreate,
      reload: mockTabsReload,
    },
    scripting: { executeScript: mockExecuteScript, insertCSS: mockInsertCSS },
    runtime: { getManifest: () => MANIFEST },
    i18n: mockI18n(),
  });
}

describe('popup secondary states — the state switch', () => {
  beforeEach(baseChrome);

  it('starts in the detecting state with its skeleton block in the box', async () => {
    // Never resolves: the popup stays in whatever state it starts in.
    mockTabsQuery.mockReturnValue(new Promise(() => undefined));
    await loadPopup();

    expect(uiState()).toBe('detecting');
    expect(document.getElementById('state-detecting')).not.toBeNull();
  });

  it('gives every state its own block, so only one paints at a time', () => {
    for (const state of ['detecting', 'unsupported', 'reload']) {
      expect(POPUP_CSS).toContain(`[data-ui-state='${state}'] #state-${state}`);
    }
    expect(POPUP_CSS).toContain('.state-block {\n  display: none;');
    expect(POPUP_CSS).toContain("[data-ui-state='warning'] .warning-card");
  });

  it('hides the conversation block, setting rows, and action bar for the error state, leaving only the error card', () => {
    // Without this, `#main-content` stayed visible under `.error-card`: an
    // empty `-` conversation title, a blank meta line, navigable-looking
    // setting rows, and a live-looking (but `disabled`) Export button.
    for (const cls of ['.conversation-block', '.setting-rows', '.action-bar']) {
      const escaped = cls.replace('.', '\\.');
      expect(POPUP_CSS).toMatch(
        new RegExp(
          `\\.popup-body\\[data-ui-state='error'\\][^{]*${escaped}[^{]*\\{[^}]*display:\\s*none`
        )
      );
    }
  });
});

describe('popup secondary states — unsupported page', () => {
  beforeEach(baseChrome);

  it('shows the unsupported state on a page no parser claims', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com/' }]);
    await loadPopup();

    await vi.waitFor(() => {
      expect(uiState()).toBe('unsupported');
    });
    expect(document.getElementById('status-text')?.textContent).toBe('Not supported');
  });

  it('lists one link per registered platform, generated from parserRegistry', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com/' }]);
    await loadPopup();

    const { parserRegistry } = await import('../../../../src/core/parsers');
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#platform-links .platform-link')).toHaveLength(
        parserRegistry.size
      );
    });
    expect(
      [...document.querySelectorAll('#platform-links .platform-link-name')].map(
        (el) => el.textContent
      )
    ).toEqual(['ChatGPT', 'Claude', 'Gemini']);
  });

  it('picks up a fourth platform the moment its parser is registered', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com/' }]);
    await loadPopup(async () => {
      const { parserRegistry } = await import('../../../../src/core/parsers');
      // The popup only reads the keys, so the factory never has to build one.
      parserRegistry.set('mistral', (() => null) as never);
    });

    await vi.waitFor(() => {
      expect(document.querySelectorAll('#platform-links .platform-link')).toHaveLength(4);
    });
  });

  it('opens a platform link in a new tab instead of navigating the popup', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com/' }]);
    await loadPopup();

    const link = await vi.waitFor(() => {
      const el = document.querySelector<HTMLAnchorElement>('#platform-links .platform-link');
      expect(el).not.toBeNull();
      return el!;
    });
    link.click();

    expect(mockTabsCreate).toHaveBeenCalledWith({ url: 'https://chatgpt.com' });
  });
});

/**
 * A supported URL whose content script answered but whose parser found no
 * conversation on the page — distinct from a genuinely unsupported page
 * (lo-72f5). Conflating the two showed the "no chatbot detected" screen, with
 * its "open one of these pages" links, while the user was already standing on
 * a supported page — a navigation prompt for what is actually a parse bug.
 */
describe('popup secondary states — no conversation found on a supported page', () => {
  beforeEach(baseChrome);

  it('does not show the unsupported screen when the URL is supported but nothing parsed', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://chatgpt.com/c/abc' }]);
    mockTabsSendMessage.mockResolvedValue({ success: true, data: null });
    await loadPopup();

    await vi.waitFor(() => {
      expect(uiState()).toBe('noConversation');
    });
    expect(uiState()).not.toBe('unsupported');
    expect(document.getElementById('status-text')?.textContent).toBe('No conversation');
  });

  it('gives the no-conversation state its own block instead of reusing #state-unsupported', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://chatgpt.com/c/abc' }]);
    mockTabsSendMessage.mockResolvedValue({ success: true, data: null });
    await loadPopup();

    await vi.waitFor(() => {
      expect(uiState()).toBe('noConversation');
    });
    expect(document.getElementById('state-no-conversation')).not.toBeNull();
  });

  // A zero-pair parse is a *truthy* conversation (`data: null` never happens
  // here), so the `response?.success && response.data` check alone treats it
  // as ready — the silent-empty-conversation gap (D-19).
  it('treats a parsed conversation with zero pairs as no-conversation, not ready', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://chatgpt.com/c/abc' }]);
    mockTabsSendMessage.mockResolvedValue({ success: true, data: { ...CONVERSATION, pairs: [] } });
    await loadPopup();

    await vi.waitFor(() => {
      expect(uiState()).toBe('noConversation');
    });
    expect(uiState()).not.toBe('ready');
  });
});

/**
 * The condition behind the "Receiving end does not exist" report: the extension
 * was installed, updated or reloaded while a chat tab was already open, so
 * nothing is listening in it. Routine, so it must self-heal and must not shout
 * into the console — while a genuine failure still has to.
 */
describe('popup secondary states — no content script in the tab', () => {
  let consoleError: MockInstance;
  let consoleDebug: MockInstance;

  beforeEach(() => {
    baseChrome();
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  // Restored one by one: `vi.restoreAllMocks()` would also reset the shared
  // chrome.storage mocks from vitest.setup.ts and break every later test.
  afterEach(() => {
    consoleError.mockRestore();
    consoleDebug.mockRestore();
  });

  it('injects the content script and retries instead of asking for a reload', async () => {
    let attempts = 0;
    mockTabsSendMessage.mockImplementation(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error(NO_RECEIVER))
        : Promise.resolve({ success: true, data: CONVERSATION });
    });
    await loadPopup();

    await vi.waitFor(() => {
      expect(uiState()).toBe('ready');
    });
    // Files come off the manifest, not a second hardcoded list.
    expect(mockInsertCSS).toHaveBeenCalledWith({
      target: { tabId: 1, allFrames: false },
      files: ['content/styles.css'],
    });
    expect(mockExecuteScript).toHaveBeenCalledWith({
      target: { tabId: 1, allFrames: false },
      files: ['content/content-script.js'],
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('keeps asking while the injected loader is still pulling in its bundle', async () => {
    // The injected file only kicks off a dynamic import, so the listener can
    // still be missing on the first ask after executeScript resolves.
    let attempts = 0;
    mockTabsSendMessage.mockImplementation(() => {
      attempts += 1;
      return attempts < 3
        ? Promise.reject(new Error(NO_RECEIVER))
        : Promise.resolve({ success: true, data: CONVERSATION });
    });
    await loadPopup();

    await vi.waitFor(() => {
      expect(uiState()).toBe('ready');
    });
    expect(mockExecuteScript).toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('degrades to the reload state without an error when the injection does not take', async () => {
    mockTabsSendMessage.mockRejectedValue(new Error(NO_RECEIVER));
    await loadPopup();

    await vi.waitFor(() => {
      expect(uiState()).toBe('reload');
    });
    expect(mockExecuteScript).toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('degrades to the reload state without an error when the injection itself fails', async () => {
    mockTabsSendMessage.mockRejectedValue(new Error(NO_RECEIVER));
    mockExecuteScript.mockRejectedValue(new Error('Cannot access contents of the page'));
    await loadPopup();

    await vi.waitFor(() => {
      expect(uiState()).toBe('reload');
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('still surfaces a genuine failure as an error rather than a reload prompt', async () => {
    mockTabsSendMessage.mockRejectedValue(new Error('The message port closed unexpectedly'));
    await loadPopup();

    await vi.waitFor(() => {
      expect(uiState()).toBe('error');
    });
    // A real fault is not something a page reload fixes: no injection is tried.
    expect(mockExecuteScript).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    expect(document.getElementById('status-text')?.textContent).toBe('Check failed');
  });
});

describe('popup secondary states — reload needed', () => {
  beforeEach(baseChrome);

  it('falls back to the reload state when the content script never answers', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
    mockTabsSendMessage.mockRejectedValue(new Error(NO_RECEIVER));
    await loadPopup();

    await vi.waitFor(() => {
      expect(uiState()).toBe('reload');
    });
    expect(document.getElementById('state-reload')).not.toBeNull();
  });

  it('reloads the tab from the button rather than only telling the user how', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
    mockTabsSendMessage.mockRejectedValue(new Error(NO_RECEIVER));
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
    await loadPopup();

    await vi.waitFor(() => {
      expect(uiState()).toBe('reload');
    });
    document.getElementById('reload-button')?.click();

    expect(mockTabsReload).toHaveBeenCalled();
  });

  it('keeps the Ctrl/R shortcut hint alongside the button', () => {
    const html = readFileSync(
      resolve(__dirname, '../../../../src/extension/popup/popup.html'),
      'utf-8'
    );
    const block =
      /<div class="state-block[^"]*" id="state-reload"[\s\S]*?<\/div>\s*<div id="main-content">/.exec(
        html
      )?.[0];
    expect(block).toContain('<kbd>Ctrl</kbd>');
    expect(block).toContain('<kbd>R</kbd>');
  });
});

describe('popup secondary states — nothing selected', () => {
  beforeEach(baseChrome);

  async function loadReady(): Promise<void> {
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
    mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) =>
      message.type === 'get_conversation'
        ? Promise.resolve({ success: true, data: CONVERSATION })
        : Promise.resolve({ success: true })
    );
    await loadPopup();
    await vi.waitFor(() => {
      expect(uiState()).toBe('ready');
    });
  }

  it('disables export exactly when nothing is selected, and re-enables on reselect', async () => {
    await loadReady();
    const exportButton = document.getElementById('export-button') as HTMLButtonElement;
    expect(exportButton.disabled).toBe(false);

    const toggleAll = document.getElementById('qa-selection-toggle-all') as HTMLButtonElement;
    toggleAll.click();

    await vi.waitFor(() => {
      expect(uiState()).toBe('noSelection');
    });
    expect(exportButton.disabled).toBe(true);

    toggleAll.click();
    await vi.waitFor(() => {
      expect(uiState()).toBe('ready');
    });
    expect(exportButton.disabled).toBe(false);
  });

  it('turns the Content row into the warning with a Choose pairs action', async () => {
    await loadReady();
    const row = document.querySelector<HTMLElement>('.setting-row[data-nav="content"]');
    expect(row?.querySelector('.setting-row-label')?.textContent).toBe('Content');
    expect(row?.querySelector('.setting-row-value')?.textContent).toBe('Whole conversation');

    (document.getElementById('qa-selection-toggle-all') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(row?.querySelector('.setting-row-label')?.textContent).toBe('No pairs selected');
    });
    expect(row?.querySelector('.setting-row-value')?.textContent).toBe('Choose pairs');
  });
});

describe('popup secondary states — exported with warnings (persistent cause, D-26)', () => {
  beforeEach(() => {
    baseChrome();
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
    mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) =>
      message.type === 'get_conversation'
        ? Promise.resolve({ success: true, data: CONVERSATION })
        : Promise.resolve({ success: true, warning: WARNING_KEYS.IDS_MISSING })
    );
  });

  afterEach(() => {
    localStorage.removeItem('lastExportFormat');
  });

  it('resolves the warning key through getMessage(), shows it in full, and hides the dead Retry', async () => {
    await loadPopup();
    await vi.waitFor(() => {
      expect(uiState()).toBe('ready');
    });
    expect(document.getElementById('export-button-label')?.textContent).toBe('Export Markdown');

    document.getElementById('export-button')?.click();

    await vi.waitFor(() => {
      expect(uiState()).toBe('warning');
    });
    const detail = document.getElementById('warning-card-detail');
    // Never the raw key, never English-only prose — resolved via getMessage().
    expect(detail?.textContent).toBe(EN_MESSAGES.warningArtifactsIdsMissing);
    expect(document.getElementById('export-button-label')?.textContent).toBe('Export again');
    // The cause is persistent (missing page ids) — retrying re-runs the exact
    // same export and fails identically, so no button is offered at all.
    expect((document.getElementById('warning-retry-button') as HTMLButtonElement).hidden).toBe(
      true
    );
  });

  it('does not clamp the warning detail text to two lines', () => {
    // Regression for the tooltip-only-readable clamp: the card's detail line
    // must render in full; the fixed-height body's `.view-scroll` scrolls if
    // a long reason ever runs past it.
    expect(POPUP_CSS).not.toMatch(/\.warning-card-detail\s*\{[^}]*-webkit-line-clamp/);
  });
});

describe('popup secondary states — exported with warnings (transient cause, D-26)', () => {
  beforeEach(() => {
    baseChrome();
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
    mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) =>
      message.type === 'get_conversation'
        ? Promise.resolve({ success: true, data: CONVERSATION })
        : Promise.resolve({ success: true, warning: WARNING_KEYS.FETCH_FAILED })
    );
  });

  afterEach(() => {
    localStorage.removeItem('lastExportFormat');
  });

  it('shows Retry and retries the export from the card without closing the popup', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    await loadPopup();
    await vi.waitFor(() => {
      expect(uiState()).toBe('ready');
    });
    document.getElementById('export-button')?.click();
    await vi.waitFor(() => {
      expect(uiState()).toBe('warning');
    });
    // The API call could just as easily succeed on a second try, so Retry
    // is offered for this reason.
    expect((document.getElementById('warning-retry-button') as HTMLButtonElement).hidden).toBe(
      false
    );

    mockTabsSendMessage.mockClear();
    document.getElementById('warning-retry-button')?.click();

    await vi.waitFor(() => {
      expect(
        mockTabsSendMessage.mock.calls.some(
          ([, message]) => (message as { type: string }).type === 'export_conversation'
        )
      ).toBe(true);
    });
    // A degraded export keeps the popup open so the card is actually read.
    expect(close).not.toHaveBeenCalled();
    expect(uiState()).toBe('warning');
  });
});
