/**
 * Popup — "Options" submenu (lo-1789 / R5)
 *
 * Three rows and a footer. What has to hold: both checkboxes round-trip
 * through StorageService (a re-opened popup shows what was set), the green
 * dot on the main view is *derived* from DEFAULT_PREFERENCES rather than
 * stored — so it appears on the first change and goes again once reverted —
 * and the filename row shows the name the export would really be saved as.
 * The DOM is the real popup.html, so markup these tests drive cannot be
 * dropped silently.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createTestQAPair } from '../../../utils/exporter-helpers';

const mockTabsQuery = vi.fn();
const mockTabsSendMessage = vi.fn();

/** Real English strings for the keys this view renders. */
const EN_MESSAGES: Record<string, string> = {
  statusReady: 'Ready',
  conversationUntitled: 'Untitled',
  platformClaude: 'Claude',
  rowOptions: 'Options',
  rowOptionsChanged: 'Some settings have been changed',
  optionIncludeMetadata: 'Header with the chat details',
  optionIncludeTimestamps: 'Time on each message',
  optionFontScale: 'Text size',
  optionsFilenameRow: 'File name',
  footerPrivacy: 'Privacy',
  footerGitHub: 'GitHub',
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

/**
 * `createdAt` is a string on purpose: it crosses `chrome.tabs.sendMessage`,
 * which JSON-serialises a Date. The filename preview has to survive that.
 */
const CONVERSATION = {
  id: 'conv-1',
  title: 'Test conversation',
  platform: 'claude',
  pairs: [createTestQAPair(0, 'First question', 'First answer')],
  url: 'https://claude.ai/chat/abc',
  // Midday UTC so the local calendar day is 29 July in every plausible TZ.
  createdAt: '2026-07-29T12:00:00.000Z',
};

/** In-memory chrome.storage.sync, so a set() is visible to a later get(). */
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

function toggle(id: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`#${id}`)!;
}

function dotHidden(): boolean {
  // `hidden` is `string | boolean` in the current DOM lib -- it also accepts
  // `"until-found"`, which is still hidden. Coerce rather than assert, so the
  // helper keeps meaning "is it hidden" for every value the property can take.
  return Boolean(document.getElementById('options-changed-dot')!.hidden);
}

/** Whatever StorageService actually wrote to chrome.storage.sync. */
async function storedPreferences(): Promise<Record<string, unknown>> {
  const stored = await chrome.storage.sync.get('user_preferences');
  return (stored.user_preferences ?? {}) as Record<string, unknown>;
}

const PREFERENCE_OF: Record<string, string> = {
  'option-include-metadata': 'includeMetadata',
  'option-include-timestamps': 'includeTimestamps',
};

/** Flip a checkbox the way a click does, and wait for the write to land. */
async function setToggle(id: string, checked: boolean): Promise<void> {
  const box = toggle(id);
  box.checked = checked;
  box.dispatchEvent(new Event('change'));
  await vi.waitFor(async () => {
    expect((await storedPreferences())[PREFERENCE_OF[id]!]).toBe(checked);
  });
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
});

describe('options submenu — the setting rows', () => {
  it('binds the two checkboxes to the stored preferences and defaults them on', async () => {
    await loadPopup();

    expect(toggle('option-include-metadata').checked).toBe(true);
    expect(toggle('option-include-timestamps').checked).toBe(true);
  });

  it('writes a toggle through StorageService and survives a re-open', async () => {
    await loadPopup();
    await setToggle('option-include-timestamps', false);

    // Re-open: a fresh popup instance reading the same storage.
    await loadPopup();

    expect(toggle('option-include-timestamps').checked).toBe(false);
    expect(toggle('option-include-metadata').checked).toBe(true);
  });

  it('offers no preference for the day-change date — timestamps imply it', async () => {
    await loadPopup();

    const labels = Array.from(document.querySelectorAll('#view-options .option-row-label')).map(
      (node) => node.textContent
    );
    expect(labels).toEqual([
      'Header with the chat details',
      'Time on each message',
      'Text size',
      'File name',
    ]);
  });

  it('opens the filename view from its row without a display juggle', async () => {
    await loadPopup();

    const navRow = document.querySelector<HTMLButtonElement>('#view-options [data-nav="filename"]');
    expect(navRow).not.toBeNull();
    navRow!.click();

    expect(document.getElementById('view-filename')!.hidden).toBe(false);
    expect(document.getElementById('view-options')!.hidden).toBe(true);
  });
});

describe('options submenu — the changed-from-default dot', () => {
  it('is absent at defaults, present after one change, and absent again once reverted', async () => {
    await loadPopup();
    expect(dotHidden()).toBe(true);

    await setToggle('option-include-metadata', false);
    await vi.waitFor(() => {
      expect(dotHidden()).toBe(false);
    });

    await setToggle('option-include-metadata', true);
    await vi.waitFor(() => {
      expect(dotHidden()).toBe(true);
    });
  });

  it('is still shown on a re-open, derived from storage rather than a stored flag', async () => {
    await loadPopup();
    await setToggle('option-include-metadata', false);

    await loadPopup();

    await vi.waitFor(() => {
      expect(dotHidden()).toBe(false);
    });
    expect(Object.keys(await storedPreferences())).not.toContain('optionsChanged');
  });
});

describe('options submenu — the filename row', () => {
  function preview(): HTMLElement {
    return document.getElementById('options-filename-preview')!;
  }

  it('shows the name the export would really be saved as', async () => {
    await loadPopup();

    // Default template `{title}_{date}`, title sanitised, extension = format.
    await vi.waitFor(() => {
      expect(preview().textContent).toBe('Test-conversation_2026-07-29.md');
    });
  });

  it('follows the chosen format', async () => {
    await loadPopup();
    await vi.waitFor(() => {
      expect(preview().textContent).toContain('.md');
    });

    document.querySelector<HTMLElement>('[data-format-menu] [data-format="docx"]')?.click();

    await vi.waitFor(() => {
      expect(preview().textContent).toBe('Test-conversation_2026-07-29.docx');
    });
  });
});

describe('options submenu — the footer', () => {
  it('carries the version, the two links and Done', async () => {
    await loadPopup();

    const footer = document.querySelector('#view-options .submenu-footer');
    expect(footer?.querySelector('#options-footer-version')?.textContent).toBe('v1.1.1');
    const links = Array.from(footer?.querySelectorAll('a') ?? []).map((a) => a.textContent?.trim());
    expect(links).toEqual(['Privacy', 'GitHub']);
    expect(footer?.querySelector('[data-nav="main"]')?.textContent?.trim()).toBe('Done');
  });
});
