/**
 * Popup — "Content" submenu, the pair chooser (lo-656b / R4)
 *
 * The four behaviours the spec is emphatic about: expanding a row never moves
 * the selection, All/None drive every checkbox and the footer, a day separator
 * marks each change of date and never opens the list, and the word count in
 * the footer follows the selection. The DOM is the real popup.html, so markup
 * these tests drive cannot be dropped silently.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { QAPair } from '../../../../src/core/types/conversation';

const mockTabsQuery = vi.fn();
const mockTabsSendMessage = vi.fn();

/** Real English strings for the keys this view renders. */
const EN_MESSAGES: Record<string, string> = {
  statusReady: 'Ready',
  conversationUntitled: 'Untitled',
  platformClaude: 'Claude',
  qaSelectionTitle: 'Choose pairs',
  qaSelectionSelectAll: 'All',
  qaSelectionDeselectAll: 'None',
  qaSelectionPairFallbackLabel: 'Q&A pair $1',
  pairChooserMore: 'more',
  pairChooserLess: 'less',
  pairChooserSummary: '$1 of $2 · $3 words',
  submenuBack: 'Back',
  submenuDone: 'Done',
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

/** Long enough to be clamped, so the row grows a `more` link. */
const LONG_QUESTION =
  'I am putting together a systematic investment research programme and I need you to review the ' +
  'walk-forward validation, the treatment of transaction costs and the position sizing rules.';

function pairAt(
  index: number,
  options: { date?: string; question?: string; answer?: string; selected?: boolean } = {}
): QAPair {
  const stamp = options.date === undefined ? {} : { timestamp: new Date(options.date) };
  return {
    id: `pair-${String(index)}`,
    index,
    question: {
      id: `q-${String(index)}`,
      role: 'user',
      content: options.question ?? `Question ${String(index)}`,
      ...stamp,
    },
    answer: {
      id: `a-${String(index)}`,
      role: 'assistant',
      content: options.answer ?? `Answer ${String(index)}`,
      ...stamp,
    },
    selected: options.selected ?? true,
  };
}

function conversationWith(pairs: QAPair[]) {
  return {
    id: 'conv-1',
    title: 'Test conversation',
    platform: 'claude',
    pairs,
    url: 'https://claude.ai/chat/abc',
  };
}

async function loadPopup(pairs: QAPair[]) {
  document.body.innerHTML = POPUP_HTML;
  mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) =>
    message.type === 'get_conversation'
      ? Promise.resolve({ success: true, data: conversationWith(pairs) })
      : Promise.resolve({ success: true })
  );
  vi.resetModules();
  await import('../../../../src/extension/popup/popup');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => {
    expect(document.querySelectorAll('#qa-selection-list .pair-row')).toHaveLength(pairs.length);
  });
}

function checkboxes(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('#qa-selection-list input[type="checkbox"]')
  );
}

function summary(): string {
  return document.getElementById('qa-selection-count')?.textContent ?? '';
}

function rowChildren(): Element[] {
  return Array.from(document.getElementById('qa-selection-list')?.children ?? []);
}

beforeEach(() => {
  mockTabsQuery.mockReset();
  mockTabsSendMessage.mockReset();
  Object.assign(chrome, {
    tabs: { query: mockTabsQuery, sendMessage: mockTabsSendMessage, create: vi.fn() },
    runtime: { getManifest: () => ({ version: '1.1.1' }) },
    i18n: mockI18n(),
  });
  mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
});

describe('pair chooser — expanding a row', () => {
  it('reveals the full question without touching the selection', async () => {
    await loadPopup([
      pairAt(0, { question: LONG_QUESTION }),
      pairAt(1, { question: LONG_QUESTION }),
    ]);

    // Deselect the second pair so the assertion has a real state to preserve.
    checkboxes()[1]!.checked = false;
    checkboxes()[1]!.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(summary()).toContain('1 of 2');
    });
    const before = summary();

    const toggle = document.querySelector<HTMLButtonElement>('.pair-row .pair-row-toggle');
    expect(toggle?.textContent).toBe('more');
    toggle!.click();

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>('.pair-row')?.dataset.expanded).toBe('true');
    });
    expect(document.querySelector('.pair-row .pair-row-toggle')?.textContent).toBe('less');
    expect(checkboxes().map((box) => box.checked)).toEqual([true, false]);
    expect(summary()).toBe(before);
  });

  it('collapses again on a second click, still without changing the selection', async () => {
    await loadPopup([pairAt(0, { question: LONG_QUESTION })]);

    const toggle = () => document.querySelector<HTMLButtonElement>('.pair-row-toggle');
    toggle()!.click();
    await vi.waitFor(() => {
      expect(toggle()?.textContent).toBe('less');
    });
    toggle()!.click();
    await vi.waitFor(() => {
      expect(toggle()?.textContent).toBe('more');
    });

    expect(checkboxes().every((box) => box.checked)).toBe(true);
  });

  it('offers no expander for a question that already fits the two lines', async () => {
    await loadPopup([pairAt(0, { question: 'Short one' })]);

    expect(document.querySelector('.pair-row-toggle')).toBeNull();
  });
});

