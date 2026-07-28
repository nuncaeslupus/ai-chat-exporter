/**
 * Popup - degraded-export reporting tests
 *
 * Regression coverage for lo-872a: when Claude artifact enrichment is skipped
 * (DOM/API shape mismatch), the popup must show the user a warning instead of
 * closing as if the export were complete.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTabsQuery = vi.fn();
const mockTabsSendMessage = vi.fn();

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
});
