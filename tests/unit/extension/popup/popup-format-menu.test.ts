/**
 * Popup — format menu (lo-e6b9 / R3)
 *
 * The chevron half of the split button opens a floating menu of the six
 * formats. These tests drive the real popup.html, so a row renamed or dropped
 * in the markup fails here rather than silently leaving the menu empty.
 * Geometry is CSS (jsdom has no layout engine); what is asserted is the state
 * machine: open/close, which row is marked, and what a choice changes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { QAPair } from '../../../../src/core/types/conversation';

const mockTabsQuery = vi.fn();
const mockTabsSendMessage = vi.fn();

const EN_MESSAGES: Record<string, string> = {
  statusReady: 'Ready',
  exportButtonFormat: 'Export $1',
  printButtonFormat: 'Print $1',
  printUnavailableFormat: 'Printing is not available for $1',
  formatMenuLabel: 'Format',
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

const POPUP_HTML = readFileSync(
  resolve(__dirname, '../../../../src/extension/popup/popup.html'),
  'utf-8'
)
  .replace(/[\s\S]*<body>/, '')
  .replace(/<\/body>[\s\S]*/, '')
  .replace(/<script[\s\S]*?<\/script>/g, '');

function pairAt(index: number): QAPair {
  return {
    id: `pair-${String(index)}`,
    index,
    question: { id: `q-${String(index)}`, role: 'user', content: `Question ${String(index)}` },
    answer: { id: `a-${String(index)}`, role: 'assistant', content: `Answer ${String(index)}` },
    selected: true,
  };
}

const CONVERSATION = {
  id: 'conv-1',
  title: 'Gemini Conversation',
  platform: 'gemini',
  pairs: [pairAt(0)],
  url: 'https://gemini.google.com/app/abc',
};

async function loadPopup(): Promise<void> {
  document.body.innerHTML = POPUP_HTML;
  mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) =>
    message.type === 'get_conversation'
      ? Promise.resolve({ success: true, data: CONVERSATION })
      : Promise.resolve({ success: true })
  );
  vi.resetModules();
  await import('../../../../src/extension/popup/popup');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => {
    expect(document.getElementById('status-indicator')?.className).toContain('active');
  });
}

function bodyBox(): HTMLElement {
  const el = document.getElementById('popup-body');
  if (!el) throw new Error('popup-body missing from popup.html');
  return el;
}

function menuOpen(): boolean {
  return bodyBox().dataset.formatMenuOpen === 'true';
}

function toggleMenu(): void {
  document.getElementById('format-menu-toggle')?.click();
}

function formatRows(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[data-format-menu] [data-format]')];
}

function rowFor(format: string): HTMLButtonElement {
  const row = document.querySelector<HTMLButtonElement>(
    `[data-format-menu] [data-format="${format}"]`
  );
  if (!row) throw new Error(`no format row for ${format}`);
  return row;
}

function checkedFormats(): string[] {
  return formatRows()
    .filter((row) => row.getAttribute('aria-checked') === 'true')
    .map((row) => row.dataset.format ?? '');
}

function printButton(): HTMLButtonElement {
  return document.getElementById('print-button') as HTMLButtonElement;
}

describe('popup format menu', () => {
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

  it('lists the six formats in the menu, in spec order', async () => {
    await loadPopup();
    expect(formatRows().map((row) => row.dataset.format)).toEqual([
      'md',
      'pdf',
      'html',
      'docx',
      'txt',
      'json',
    ]);
  });

  it('opens on the chevron and closes on a second press', async () => {
    await loadPopup();
    expect(menuOpen()).toBe(false);

    toggleMenu();
    expect(menuOpen()).toBe(true);

    toggleMenu();
    expect(menuOpen()).toBe(false);
  });

  it('closes on Esc', async () => {
    await loadPopup();
    toggleMenu();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(menuOpen()).toBe(false);
    expect(bodyBox().dataset.view).toBe('main');
  });

  it('closes on a click outside it but stays open on a click inside', async () => {
    await loadPopup();
    toggleMenu();

    document.getElementById('format-menu-label')?.click();
    expect(menuOpen()).toBe(true);

    document.getElementById('conversation-title')?.click();
    expect(menuOpen()).toBe(false);
  });

  it('marks the persisted format on open and moves the mark on a choice', async () => {
    localStorage.setItem('lastExportFormat', 'html');
    await loadPopup();

    toggleMenu();
    expect(checkedFormats()).toEqual(['html']);

    rowFor('json').click();
    expect(checkedFormats()).toEqual(['json']);
  });

  it('scrolls the marked row into view when the menu opens', async () => {
    localStorage.setItem('lastExportFormat', 'json');
    await loadPopup();
    const scrollIntoView = vi.fn();
    rowFor('json').scrollIntoView = scrollIntoView;

    toggleMenu();

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('persists the choice, relabels the button and closes the menu', async () => {
    await loadPopup();
    toggleMenu();

    rowFor('txt').click();

    expect(localStorage.getItem('lastExportFormat')).toBe('txt');
    expect(document.getElementById('export-button-label')?.textContent).toBe('Export Plain text');
    expect(menuOpen()).toBe(false);
  });

  it('takes print away for Word and gives it back for a printable format', async () => {
    await loadPopup();
    toggleMenu();

    rowFor('docx').click();
    expect(printButton().disabled).toBe(true);

    toggleMenu();
    rowFor('pdf').click();
    expect(printButton().disabled).toBe(false);
  });

  it('reopens with the format chosen last time still marked', async () => {
    await loadPopup();
    toggleMenu();
    rowFor('docx').click();

    toggleMenu();

    expect(menuOpen()).toBe(true);
    expect(checkedFormats()).toEqual(['docx']);
  });
});
