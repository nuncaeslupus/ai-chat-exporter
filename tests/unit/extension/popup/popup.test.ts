/**
 * Popup - degraded-export reporting tests
 *
 * Regression coverage for lo-872a: when Claude artifact enrichment is skipped
 * (DOM/API shape mismatch), the popup must show the user a warning instead of
 * closing as if the export were complete.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createTestQAPair } from '../../../utils/exporter-helpers';

const mockTabsQuery = vi.fn();
const mockTabsSendMessage = vi.fn();

/**
 * Real English translations for the keys these tests exercise, mirroring
 * _locales/en/messages.json. Mocking chrome.i18n (rather than leaving it
 * undefined) lets these tests prove strings actually route through
 * getMessage() instead of relying on its test-environment fallback (which
 * returns the bare key and would mask a hardcoded literal just as easily).
 */
const EN_MESSAGES: Record<string, string> = {
  statusReady: 'Ready',
  statusNotSupported: 'Not supported',
  statusNoConversation: 'No conversation',
  statusReloadNeeded: 'Reload needed',
  statusNoActiveTab: 'No active tab',
  statusArtifactsMissing: 'Artifacts missing',
  statusExportFailed: 'Export failed',
  statusPrintFailed: 'Print failed',
  errorNoActiveTabFound: 'No active tab found',
  conversationUntitled: 'Untitled',
  qaSelectionSelectAll: 'Select all',
  qaSelectionDeselectAll: 'Deselect all',
};

function mockI18n(messages: Record<string, string> = EN_MESSAGES) {
  return {
    getUILanguage: () => 'en',
    getMessage: (key: string, substitutions?: string | string[]) => {
      const message = messages[key] ?? key;
      if (!substitutions) return message;
      const values = Array.isArray(substitutions) ? substitutions : [substitutions];
      return values.reduce(
        (text, value, i) => text.replace(`$${String(i + 1)}`, value),
        message
      );
    },
  };
}

/** The subset of popup.html that popup.ts touches. */
const POPUP_DOM = `
  <div class="status-indicator" id="status-indicator">
    <span class="status-dot"></span>
    <span class="status-text" id="status-text">Detecting...</span>
  </div>
  <section id="not-supported-section" style="display: none;">
    <span id="supported-platforms-list"></span>
  </section>
  <div id="main-content">
    <img id="platform-icon" />
    <div id="conversation-title">-</div>
    <div id="conversation-meta">-</div>
    <section id="qa-selection-section" style="display: none;">
      <button type="button" id="qa-selection-toggle-all"></button>
      <ul id="qa-selection-list"></ul>
      <div id="qa-selection-count"></div>
    </section>
    <img id="format-icon" />
    <select id="format-select" disabled><option value="md">Markdown</option></select>
    <button id="export-button" disabled></button>
    <button id="print-button" disabled></button>
    <input type="checkbox" id="option-include-metadata" />
    <input type="checkbox" id="option-include-timestamps" />
  </div>
`;

/**
 * Swap the stateless chrome.storage.sync stub (vitest.setup.ts always
 * resolves get() to {}) for a real in-memory store, so preferences set via
 * one call are visible to a later get() within the same test — the same
 * round-trip a real browser restart relies on.
 */
function mockStatefulSyncStorage() {
  const store: Record<string, unknown> = {};
  Object.assign(chrome.storage.sync, {
    get: (key: string) => Promise.resolve({ [key]: store[key] }),
    set: (items: Record<string, unknown>) => {
      Object.assign(store, items);
      return Promise.resolve();
    },
  });
}

const CONVERSATION = {
  id: 'conv-1',
  title: 'Test conversation',
  platform: 'claude',
  pairs: [],
  url: 'https://claude.ai/chat/abc',
};

/** Boot the popup and wait until it reports the page is ready. */
async function loadPopup() {
  document.body.innerHTML = POPUP_DOM;
  vi.resetModules();
  await import('../../../../src/extension/popup/popup');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => {
    expect(document.getElementById('status-indicator')?.className).toContain('active');
  });
}

