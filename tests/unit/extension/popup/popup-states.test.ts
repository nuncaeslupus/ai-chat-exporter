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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createTestQAPair } from '../../../utils/exporter-helpers';

const mockTabsQuery = vi.fn();
const mockTabsSendMessage = vi.fn();
const mockTabsCreate = vi.fn();
const mockTabsReload = vi.fn();
const mockExecuteScript = vi.fn();
const mockInsertCSS = vi.fn();

/** What the shipped manifest declares; the injection helper reads it from there. */
const MANIFEST = {
  version: '1.1.1',
  content_scripts: [{ js: ['content/content-script.js'], css: ['content/styles.css'] }],
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
  mockTabsSendMessage.mockReset();
  mockTabsCreate.mockReset();
  mockTabsReload.mockReset();
  mockExecuteScript.mockReset().mockResolvedValue([]);
  mockInsertCSS.mockReset().mockResolvedValue(undefined);
  Object.assign(chrome, {
    tabs: {
      query: mockTabsQuery,
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
 * The condition behind the "Receiving end does not exist" report: the extension
 * was installed, updated or reloaded while a chat tab was already open, so
 * nothing is listening in it. Routine, so it must self-heal and must not shout
 * into the console — while a genuine failure still has to.
 */
describe('popup secondary states — no content script in the tab', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  let consoleDebug: ReturnType<typeof vi.spyOn>;

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
      target: { tabId: 1 },
      files: ['content/styles.css'],
    });
    expect(mockExecuteScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
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

describe('popup secondary states — exported with warnings', () => {
  beforeEach(() => {
    baseChrome();
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
    mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) =>
      message.type === 'get_conversation'
        ? Promise.resolve({ success: true, data: CONVERSATION })
        : Promise.resolve({ success: true, warning: 'Two Claude artifacts were left out.' })
    );
  });

  afterEach(() => {
    localStorage.removeItem('lastExportFormat');
  });

  it('shows the warning card with the reason and relabels the main button', async () => {
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
    expect(detail?.textContent).toBe('Two Claude artifacts were left out.');
    expect(detail?.getAttribute('title')).toBe('Two Claude artifacts were left out.');
    expect(document.getElementById('export-button-label')?.textContent).toBe('Export again');
  });

  it('retries the export from the card without closing the popup', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    await loadPopup();
    await vi.waitFor(() => {
      expect(uiState()).toBe('ready');
    });
    document.getElementById('export-button')?.click();
    await vi.waitFor(() => {
      expect(uiState()).toBe('warning');
    });

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
