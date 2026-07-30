/**
 * Popup — main "ready" view (lo-a748 / R2)
 *
 * Covers the pieces the redesign's ready state owns: the conversation meta
 * line, the split export button's label, and the print button's format gate.
 * The DOM is the real popup.html rather than a hand-written fixture, so a
 * markup change that drops an element these tests drive fails here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { QAPair } from '../../../../src/core/types/conversation';
import type { ExportFormat } from '../../../../src/core/types/exporter';

const mockTabsQuery = vi.fn();
const mockTabsSendMessage = vi.fn();

/** Real English strings for the keys this view renders. */
const EN_MESSAGES: Record<string, string> = {
  statusReady: 'Ready',
  conversationUntitled: 'Untitled',
  platformGemini: 'Gemini',
  platformClaude: 'Claude',
  metaPairsSingular: '$1 pair',
  metaPairsPlural: '$1 pairs',
  rowContentAll: 'Whole conversation',
  rowContentPartial: '$1 of $2 pairs',
  exportButtonFormat: 'Export $1',
  printButtonFormat: 'Print $1',
  printUnavailableFormat: 'Printing is not available for $1',
  formatNameMD: 'Markdown',
  formatNamePDF: 'PDF',
  formatNameHTML: 'HTML',
  formatNameDOCX: 'Word',
  formatNameTXT: 'Plain text',
  formatNameJSON: 'JSON',
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

/** The real popup markup, minus the module script jsdom would not run anyway. */
const POPUP_HTML = readFileSync(
  resolve(__dirname, '../../../../src/extension/popup/popup.html'),
  'utf-8'
)
  .replace(/[\s\S]*<body>/, '')
  .replace(/<\/body>[\s\S]*/, '')
  .replace(/<script[\s\S]*?<\/script>/g, '');

/** A pair with, or deliberately without, message timestamps. */
function pairAt(index: number, date?: string): QAPair {
  const stamp = date === undefined ? {} : { timestamp: new Date(date) };
  return {
    id: `pair-${String(index)}`,
    index,
    question: {
      id: `q-${String(index)}`,
      role: 'user',
      content: `Question ${String(index)}`,
      ...stamp,
    },
    answer: {
      id: `a-${String(index)}`,
      role: 'assistant',
      content: `Answer ${String(index)}`,
      ...stamp,
    },
    selected: true,
  };
}

function conversationWith(pairs: QAPair[]) {
  return {
    id: 'conv-1',
    title: 'Gemini Conversation',
    platform: 'gemini',
    pairs,
    url: 'https://gemini.google.com/app/abc',
  };
}

async function loadPopup(conversation: unknown) {
  document.body.innerHTML = POPUP_HTML;
  mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) =>
    message.type === 'get_conversation'
      ? Promise.resolve({ success: true, data: conversation })
      : Promise.resolve({ success: true })
  );
  vi.resetModules();
  await import('../../../../src/extension/popup/popup');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => {
    expect(document.getElementById('status-indicator')?.className).toContain('active');
  });
}