/** Respond per message type so repeated calls stay consistent. */
function respondWith(exportResponse: Record<string, unknown>) {
  mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) => {
    if (message.type === 'get_conversation') {
      return Promise.resolve({ success: true, data: CONVERSATION });
    }
    return Promise.resolve(exportResponse);
  });
}

describe('popup degraded-export reporting', () => {
  beforeEach(() => {
    mockTabsQuery.mockReset();
    mockTabsSendMessage.mockReset();
    Object.assign(chrome, {
      tabs: { query: mockTabsQuery, sendMessage: mockTabsSendMessage, create: vi.fn() },
      i18n: mockI18n(),
    });
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
  });

  it('shows a warning in the popup when the export comes back degraded', async () => {
    respondWith({
      success: true,
      warning: 'Artifact contents were left out of this export.',
    });

    await loadPopup();
    document.getElementById('export-button')?.click();

    const statusText = document.getElementById('status-text');
    await vi.waitFor(() => {
      expect(statusText?.textContent).toBe('Artifacts missing');
    });
    expect(document.getElementById('status-indicator')?.className).toContain('warning');
    // The full reason stays readable in the tooltip — the badge itself is a
    // narrow no-wrap label.
    expect(document.getElementById('status-indicator')?.getAttribute('title')).toContain(
      'Artifact contents were left out'
    );
  });

  it('closes without warning when the export is complete', async () => {
    respondWith({ success: true });
    // jsdom really tears the window down on close(); stub it so the assertion
    // below can still read the DOM.
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    await loadPopup();
    document.getElementById('export-button')?.click();

    await vi.waitFor(() => {
      expect(close).toHaveBeenCalled();
    });
    expect(document.getElementById('status-text')?.textContent).not.toBe('Artifacts missing');
  });

  it('routes the print-failure status text through getMessage() rather than a hardcoded literal', async () => {
    // Distinct from the real EN string on purpose: if popup.ts still hardcodes
    // 'Print failed' instead of calling getMessage('statusPrintFailed'), this
    // mocked translation would never surface and the assertion below fails.
    const translatedMarker = '__I18N_STATUS_PRINT_FAILED__';
    Object.assign(chrome, { i18n: mockI18n({ ...EN_MESSAGES, statusPrintFailed: translatedMarker }) });
    mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) => {
      if (message.type === 'get_conversation') {
        return Promise.resolve({ success: true, data: CONVERSATION });
      }
      if (message.type === 'print_conversation') {
        return Promise.reject(new Error('print backend unavailable'));
      }
      return Promise.resolve({ success: true });
    });

    await loadPopup();
    document.getElementById('print-button')?.click();

    await vi.waitFor(() => {
      expect(document.getElementById('status-text')?.textContent).toBe(translatedMarker);
    });
  });
});

describe('popup export options', () => {
  beforeEach(() => {
    mockTabsQuery.mockReset();
    mockTabsSendMessage.mockReset();
    mockStatefulSyncStorage();
    Object.assign(chrome, {
      tabs: { query: mockTabsQuery, sendMessage: mockTabsSendMessage, create: vi.fn() },
      i18n: mockI18n(),
    });
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
    respondWith({ success: true });
  });

  it('reflects the persisted metadata/timestamp preferences in the toggles on load', async () => {
    await chrome.storage.sync.set({
      user_preferences: { includeMetadata: false, includeTimestamps: false },
    });

    await loadPopup();

    expect((document.getElementById('option-include-metadata') as HTMLInputElement).checked).toBe(
      false
    );
    expect(
      (document.getElementById('option-include-timestamps') as HTMLInputElement).checked
    ).toBe(false);
  });

  it('persists a metadata toggle change to storage', async () => {
    await loadPopup();

    const toggle = document.getElementById('option-include-metadata') as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));

    await vi.waitFor(async () => {
      const stored = await chrome.storage.sync.get('user_preferences');
      expect((stored.user_preferences as { includeMetadata: boolean }).includeMetadata).toBe(
        false
      );
    });
  });

  it('persists a timestamps toggle change to storage', async () => {
    await loadPopup();

    const toggle = document.getElementById('option-include-timestamps') as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));

    await vi.waitFor(async () => {
      const stored = await chrome.storage.sync.get('user_preferences');
      expect(
        (stored.user_preferences as { includeTimestamps: boolean }).includeTimestamps
      ).toBe(false);
    });
  });
});

