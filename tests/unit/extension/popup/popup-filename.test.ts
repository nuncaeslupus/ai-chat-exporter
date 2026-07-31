/**
 * Popup — "File name" submenu (lo-aa0c / R6)
 *
 * The name is composed from draggable chips. What has to hold: the footer
 * shows the name the download would really get (same string as the Options
 * row above it), the piece list round-trips through StorageService, add /
 * remove / reorder / Default all move that name, and a popup that has never
 * been here keeps today's name.
 *
 * The DOM is the real popup.html, so markup these tests drive cannot be
 * dropped silently.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DEFAULT_FILENAME_PIECES } from '../../../../src/core/types/config';

const mockTabsQuery = vi.fn();
const mockTabsSendMessage = vi.fn();

/** Real English strings for the keys this view renders. */
const EN_MESSAGES: Record<string, string> = {
  statusReady: 'Ready',
  conversationUntitled: 'Untitled',
  platformClaude: 'Claude',
  optionsFilenameRow: 'File name',
  filenameRestoreDefault: 'Default',
  filenameDragHint: 'Drag the pieces to reorder them.',
  filenameAddPiece: '+ $1',
  filenameRemovePiece: 'Remove piece',
  filenamePiecePlatform: 'Platform',
  filenamePieceModel: 'Model',
  filenamePieceTitle: 'Title',
  filenamePieceDate: 'Date',
  filenamePieceTime: 'Time',
  filenamePiecePairCount: 'No. of pairs',
  filenamePieceLiteral: 'Free text',
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

const POPUP_HTML = readFileSync(
  resolve(__dirname, '../../../../src/extension/popup/popup.html'),
  'utf-8'
)
  .replace(/[\s\S]*<body>/, '')
  .replace(/<\/body>[\s\S]*/, '')
  .replace(/<script[\s\S]*?<\/script>/g, '');

/**
 * `createdAt` is a string on purpose: it crosses `chrome.tabs.sendMessage`,
 * which JSON-serialises a Date. Every name below has to survive that.
 */
const CONVERSATION = {
  id: 'conv-1',
  title: 'Test conversation',
  platform: 'claude',
  model: 'claude-opus-4',
  // Three pairs so the `No. of pairs` piece has something to render.
  pairs: [0, 1, 2].map((index) => ({
    id: `p${String(index)}`,
    index,
    selected: true,
    question: { id: `q${String(index)}`, role: 'user', content: 'Question' },
    answer: { id: `a${String(index)}`, role: 'assistant', content: 'Answer' },
  })),
  url: 'https://claude.ai/chat/abc',
  // Midday UTC so the local calendar day is 29 July in every plausible TZ.
  createdAt: '2026-07-29T12:00:00.000Z',
};

function mockStatefulSyncStorage(): void {
  const store: Record<string, unknown> = {};
  Object.assign(chrome.storage.sync, {
    get: (key: string) => Promise.resolve({ [key]: store[key] }),
    set: (items: Record<string, unknown>) => {
      Object.assign(store, items);
      return Promise.resolve();
    },
  });
}

async function loadPopup(): Promise<void> {
  document.body.innerHTML = POPUP_HTML;
  vi.resetModules();
  await import('../../../../src/extension/popup/popup');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => {
    expect(document.getElementById('status-indicator')?.className).toContain('active');
  });
}

function chipLabels(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('#filename-pieces .filename-chip')).map(
    (chip) => chip.dataset.pieceType ?? ''
  );
}

function addChipLabels(): string[] {
  return Array.from(document.querySelectorAll('#filename-add-chips .filename-add-chip')).map(
    (chip) => chip.textContent ?? ''
  );
}

function previewName(): string {
  return document.getElementById('filename-preview')?.textContent ?? '';
}

async function storedPieces(): Promise<unknown> {
  const stored = await chrome.storage.sync.get('user_preferences');
  return (stored.user_preferences as Record<string, unknown> | undefined)?.filenamePieces;
}

/** Wait for the footer to settle on a name, which is always async. */
async function expectName(name: string): Promise<void> {
  await vi.waitFor(() => {
    expect(previewName()).toBe(name);
  });
}

function addPiece(type: string): void {
  document.querySelector<HTMLButtonElement>(`[data-add-piece="${type}"]`)!.click();
}

beforeEach(() => {
  mockTabsQuery.mockReset();
  mockTabsSendMessage.mockReset();
  mockStatefulSyncStorage();
  Object.assign(chrome, {
    tabs: { query: mockTabsQuery, sendMessage: mockTabsSendMessage, create: vi.fn() },
    runtime: { getManifest: () => ({ version: '1.1.1' }) },
    i18n: mockI18n(),
  });
  mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
  mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) =>
    message.type === 'get_conversation'
      ? Promise.resolve({ success: true, data: CONVERSATION })
      : Promise.resolve({ success: true })
  );
  localStorage.clear();
});

