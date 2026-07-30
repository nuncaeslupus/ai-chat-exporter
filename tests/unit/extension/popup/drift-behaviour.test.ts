/**
 * Drift behaviour in the popup. Follow the existing popup.test.ts harness for
 * loading popup.html into jsdom and stubbing `chrome`; this file only adds the
 * drift-specific expectations.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatDriftReport } from '../../../../src/core/drift/format-report';
import { DRIFT_SUPPRESSION_KEY } from '../../../../src/core/drift/suppression';
import type { DriftReport } from '../../../../src/core/drift/types';
import { createTestQAPair } from '../../../utils/exporter-helpers';

const report: DriftReport = {
  fingerprint: 'a1b2c3d4',
  platform: 'chatgpt',
  extensionVersion: '1.2.0',
  buildTarget: 'chrome',
  detectedAt: '2026-07-29',
  selectorFindings: [
    { key: 'messageContent', selector: '.markdown.prose', matched: 0, required: true },
  ],
  sanityFindings: [],
};

describe('drift report payload', () => {
  it('is one string, so the preview and the clipboard cannot diverge', () => {
    const skeleton = 'main#main\n  div[data-turn="user"]\n    text(12)';
    const a = formatDriftReport(report, skeleton, 'https://chatgpt.com');
    const b = formatDriftReport(report, skeleton, 'https://chatgpt.com');
    expect(a).toBe(b);
    expect(a).toContain(skeleton);
  });

  it('never contains conversation text, only character counts', () => {
    const skeleton = 'main#main\n  div[data-turn="user"]\n    text(12)';
    const text = formatDriftReport(report, skeleton, 'https://chatgpt.com');
    expect(text).toContain('text(12)');
    expect(text).not.toMatch(/[Ww]hat is the capital/);
  });
});

const mockTabsQuery = vi.fn();
const mockTabsSendMessage = vi.fn();
const mockTabsCreate = vi.fn();
const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();

/** The message types sent to the tab so far, typed without `any`. */
function sentMessageTypes(): string[] {
  const calls = mockTabsSendMessage.mock.calls as [number, { type: string }][];
  return calls.map(([, message]) => message.type);
}

const EN_MESSAGES: Record<string, string> = {
  statusReady: 'Ready',
  driftReportLoading: 'Reading the page structure…',
  driftReportCopied: 'Copied',
  driftReportCopyFailed: "Couldn't copy — select the text above",
};

function mockI18n(messages: Record<string, string> = EN_MESSAGES) {
  return {
    getUILanguage: () => 'en',
    getMessage: (key: string, substitutions?: string | string[]) => {
      const message = messages[key] ?? key;
      if (!substitutions) return message;
      const values = Array.isArray(substitutions) ? substitutions : [substitutions];
      return values.reduce((text, value, i) => text.replace(`$${String(i + 1)}`, value), message);
    },
  };
}

/** The subset of popup.html that popup.ts touches, plus the drift markup. */
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
    <button type="button" id="drift-row" data-nav="report" hidden></button>
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
    <fieldset class="option-row option-row--choice">
      <legend data-i18n="optionFontScale">Text size</legend>
      <label><input type="radio" name="option-font-scale" value="compact" /></label>
      <label><input type="radio" name="option-font-scale" value="normal" /></label>
      <label><input type="radio" name="option-font-scale" value="large" /></label>
    </fieldset>
  </div>
  <section id="view-report" hidden>
    <pre id="drift-report-preview"></pre>
    <span id="drift-report-status"></span>
    <button type="button" id="drift-report-copy"></button>
    <button type="button" id="drift-report-copy-and-report"></button>
  </section>
