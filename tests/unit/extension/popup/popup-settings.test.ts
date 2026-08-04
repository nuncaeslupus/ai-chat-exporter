/**
 * Popup — the gear view (P-4)
 *
 * A second, deliberate entry point beside Options: Options stays put (per-export
 * settings), the gear holds app-level configuration -- currently the popup's
 * theme (light/dark/auto) and About (version, Privacy, GitHub), moved here from
 * the Options footer to free it.
 *
 * What has to hold: the theme choice round-trips through StorageService under
 * its own key (never `user_preferences`, so it can never trip the Options row's
 * changed-from-default dot), survives a re-open, and always drives the exact
 * `data-theme` value onto the document root regardless of what the OS reports --
 * proving the explicit choice overrides `prefers-color-scheme` rather than
 * merely agreeing with it by coincidence.
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
  settingsButtonLabel: 'Settings',
  settingsTitle: 'Settings',
  settingsThemeLabel: 'Theme',
  settingsThemeLight: 'Light',
  settingsThemeDark: 'Dark',
  settingsThemeAuto: 'Auto',
  footerPrivacy: 'Privacy',
  footerGitHub: 'GitHub',
  submenuBack: 'Back',
  settingsLanguageLabel: 'Language',
  settingsLanguageAuto: 'Browser language',
  exportButtonFormat: 'Export $1',
  formatNameMD: 'Markdown',
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

const CONVERSATION = {
  id: 'conv-1',
  title: 'Test conversation',
  platform: 'claude',
  pairs: [createTestQAPair(0, 'First question', 'First answer')],
  url: 'https://claude.ai/chat/abc',
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

function themeRadio(value: 'light' | 'dark' | 'auto'): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(
    `input[name="settings-theme"][value="${value}"]`
  )!;
}

/** Flip the theme radio the way a click does, and wait for the write to land. */
async function chooseTheme(value: 'light' | 'dark' | 'auto'): Promise<void> {
  const input = themeRadio(value);
  input.checked = true;
  input.dispatchEvent(new Event('change'));
  await vi.waitFor(async () => {
    expect(await storedTheme()).toBe(value);
  });
}

async function storedTheme(): Promise<unknown> {
  const stored = await chrome.storage.sync.get('theme_preference');
  return stored.theme_preference;
}

function openSettingsView(): void {
  document.getElementById('header-gear')!.click();
}

/**
 * Serve the shipped `_locales` bundles to the override's `fetch`. Real files,
 * not fixtures: the point of the setting is that picking Spanish produces the
 * Spanish the extension actually ships.
 */
function serveRealBundles(): void {
  vi.stubGlobal('fetch', (url: string) => {
    const locale = /_locales\/([a-z]+)\/messages\.json$/.exec(url)?.[1];
    if (!locale) return Promise.resolve({ ok: false, status: 404 });
    const body = readFileSync(
      resolve(__dirname, `../../../../_locales/${locale}/messages.json`),
      'utf-8'
    );
    return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(body)) });
  });
}

function languageSelect(): HTMLSelectElement {
  return document.getElementById('settings-language') as HTMLSelectElement;
}

/**
 * Pick a language the way a click does, then wait for the whole switch — the
 * write *and* the repaint it triggers. Waiting on storage alone returns while
 * the popup is still painted in the old language, which is a race an assertion
 * would lose roughly whenever the repaint takes more than a microtask.
 */
async function chooseLanguage(value: string): Promise<void> {
  const select = languageSelect();
  select.value = value;
  select.dispatchEvent(new Event('change'));
  await vi.waitFor(async () => {
    expect(await storedLanguage()).toBe(value);
    expect(document.documentElement.lang).toBe(value);
  });
}

async function storedLanguage(): Promise<unknown> {
  const stored = await chrome.storage.sync.get('language_preference');
  return stored.language_preference;
}

beforeEach(() => {
  mockTabsQuery.mockReset();
  mockTabsSendMessage.mockReset();
  mockStatefulSyncStorage();
  Object.assign(chrome, {
    tabs: { query: mockTabsQuery, sendMessage: mockTabsSendMessage, create: vi.fn() },
    runtime: {
      getManifest: () => ({ version: '1.1.1' }),
      // The language override loads its bundle through here (see i18n.ts).
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    i18n: mockI18n(),
  });
  serveRealBundles();
  mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
  mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) =>
    message.type === 'get_conversation'
      ? Promise.resolve({ success: true, data: CONVERSATION })
      : Promise.resolve({ success: true })
  );
});

describe('gear view — entry point', () => {
  it('opens from the header gear button, beside Options', async () => {
    await loadPopup();

    expect(document.getElementById('header-gear')).not.toBeNull();
    openSettingsView();

    expect(document.getElementById('view-settings')!.hidden).toBe(false);
    expect(document.getElementById('view-main')!.hidden).toBe(true);
    // Options is untouched -- still its own row, still reachable on its own.
    expect(document.querySelector('.setting-row[data-nav="options"]')).not.toBeNull();
  });
});

