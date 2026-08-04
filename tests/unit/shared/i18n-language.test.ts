/**
 * The language override.
 *
 * `chrome.i18n.getMessage` takes no locale argument and always answers in the
 * browser's UI language, so the language setting is served by loading the
 * chosen `_locales/<code>/messages.json` by hand and answering from it first.
 * Every case here therefore pins a browser locale that is *not* the one being
 * asked for, and asserts the requested one comes back — an assertion that
 * would pass by coincidence if both were English proves nothing.
 *
 * The bundles are read off disk rather than hand-written, so a real
 * translation going missing fails here.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  applyLanguagePreference,
  getMessage,
  getUILanguage,
  resetLanguageOverride,
} from '../../../src/shared/i18n';

const ROOT = resolve(__dirname, '../../..');

function realBundle(locale: string): string {
  return readFileSync(resolve(ROOT, `_locales/${locale}/messages.json`), 'utf-8');
}

const originalChrome = globalThis.chrome;

/**
 * A browser running in German, so anything that comes back in another language
 * can only have come from the override.
 */
function browserSpeaking(locale = 'de'): void {
  globalThis.chrome = {
    ...originalChrome,
    i18n: {
      getUILanguage: () => locale,
      getMessage: (key: string) => `${key}[browser-${locale}]`,
    },
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
  } as unknown as typeof chrome;
}

/** Serve the real bundles; anything else 404s. */
function serveBundles(override?: Record<string, string>): void {
  vi.stubGlobal('fetch', (url: string) => {
    const locale = /_locales\/([a-z]+)\/messages\.json$/.exec(url)?.[1];
    const body = locale === undefined ? undefined : (override?.[locale] ?? realBundle(locale));
    if (body === undefined) return Promise.resolve({ ok: false, status: 404 });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(body)) });
  });
}

afterEach(() => {
  resetLanguageOverride();
  vi.unstubAllGlobals();
  globalThis.chrome = originalChrome;
});

describe('applyLanguagePreference', () => {
  it('leaves chrome.i18n in charge on auto — the behaviour before the setting existed', async () => {
    browserSpeaking('de');
    serveBundles();

    await applyLanguagePreference('auto');

    expect(getMessage('rowOptions')).toBe('rowOptions[browser-de]');
    expect(getUILanguage()).toBe('de');
  });

  it('answers in the pinned language, not the browser one', async () => {
    browserSpeaking('de');
    serveBundles();

    await applyLanguagePreference('es');

    expect(getMessage('rowOptions')).toBe('Opciones');
    expect(getMessage('submenuBack')).toBe('Volver');
    expect(getUILanguage()).toBe('es');
  });

  it('pins English too, rather than treating it as "no override"', async () => {
    browserSpeaking('fr');
    serveBundles();

    await applyLanguagePreference('en');

    expect(getMessage('rowOptions')).toBe('Options');
    expect(getUILanguage()).toBe('en');
  });

  it('goes back to the browser on a return to auto', async () => {
    browserSpeaking('de');
    serveBundles();

    await applyLanguagePreference('es');
    await applyLanguagePreference('auto');

    expect(getMessage('rowOptions')).toBe('rowOptions[browser-de]');
    expect(getUILanguage()).toBe('de');
  });
});

describe('getMessage under an override', () => {
  it('substitutes $1…$n positionally', async () => {
    browserSpeaking('de');
    serveBundles();

    await applyLanguagePreference('es');

    // `exportButtonFormat` is "Exportar $1" in es.
    expect(getMessage('exportButtonFormat', 'Markdown')).toBe('Exportar Markdown');
    // `pairChooserSummary` takes three.
    expect(getMessage('pairChooserSummary', ['2', '14', '4.120'])).toContain('2');
  });

  it('unescapes $$ to a literal $ and leaves an unfilled slot alone', async () => {
    browserSpeaking('de');
    serveBundles({
      es: JSON.stringify({
        dollars: { message: 'Cuesta $$5 por $1 y $2' },
      }),
      en: JSON.stringify({}),
    });

    await applyLanguagePreference('es');

    expect(getMessage('dollars', 'esto')).toBe('Cuesta $5 por esto y $2');
  });

  /**
   * Chrome falls back to `default_locale` for a key the chosen bundle is
   * missing; the override has to do the same, or a key a translator has not
   * reached yet renders as raw `camelCaseKeyName` in the UI.
   */
  it('falls back to English for a key the pinned bundle has not translated', async () => {
    browserSpeaking('de');
    serveBundles({
      es: JSON.stringify({ rowOptions: { message: 'Opciones' } }),
    });

    await applyLanguagePreference('es');

    expect(getMessage('rowOptions')).toBe('Opciones');
    expect(getMessage('submenuBack')).toBe('Back');
  });

  it('falls back to English for a key present but blank', async () => {
    browserSpeaking('de');
    serveBundles({
      es: JSON.stringify({ submenuBack: { message: '' } }),
    });

    await applyLanguagePreference('es');

    expect(getMessage('submenuBack')).toBe('Back');
  });

  /**
   * A bundle that cannot be read must degrade to the browser's language. The
   * failure mode being guarded against is a popup full of raw message keys,
   * which is worse than the wrong language.
   */
  it('degrades to the browser language when the bundle cannot be fetched', async () => {
    browserSpeaking('de');
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 404 }));

    await applyLanguagePreference('es');

    expect(getMessage('rowOptions')).toBe('rowOptions[browser-de]');
    expect(getUILanguage()).toBe('de');
  });

  it('degrades the same way when fetch itself throws', async () => {
    browserSpeaking('de');
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));

    await applyLanguagePreference('es');

    expect(getMessage('rowOptions')).toBe('rowOptions[browser-de]');
  });

  /**
   * The override is not sticky: a failed switch must not strand the extension
   * on the language it was using before.
   */
  it('drops a working override when a later switch fails', async () => {
    browserSpeaking('de');
    serveBundles();
    await applyLanguagePreference('es');
    expect(getMessage('rowOptions')).toBe('Opciones');

    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 404 }));
    await applyLanguagePreference('fr');

    expect(getMessage('rowOptions')).toBe('rowOptions[browser-de]');
  });

  it('needs no chrome.runtime.getURL to stay usable (plain page / test context)', async () => {
    globalThis.chrome = {
      ...originalChrome,
      i18n: { getUILanguage: () => 'de', getMessage: (key: string) => `${key}[browser-de]` },
      runtime: {},
    } as unknown as typeof chrome;

    await applyLanguagePreference('es');

    expect(getMessage('rowOptions')).toBe('rowOptions[browser-de]');
  });
});