describe('popup export options accessibility', () => {
  it('associates the metadata and timestamps toggles with real labels', () => {
    const html = readFileSync(
      resolve(__dirname, '../../../../src/extension/popup/popup.html'),
      'utf-8'
    );
    for (const id of ['option-include-metadata', 'option-include-timestamps']) {
      const labelTag = new RegExp(`<label[^>]*for="${id}"[^>]*>`).exec(html)?.[0];
      expect(labelTag).toBeDefined();
      const inputTag = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0];
      expect(inputTag).toBeDefined();
    }
  });
});

describe('popup status region accessibility', () => {
  it('marks the status indicator as an ARIA live region so screen readers hear state changes', () => {
    const html = readFileSync(
      resolve(__dirname, '../../../../src/extension/popup/popup.html'),
      'utf-8'
    );
    const statusIndicatorTag = /<div[^>]*id="status-indicator"[^>]*>/.exec(html)?.[0];
    expect(statusIndicatorTag).toBeDefined();
    // role="status" is the ARIA idiom for a non-critical, polite live region
    // (implies aria-live="polite" + aria-atomic="true") — appropriate here
    // since the badge is the extension's only feedback channel and every
    // state change (including errors) must reach assistive tech, but a
    // popup the user is actively driving doesn't need an interrupting
    // role="alert" for routine Ready/Exporting transitions.
    expect(statusIndicatorTag).toMatch(/role="status"/);
  });
});

describe('popup platform gate', () => {
  beforeEach(() => {
    mockTabsQuery.mockReset();
    mockTabsSendMessage.mockReset();
    Object.assign(chrome, {
      tabs: { query: mockTabsQuery, sendMessage: mockTabsSendMessage, create: vi.fn() },
      runtime: { getManifest: () => ({ version: '9.9.9' }) },
      i18n: mockI18n(),
    });
  });

  it('treats every registered platform as supported, including gemini', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://gemini.google.com/app/abc' }]);
    mockTabsSendMessage.mockResolvedValue({
      success: true,
      data: { ...CONVERSATION, platform: 'gemini', url: 'https://gemini.google.com/app/abc' },
    });
    await loadPopup();
    expect(document.getElementById('main-content')?.style.display).not.toBe('none');
  });

  it('renders the version from the manifest rather than a hardcoded string', async () => {
    document.body.innerHTML = POPUP_DOM + '<span id="popup-version" data-version></span>';
    vi.resetModules();
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
    mockTabsSendMessage.mockResolvedValue({ success: true, data: CONVERSATION });
    await import('../../../../src/extension/popup/popup');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await vi.waitFor(() => {
      expect(document.getElementById('popup-version')?.textContent).toBe('v9.9.9');
    });
  });
});