describe('pair chooser — All / None', () => {
  it('drives every checkbox and the footer summary', async () => {
    await loadPopup([pairAt(0), pairAt(1), pairAt(2)]);

    const toggleAll = document.getElementById('qa-selection-toggle-all') as HTMLButtonElement;
    expect(toggleAll.textContent).toBe('None');
    expect(summary()).toContain('3 of 3');

    toggleAll.click();
    await vi.waitFor(() => {
      expect(checkboxes().every((box) => !box.checked)).toBe(true);
    });
    expect(toggleAll.textContent).toBe('All');
    expect(summary()).toContain('0 of 3');

    toggleAll.click();
    await vi.waitFor(() => {
      expect(checkboxes().every((box) => box.checked)).toBe(true);
    });
    expect(toggleAll.textContent).toBe('None');
    expect(summary()).toContain('3 of 3');
  });
});

describe('pair chooser — day separators', () => {
  it('appears exactly at each change of date and never before the first row', async () => {
    await loadPopup([
      pairAt(0, { date: '2026-07-27T10:00:00' }),
      pairAt(1, { date: '2026-07-27T18:00:00' }),
      pairAt(2, { date: '2026-07-28T09:00:00' }),
      pairAt(3, { date: '2026-07-28T11:00:00' }),
      pairAt(4, { date: '2026-07-29T09:00:00' }),
    ]);

    const children = rowChildren();
    const separatorAt = children
      .map((child, position) => (child.classList.contains('pair-day-separator') ? position : -1))
      .filter((position) => position !== -1);

    // Two date changes → two separators, sitting immediately before pairs 3 and 5.
    expect(separatorAt).toEqual([2, 5]);
    expect(children[0]?.classList.contains('pair-day-separator')).toBe(false);
    expect(document.querySelectorAll('.pair-day-separator')).toHaveLength(2);
  });

  it('emits nothing when every pair falls on the same day', async () => {
    await loadPopup([
      pairAt(0, { date: '2026-07-29T09:00:00' }),
      pairAt(1, { date: '2026-07-29T23:59:00' }),
    ]);

    expect(document.querySelectorAll('.pair-day-separator')).toHaveLength(0);
  });

  it('emits nothing when the messages carry no timestamps at all', async () => {
    await loadPopup([pairAt(0), pairAt(1), pairAt(2)]);

    expect(document.querySelectorAll('.pair-day-separator')).toHaveLength(0);
  });
});

describe('pair chooser — footer word count', () => {
  /** 3 words asked, 2 answered: 5 per pair. */
  const WORDY = { question: 'one two three', answer: 'four five' };

  it('counts only the pairs that are still selected', async () => {
    await loadPopup([pairAt(0, WORDY), pairAt(1, WORDY), pairAt(2, WORDY)]);

    expect(summary()).toBe('3 of 3 · 15 words');

    checkboxes()[0]!.checked = false;
    checkboxes()[0]!.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(summary()).toBe('2 of 3 · 10 words');
    });
  });

  it('falls to zero words once nothing is selected', async () => {
    await loadPopup([pairAt(0, WORDY), pairAt(1, WORDY)]);

    (document.getElementById('qa-selection-toggle-all') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(summary()).toBe('0 of 2 · 0 words');
    });
  });
});

describe('pair chooser — chrome', () => {
  it('numbers the pairs in normal type, never monospace', () => {
    const css = readFileSync(
      resolve(__dirname, '../../../../src/extension/popup/popup.css'),
      'utf-8'
    );
    const block = /\.pair-row-number\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(block).toContain('tabular-nums');
    expect(block).not.toContain('--font-mono');
    expect(block).not.toContain('monospace');
  });

  it('routes back through the R1 router rather than its own handlers', async () => {
    await loadPopup([pairAt(0)]);

    expect(document.querySelector('.submenu-back')?.getAttribute('data-nav')).toBe('main');
  });

  // Back (header chevron) and Done (footer) both did nothing but return to the
  // main view, so a submenu offered two ways out and neither meant anything the
  // other didn't. The chevron is the one that stayed.
  it('offers exactly one way back out, and it is the chevron', async () => {
    await loadPopup([pairAt(0)]);

    const exits = document.querySelectorAll('#view-content [data-nav="main"]');
    expect(exits).toHaveLength(1);
    expect(exits[0]?.className).toContain('submenu-back');
  });
});