describe('popup ready view — conversation meta line', () => {
  beforeEach(() => {
    mockTabsQuery.mockReset();
    mockTabsSendMessage.mockReset();
    Object.assign(chrome, {
      tabs: { query: mockTabsQuery, sendMessage: mockTabsSendMessage, create: vi.fn() },
      runtime: { getManifest: () => ({ version: '1.1.1' }) },
      i18n: mockI18n(),
    });
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://gemini.google.com/app/abc' }]);
  });

  it("composes platform, pair count and the conversation's own date range", async () => {
    await loadPopup(
      conversationWith([
        pairAt(0, '2026-07-26T10:00:00Z'),
        pairAt(1, '2026-07-28T10:00:00Z'),
        pairAt(2, '2026-07-29T10:00:00Z'),
      ])
    );

    const meta = document.getElementById('conversation-meta')?.textContent ?? '';
    const [platform, pairs, range] = meta.split(' · ');
    expect(platform).toBe('Gemini');
    expect(pairs).toBe('3 pairs');
    // Rendered by Intl, so assert the endpoints rather than the exact glyphs.
    expect(range).toBeDefined();
    expect(range).toMatch(/26/);
    expect(range).toMatch(/29/);
  });

  it('omits the date range entirely when the messages carry no timestamps', async () => {
    await loadPopup(conversationWith([pairAt(0), pairAt(1)]));

    expect(document.getElementById('conversation-meta')?.textContent).toBe('Gemini · 2 pairs');
  });

  it('uses the singular pair label for a one-pair conversation', async () => {
    await loadPopup(conversationWith([pairAt(0)]));

    expect(document.getElementById('conversation-meta')?.textContent).toBe('Gemini · 1 pair');
  });

  it('points Gemini at the spark mark, not the illegible wordmark', async () => {
    await loadPopup(conversationWith([pairAt(0)]));

    const icon = document.getElementById('platform-icon') as HTMLImageElement;
    expect(icon.getAttribute('src')).toContain('gemini-spark.svg');
  });

  it('summarises the Content row from the current selection', async () => {
    await loadPopup(conversationWith([pairAt(0), pairAt(1), pairAt(2)]));

    const value = document.getElementById('content-row-value');
    expect(value?.textContent).toBe('Whole conversation');

    const checkbox = document.querySelector<HTMLInputElement>(
      '#qa-selection-list input[type="checkbox"]'
    );
    checkbox!.checked = false;
    checkbox!.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(value?.textContent).toBe('2 of 3 pairs');
    });
  });
});

describe('popup ready view — split action bar', () => {
  const ALL_FORMATS: ExportFormat[] = ['md', 'pdf', 'html', 'docx', 'txt', 'json'];
  const FORMAT_NAMES: Record<string, string> = {
    md: 'Markdown',
    pdf: 'PDF',
    html: 'HTML',
    docx: 'Word',
    txt: 'Plain text',
    json: 'JSON',
  };

  beforeEach(() => {
    mockTabsQuery.mockReset();
    mockTabsSendMessage.mockReset();
    Object.assign(chrome, {
      tabs: { query: mockTabsQuery, sendMessage: mockTabsSendMessage, create: vi.fn() },
      runtime: { getManifest: () => ({ version: '1.1.1' }) },
      i18n: mockI18n(),
    });
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://gemini.google.com/app/abc' }]);
  });

  afterEach(() => {
    localStorage.removeItem('lastExportFormat');
  });

  it.each(ALL_FORMATS)('labels the export button with the selected format (%s)', async (format) => {
    localStorage.setItem('lastExportFormat', format);
    await loadPopup(conversationWith([pairAt(0)]));

    expect(document.getElementById('export-button-label')?.textContent).toBe(
      `Export ${FORMAT_NAMES[format] ?? format}`
    );
  });

  it.each(ALL_FORMATS)('disables print for DOCX only (%s)', async (format) => {
    localStorage.setItem('lastExportFormat', format);
    await loadPopup(conversationWith([pairAt(0)]));

    const print = document.getElementById('print-button') as HTMLButtonElement;
    expect(print.disabled).toBe(format === 'docx');
    expect(print.title).toBe(
      format === 'docx'
        ? `Printing is not available for ${FORMAT_NAMES.docx ?? ''}`
        : `Print ${FORMAT_NAMES[format] ?? format}`
    );
  });

  it('routes the setting rows through the R1 router instead of its own handlers', () => {
    const html = readFileSync(
      resolve(__dirname, '../../../../src/extension/popup/popup.html'),
      'utf-8'
    );
    expect(html).toMatch(/data-nav="content"/);
    expect(html).toMatch(/data-nav="options"/);
    expect(html).toMatch(/data-format-menu-toggle/);
  });
});