describe('gear view — theme', () => {
  it('defaults to auto and applies it to the document root', async () => {
    await loadPopup();

    expect(themeRadio('auto').checked).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('auto');
  });

  it('writes the choice through StorageService, applies it immediately, and survives a re-open', async () => {
    await loadPopup();
    await chooseTheme('dark');

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    // Re-open: a fresh popup instance reading the same storage.
    await loadPopup();

    expect(themeRadio('dark').checked).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('stores the theme under its own key, never inside user_preferences', async () => {
    await loadPopup();
    await chooseTheme('light');

    const userPrefs: Record<string, unknown> = await chrome.storage.sync.get('user_preferences');
    expect((userPrefs.user_preferences as { theme?: unknown } | undefined)?.theme).toBeUndefined();
  });

  it('does not trip the Options row changed-dot -- theme is app-level, not per-export', async () => {
    await loadPopup();
    const dot = () => document.getElementById('options-changed-dot')!;
    expect(dot().hidden).toBe(true);

    await chooseTheme('dark');

    expect(dot().hidden).toBe(true);
  });

  /**
   * The acceptance gate: an explicit choice overrides the OS setting, in
   * either direction. jsdom has no real CSS cascade to exercise `data-theme`
   * against `@media (prefers-color-scheme: dark)`, so this asserts what the
   * popup controls directly -- the root always carries the exact value the
   * user picked, never a value resolved against `matchMedia`. Combined with
   * popup.css's `:root[data-theme='dark']` / `:not([data-theme='light'])`
   * selectors (higher specificity than the plain `:root` the media query
   * paints), that is what makes the override real in both directions.
   */
  it('sets the exact chosen value on the root regardless of what the OS reports', async () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn() });
    vi.stubGlobal('matchMedia', matchMedia);

    await loadPopup();
    await chooseTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    matchMedia.mockReturnValue({ matches: false, addEventListener: vi.fn() });
    await chooseTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    // The popup never consulted matchMedia to decide -- it never had to be called.
    expect(matchMedia).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

/**
 * Language. `chrome.i18n` is mocked as an English browser throughout, so any
 * Spanish that appears can only have come from the override — the whole point
 * of the setting, since `chrome.i18n.getMessage` cannot be asked for a locale.
 */
describe('gear view — language', () => {
  it('defaults to the browser language and says so', async () => {
    await loadPopup();

    expect(languageSelect().value).toBe('auto');
    expect(languageSelect().options[0]?.textContent).toBe('Browser language');
    // Still the mocked English browser, because nothing is pinned.
    expect(document.querySelector('[data-i18n="settingsTitle"]')?.textContent).toBe('Settings');
  });

  it('offers every shipped bundle, each named in its own language', async () => {
    await loadPopup();

    const options = [...languageSelect().options].map((o) => [o.value, o.textContent]);
    expect(options).toEqual([
      ['auto', 'Browser language'],
      ['ca', 'Català'],
      ['de', 'Deutsch'],
      ['en', 'English'],
      ['es', 'Español'],
      ['fr', 'Français'],
      ['it', 'Italiano'],
      ['pt', 'Português'],
    ]);
  });

  it('repaints the popup in the chosen language, static text and runtime text alike', async () => {
    await loadPopup();
    expect(document.querySelector('[data-i18n="rowOptions"]')?.textContent).toBe('Options');

    await chooseLanguage('es');

    // Static, via localizeHtmlPage().
    expect(document.querySelector('[data-i18n="rowOptions"]')?.textContent).toBe('Opciones');
    // Built at runtime — `localizeHtmlPage()` never touches this node, so it
    // only changes if the re-render after the switch reached it too.
    await vi.waitFor(() => {
      expect(document.getElementById('export-button-label')?.textContent).toBe('Exportar Markdown');
    });
    expect(document.documentElement.lang).toBe('es');
  });

  it('survives a re-open', async () => {
    await loadPopup();
    await chooseLanguage('fr');

    await loadPopup();

    expect(languageSelect().value).toBe('fr');
    // `settingsTitle`, not `rowOptions`: French spells that one "Options" too,
    // so it would pass against an override that never loaded.
    await vi.waitFor(() => {
      expect(document.querySelector('[data-i18n="settingsTitle"]')?.textContent).toBe('Paramètres');
    });
    expect(document.documentElement.lang).toBe('fr');
  });

  it('stores the language under its own key, never inside user_preferences', async () => {
    await loadPopup();
    await chooseLanguage('de');

    const userPrefs: Record<string, unknown> = await chrome.storage.sync.get('user_preferences');
    expect(
      (userPrefs.user_preferences as { language?: unknown } | undefined)?.language
    ).toBeUndefined();
  });

  it('does not trip the Options row changed-dot -- language is app-level, not per-export', async () => {
    await loadPopup();
    const dot = () => document.getElementById('options-changed-dot')!;
    expect(dot().hidden).toBe(true);

    await chooseLanguage('it');

    expect(dot().hidden).toBe(true);
  });

  /**
   * Preferences sync across devices and outlive an update, so a value naming a
   * bundle this build no longer ships must not leave the popup fetching a file
   * that isn't there.
   */
  it('ignores a stored language this build does not ship', async () => {
    await chrome.storage.sync.set({ language_preference: 'klingon' });

    await loadPopup();

    expect(languageSelect().value).toBe('auto');
    expect(document.querySelector('[data-i18n="rowOptions"]')?.textContent).toBe('Options');
  });
});

describe('gear view — About', () => {
  it('carries the version and the two links -- moved from the Options footer', async () => {
    await loadPopup();

    const footer = document.querySelector('#view-settings .submenu-footer');
    expect(footer?.querySelector('#settings-footer-version')?.textContent).toBe('v1.1.1');
    const links = Array.from(footer?.querySelectorAll('a') ?? []).map((a) => a.textContent?.trim());
    expect(links).toEqual(['Privacy', 'GitHub']);
    // The footer's Done went with the redundant back-navigation pass; the
    // header chevron is the single way out of every submenu now.
    expect(footer?.querySelector('[data-nav="main"]')).toBeNull();
  });
});