describe('popup Q&A pair selection (lo-adf1)', () => {
  const CONVERSATION_WITH_PAIRS = {
    ...CONVERSATION,
    pairs: [
      createTestQAPair(0, 'First question', 'First answer'),
      createTestQAPair(1, 'Second question', 'Second answer'),
      createTestQAPair(2, 'Third question', 'Third answer'),
    ],
  };

  function checkboxes(): HTMLInputElement[] {
    return Array.from(
      document.querySelectorAll<HTMLInputElement>('#qa-selection-list input[type="checkbox"]')
    );
  }

  beforeEach(() => {
    mockTabsQuery.mockReset();
    mockTabsSendMessage.mockReset();
    Object.assign(chrome, {
      tabs: { query: mockTabsQuery, sendMessage: mockTabsSendMessage, create: vi.fn() },
      i18n: mockI18n(),
    });
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
    mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) => {
      if (message.type === 'get_conversation') {
        return Promise.resolve({ success: true, data: CONVERSATION_WITH_PAIRS });
      }
      return Promise.resolve({ success: true });
    });
  });

  it('renders one checkbox per pair, all selected by default', async () => {
    await loadPopup();
    await vi.waitFor(() => {
      expect(checkboxes()).toHaveLength(3);
    });
    expect(checkboxes().every((cb) => cb.checked)).toBe(true);
  });

  it('select-all / select-none toggle every pair', async () => {
    await loadPopup();
    await vi.waitFor(() => {
      expect(checkboxes()).toHaveLength(3);
    });

    const toggleAll = document.getElementById('qa-selection-toggle-all') as HTMLButtonElement;
    expect(toggleAll.textContent).toBe('Deselect all');

    toggleAll.click();
    await vi.waitFor(() => {
      expect(checkboxes().every((cb) => !cb.checked)).toBe(true);
    });
    expect(toggleAll.textContent).toBe('Select all');

    toggleAll.click();
    await vi.waitFor(() => {
      expect(checkboxes().every((cb) => cb.checked)).toBe(true);
    });
    expect(toggleAll.textContent).toBe('Deselect all');
  });

  it('sends only the indices of the pairs still checked when exporting', async () => {
    await loadPopup();
    await vi.waitFor(() => {
      expect(checkboxes()).toHaveLength(3);
    });

    // Uncheck the middle pair by hand.
    checkboxes()[1]!.checked = false;
    checkboxes()[1]!.dispatchEvent(new Event('change'));

    document.getElementById('export-button')?.click();

    await vi.waitFor(() => {
      const calls = mockTabsSendMessage.mock.calls as [number, { type: string; selectedIndices?: number[] }][];
      const exportCalls = calls.filter(([, message]) => message.type === 'export_conversation');
      expect(exportCalls.length).toBeGreaterThan(0);
      expect(exportCalls.at(-1)?.[1].selectedIndices).toEqual([0, 2]);
    });
  });

  it('toggling a single checkbox off then on again leaves every pair selected', async () => {
    await loadPopup();
    await vi.waitFor(() => {
      expect(checkboxes()).toHaveLength(3);
    });

    checkboxes()[0]!.checked = false;
    checkboxes()[0]!.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(checkboxes()[0]!.checked).toBe(false);
    });

    checkboxes()[0]!.checked = true;
    checkboxes()[0]!.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(checkboxes().every((cb) => cb.checked)).toBe(true);
    });
  });
});

describe('popup Q&A pair selection accessibility (lo-adf1)', () => {
  const CONVERSATION_WITH_PAIRS = {
    ...CONVERSATION,
    pairs: [createTestQAPair(0, 'A real question', 'An answer')],
  };

  beforeEach(() => {
    mockTabsQuery.mockReset();
    mockTabsSendMessage.mockReset();
    Object.assign(chrome, {
      tabs: { query: mockTabsQuery, sendMessage: mockTabsSendMessage, create: vi.fn() },
      i18n: mockI18n(),
    });
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
    mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) => {
      if (message.type === 'get_conversation') {
        return Promise.resolve({ success: true, data: CONVERSATION_WITH_PAIRS });
      }
      return Promise.resolve({ success: true });
    });
  });

  it('associates every pair checkbox with a real <label for>', async () => {
    await loadPopup();
    const checkbox = await vi.waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('#qa-selection-list input[type="checkbox"]');
      expect(el).not.toBeNull();
      return el!;
    });

    expect(checkbox.id).not.toBe('');
    const label = document.querySelector(`label[for="${checkbox.id}"]`);
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe('A real question');
  });

  it('gives the select-all/select-none toggle a non-empty accessible name', async () => {
    await loadPopup();
    const toggleAll = await vi.waitFor(() => {
      const el = document.getElementById('qa-selection-toggle-all');
      expect(el?.textContent).toBeTruthy();
      return el!;
    });
    expect(toggleAll.textContent).toBe('Deselect all');
  });
});