describe('file name submenu — the starting point', () => {
  it('opens on the default pieces and today’s name, with nothing stored', async () => {
    await loadPopup();

    expect(chipLabels()).toEqual(DEFAULT_FILENAME_PIECES.map((piece) => piece.type));
    await expectName('Test-conversation_2026-07-29.md');
    expect(await storedPieces()).toBeUndefined();
  });

  it('shows the same name in the footer as in the Options row', async () => {
    await loadPopup();
    await expectName('Test-conversation_2026-07-29.md');

    expect(document.getElementById('options-filename-preview')?.textContent).toBe(previewName());
  });

  it('offers an add-chip for every piece not already in the name', async () => {
    await loadPopup();

    // Title and Date are already in the name; free text is always on offer.
    expect(addChipLabels()).toEqual([
      '+ Platform',
      '+ Model',
      '+ Time',
      '+ Free text',
      '+ No. of pairs',
    ]);
  });

  it('puts a literal `_` between the pieces, the one the renderer emits', async () => {
    await loadPopup();

    const separators = document.querySelectorAll('#filename-pieces .filename-separator');
    expect(Array.from(separators).map((node) => node.textContent)).toEqual(['_']);
  });
});

describe('file name submenu — editing the pieces', () => {
  it('adds a piece, moves the name with it, and persists the list', async () => {
    await loadPopup();

    addPiece('platform');

    await expectName('Test-conversation_2026-07-29_Claude.md');
    expect(chipLabels()).toEqual(['title', 'date', 'platform']);
    await vi.waitFor(async () => {
      expect(await storedPieces()).toEqual([
        { type: 'title' },
        { type: 'date' },
        { type: 'platform' },
      ]);
    });
  });

  it('removes a piece from the name', async () => {
    await loadPopup();

    document.querySelectorAll<HTMLButtonElement>('.filename-chip-remove')[1]!.click();

    expect(chipLabels()).toEqual(['title']);
    await expectName('Test-conversation.md');
  });

  it('reorders the output when a chip is dragged onto another', async () => {
    await loadPopup();
    await expectName('Test-conversation_2026-07-29.md');

    const chips = document.querySelectorAll<HTMLElement>('#filename-pieces .filename-chip');
    chips[1]!.dispatchEvent(new Event('dragstart', { bubbles: true }));
    chips[0]!.dispatchEvent(new Event('drop', { bubbles: true }));

    expect(chipLabels()).toEqual(['date', 'title']);
    await expectName('2026-07-29_Test-conversation.md');
  });

  it('reorders a chip with Ctrl+ArrowRight and keeps focus on the moved chip (WCAG 2.1.1: dragging alone has no keyboard path)', async () => {
    await loadPopup();
    await expectName('Test-conversation_2026-07-29.md');

    const chips = () => document.querySelectorAll<HTMLElement>('#filename-pieces .filename-chip');
    chips()[0]!.focus();
    chips()[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true })
    );

    expect(chipLabels()).toEqual(['date', 'title']);
    await expectName('2026-07-29_Test-conversation.md');
    expect(document.activeElement).toBe(chips()[1]);
  });

  it('does not reorder past either end of the list', async () => {
    await loadPopup();
    const chips = () => document.querySelectorAll<HTMLElement>('#filename-pieces .filename-chip');

    chips()[0]!.focus();
    chips()[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true })
    );

    expect(chipLabels()).toEqual(['title', 'date']);
  });

  it('ignores Ctrl+Arrow typed inside a free-text chip, so word-navigation in the input still works', async () => {
    await loadPopup();
    addPiece('literal');

    const input = document.querySelector<HTMLInputElement>('.filename-chip-input')!;
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true })
    );

    // Three pieces stayed in place -- the chip-level reorder handler must not
    // have fired for a keydown whose target was the input, not the chip.
    expect(chipLabels()).toEqual(['title', 'date', 'literal']);
  });

  it('renders free text into the name and keeps it out of the variables', async () => {
    await loadPopup();

    addPiece('literal');
    const input = document.querySelector<HTMLInputElement>('.filename-chip-input')!;
    input.value = '{date}-notes';
    input.dispatchEvent(new Event('input'));

    // Braces are stripped: a literal can never smuggle in a variable.
    await expectName('Test-conversation_2026-07-29_date-notes.md');
  });

  it('restores the default list from the header link', async () => {
    await loadPopup();
    addPiece('model');
    await expectName('Test-conversation_2026-07-29_claude-opus-4.md');

    document.getElementById('filename-restore-default')!.click();

    expect(chipLabels()).toEqual(['title', 'date']);
    await expectName('Test-conversation_2026-07-29.md');
  });

  it('never produces an extension-only name, however much is removed', async () => {
    await loadPopup();

    // Remove every chip, one at a time — the first is always at index 0.
    while (document.querySelectorAll('.filename-chip-remove').length > 0) {
      document.querySelector<HTMLButtonElement>('.filename-chip-remove')!.click();
    }

    expect(chipLabels()).toEqual([]);
    await expectName('Test-conversation_2026-07-29.md');
  });

  it('survives a re-open, reading the piece list back from storage', async () => {
    await loadPopup();
    addPiece('pairCount');
    await expectName('Test-conversation_2026-07-29_3.md');

    await loadPopup();

    expect(chipLabels()).toEqual(['title', 'date', 'pairCount']);
    await expectName('Test-conversation_2026-07-29_3.md');
  });

  it('lights the Options dot once the name leaves its default', async () => {
    await loadPopup();
    expect(document.getElementById('options-changed-dot')!.hidden).toBe(true);

    addPiece('platform');

    await vi.waitFor(() => {
      expect(document.getElementById('options-changed-dot')!.hidden).toBe(false);
    });
  });
});
