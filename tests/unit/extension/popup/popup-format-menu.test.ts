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

const POPUP_CSS = readFileSync(
  resolve(__dirname, '../../../../src/extension/popup/popup.css'),
  'utf-8'
);

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

/**
 * Every `loadPopup()` builds a fresh `PopupController`, and its router binds to
 * `document` — which survives the markup being replaced. Left alone, load N
 * leaves N controllers all listening, all re-initializing on the next
 * synthetic `DOMContentLoaded`, and all acting on the same keypress: an
 * ArrowDown moved focus N rows, not one. (With six format rows that wrapped
 * back to a single step at N = 13, which is the only reason the roving-focus
 * test read as green.) Recording what each load binds lets the next one unbind
 * it, so exactly one controller is ever live.
 */
let documentListeners: [string, EventListenerOrEventListenerObject][] = [];

async function loadPopup(): Promise<void> {
  for (const [type, listener] of documentListeners) {
    document.removeEventListener(type, listener);
  }
  documentListeners = [];

  document.body.innerHTML = POPUP_HTML;
  mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) =>
    message.type === 'get_conversation'
      ? Promise.resolve({ success: true, data: CONVERSATION })
      : Promise.resolve({ success: true })
  );
  vi.resetModules();

  const addEventListener = document.addEventListener.bind(document);
  const spy = vi
    .spyOn(document, 'addEventListener')
    .mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options) => {
      documentListeners.push([type, listener]);
      addEventListener(type, listener, options);
    });
  try {
    await import('../../../../src/extension/popup/popup');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await vi.waitFor(() => {
      expect(document.getElementById('status-indicator')?.className).toContain('active');
    });
  } finally {
    spy.mockRestore();
  }
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

/**
 * A11Y-1: the menu declared `role="menu"` but never moved focus, never
 * announced open/closed state, and left the dimmed background behind it
 * focusable and clickable.
 */
describe('popup format menu accessibility', () => {
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

  function toggle(): HTMLElement {
    return document.getElementById('format-menu-toggle')!;
  }

  it('declares aria-haspopup and toggles aria-expanded with the menu', async () => {
    await loadPopup();
    expect(toggle().getAttribute('aria-haspopup')).toBe('true');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');

    toggleMenu();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    toggleMenu();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('moves focus into the menu, onto the current format, when it opens', async () => {
    localStorage.setItem('lastExportFormat', 'pdf');
    await loadPopup();

    toggleMenu();

    expect(document.activeElement).toBe(rowFor('pdf'));
  });

  /**
   * The popup opens with the menu closed, and `initialize()` paints that
   * closed state through the same setter that closes it. Focusing the toggle
   * unconditionally meant a freshly opened popup started with a focus ring on
   * the chevron — the split button looked half-pressed before anything was
   * touched. Focus belongs to the browser until a menu has actually been open.
   */
  it('leaves the chevron unfocused when the popup opens', async () => {
    await loadPopup();

    expect(document.activeElement).not.toBe(toggle());
    expect(menuOpen()).toBe(false);
  });

  it('returns focus to the toggle when the menu closes', async () => {
    await loadPopup();
    toggleMenu();
    rowFor('md').focus();

    toggleMenu();

    expect(document.activeElement).toBe(toggle());
  });

  it('moves focus between rows with ArrowDown / ArrowUp while the menu is open', async () => {
    await loadPopup();
    toggleMenu();
    rowFor('md').focus();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(document.activeElement).toBe(rowFor('pdf'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(document.activeElement).toBe(rowFor('md'));
  });

  it('jumps to the first/last row with Home/End while the menu is open', async () => {
    await loadPopup();
    toggleMenu();
    rowFor('pdf').focus();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    expect(document.activeElement).toBe(rowFor('json'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(document.activeElement).toBe(rowFor('md'));
  });

  it('makes the background inert while the menu is open, and restores it on close', async () => {
    await loadPopup();

    toggleMenu();
    expect(document.querySelector('.setting-rows')?.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.view-scroll')?.hasAttribute('inert')).toBe(true);
    expect(printButton().hasAttribute('inert')).toBe(true);

    toggleMenu();
    expect(document.querySelector('.setting-rows')?.hasAttribute('inert')).toBe(false);
    expect(document.querySelector('.view-scroll')?.hasAttribute('inert')).toBe(false);
    expect(printButton().hasAttribute('inert')).toBe(false);
  });

  it('owns the menuitemradio rows directly under role="menu"', async () => {
    await loadPopup();
    const menu = document.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    const directChildren = [...(menu?.children ?? [])];
    expect(directChildren.length).toBeGreaterThan(0);
    expect(directChildren.every((child) => child.getAttribute('role') === 'menuitemradio')).toBe(
      true
    );
  });
});

/** A rule's declarations with its comments stripped -- prose mentioning an old
 *  value must not satisfy (or defeat) an assertion about the live one. */
function declarations(rule: RegExp): string {
  return (rule.exec(POPUP_CSS)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/*
 * jsdom computes no layout, so these guard the two CSS facts that made the
 * menu clip rather than the pixels themselves -- measured in Chrome at 436px:
 * the six-format list needs 258px and a short conversation leaves 220px.
 */
describe('popup format menu fits its formats', () => {
  it('caps the menu against the space it has, not a fixed pixel height', () => {
    const menu = declarations(/\.format-menu \{([^}]*)\}/);
    expect(menu).toMatch(/max-height:\s*calc\(100% -/);
    // A flat px cap is what hid JSON entirely and sliced "Plain text".
    expect(menu).not.toMatch(/max-height:\s*\d+px/);
  });

  it('grows the popup while the menu is open so nothing is cut off', () => {
    expect(POPUP_CSS).toMatch(
      /\.popup-body\[data-format-menu-open='true'\]\s*\{[^}]*min-height:\s*\d+px/
    );
  });
});

describe('popup submenu headers', () => {
  it('puts the title on the label column instead of a third edge', () => {
    // The back button already lands its glyph on the band edge and ends its
    // footprint on the label column, so any gap here moves the title off both.
    const header = declarations(/\.submenu-header \{([^}]*)\}/);
    expect(header).toMatch(/gap:\s*0\b/);
  });
});
