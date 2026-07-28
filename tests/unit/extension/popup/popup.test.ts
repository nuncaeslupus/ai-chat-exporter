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
};

function mockI18n(messages: Record<string, string> = EN_MESSAGES) {
  return { getUILanguage: () => 'en', getMessage: (key: string) => messages[key] ?? key };
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
    <img id="format-icon" />
    <select id="format-select" disabled><option value="md">Markdown</option></select>
    <button id="export-button" disabled></button>
    <button id="print-button" disabled></button>
  </div>
  <a id="report-issue"></a>
`;

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
    document.body.innerHTML = POPUP_DOM + '<span id="popup-version"></span>';
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