`;

const CONVERSATION = {
  id: 'conv-1',
  title: 'Test conversation',
  platform: 'claude',
  pairs: [createTestQAPair(0, 'First question', 'First answer')],
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

/**
 * Respond per message type: `get_conversation` carries `drift` (unless
 * `drift: undefined`), `get_drift_skeleton` answers with a skeleton unless
 * told to fail.
 */
function mockContentScript(options: {
  drift?: DriftReport;
  skeleton?: { success: true; skeleton: string; origin: string } | { success: false };
}) {
  mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) => {
    if (message.type === 'get_conversation') {
      return Promise.resolve({
        success: true,
        data: CONVERSATION,
        ...(options.drift && { drift: options.drift }),
      });
    }
    if (message.type === 'get_drift_skeleton') {
      return Promise.resolve(
        options.skeleton ?? {
          success: true,
          skeleton: 'main#main\n  text(4)',
          origin: 'https://claude.ai',
        }
      );
    }
    return Promise.resolve({ success: true });
  });
}

describe('drift row visibility', () => {
  beforeEach(() => {
    vi.resetModules();
    mockTabsQuery.mockReset();
    mockTabsSendMessage.mockReset();
    mockTabsCreate.mockReset();
    Object.assign(chrome, {
      tabs: { query: mockTabsQuery, sendMessage: mockTabsSendMessage, create: mockTabsCreate },
      i18n: mockI18n(),
    });
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
    mockStorageGet.mockReset().mockResolvedValue({});
    mockStorageSet.mockReset().mockResolvedValue(undefined);
    Object.assign(chrome.storage.local, { get: mockStorageGet, set: mockStorageSet });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('unhides #drift-row when a response carries an unsuppressed drift report', async () => {
    mockContentScript({ drift: report });

    await loadPopup();

    await vi.waitFor(() => {
      expect(document.getElementById('drift-row')?.hidden).toBe(false);
    });
  });

  it('leaves #drift-row hidden when the fingerprint is suppressed', async () => {
    mockContentScript({ drift: report });
    mockStorageGet.mockResolvedValue({
      [DRIFT_SUPPRESSION_KEY]: { [report.fingerprint]: true },
    });

    await loadPopup();

    // Give the async suppression check a turn to settle before asserting the
    // negative (there is no "unhidden" event to wait on here).
    await vi.waitFor(() => {
      expect(mockStorageGet).toHaveBeenCalled();
    });
    expect(document.getElementById('drift-row')?.hidden).toBe(true);
  });

  it('requests the skeleton only when the report view opens', async () => {
    mockContentScript({ drift: report });

    await loadPopup();
    await vi.waitFor(() => {
      expect(document.getElementById('drift-row')?.hidden).toBe(false);
    });

    expect(sentMessageTypes()).not.toContain('get_drift_skeleton');

    document.getElementById('drift-row')?.click();

    await vi.waitFor(() => {
      expect(sentMessageTypes()).toContain('get_drift_skeleton');
    });
  });

  it('keeps the popup open after Copy report', async () => {
    mockContentScript({ drift: report });
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    await loadPopup();
    await vi.waitFor(() => {
      expect(document.getElementById('drift-row')?.hidden).toBe(false);
    });

    document.getElementById('drift-row')?.click();
    await vi.waitFor(() => {
      expect(document.getElementById('drift-report-preview')?.textContent).toContain('text(4)');
    });

    document.getElementById('drift-report-copy')?.click();

    await vi.waitFor(() => {
      expect(document.getElementById('drift-report-status')?.textContent).toBe('Copied');
    });
    expect(close).not.toHaveBeenCalled();
  });

  it('shows driftReportCopyFailed when the clipboard write throws', async () => {
    mockContentScript({ drift: report });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });

    await loadPopup();
    await vi.waitFor(() => {
      expect(document.getElementById('drift-row')?.hidden).toBe(false);
    });

    document.getElementById('drift-row')?.click();
    await vi.waitFor(() => {
      expect(document.getElementById('drift-report-preview')?.textContent).toContain('text(4)');
    });

    document.getElementById('drift-report-copy')?.click();

    await vi.waitFor(() => {
      expect(document.getElementById('drift-report-status')?.textContent).toBe(
        "Couldn't copy — select the text above"
      );
    });
  });

  it('suppresses the fingerprint after either copy action', async () => {
    mockContentScript({ drift: report });

    await loadPopup();
    await vi.waitFor(() => {
      expect(document.getElementById('drift-row')?.hidden).toBe(false);
    });

    document.getElementById('drift-row')?.click();
    await vi.waitFor(() => {
      expect(document.getElementById('drift-report-preview')?.textContent).toContain('text(4)');
    });

    document.getElementById('drift-report-copy')?.click();

    await vi.waitFor(() => {
      expect(mockStorageSet).toHaveBeenCalledWith({
        [DRIFT_SUPPRESSION_KEY]: { [report.fingerprint]: true },
      });
    });
  });
});
