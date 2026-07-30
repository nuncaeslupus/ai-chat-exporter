/**
 * StorageService tests
 *
 * lo-f096: the popup's metadata/timestamp export toggles persist through
 * StorageService.{get,set}UserPreferences — this proves the round trip
 * survives (simulating a browser restart, where only chrome.storage.sync
 * carries state across sessions).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StorageService } from '../../../src/shared/storage';
import { DEFAULT_PREFERENCES } from '../../../src/shared/constants';

describe('StorageService export options round-trip', () => {
  beforeEach(() => {
    // vitest.setup.ts mocks chrome.storage.sync.get/set as stateless stubs
    // (get always resolves {}). Swap in a real in-memory store so a
    // set() followed by get() actually round-trips, the way
    // chrome.storage.sync does across a real browser restart.
    const store: Record<string, unknown> = {};
    Object.assign(chrome.storage.sync, {
      get: (key: string) => Promise.resolve({ [key]: store[key] }),
      set: (items: Record<string, unknown>) => {
        Object.assign(store, items);
        return Promise.resolve();
      },
    });
  });

  it('round-trips export options', async () => {
    await StorageService.setUserPreferences({ showMetaInfo: false });
    expect((await StorageService.getUserPreferences()).showMetaInfo).toBe(false);

    await StorageService.setUserPreferences({ showMetaInfo: true });
    expect((await StorageService.getUserPreferences()).showMetaInfo).toBe(true);
  });

  it('defaults showMetaInfo to true when nothing has been saved yet', async () => {
    const prefs = await StorageService.getUserPreferences();
    expect(prefs.showMetaInfo).toBe(true);
  });

  it('round-trips the text-size step', async () => {
    await StorageService.setUserPreferences({ fontScale: 'compact' });

    expect((await StorageService.getUserPreferences()).fontScale).toBe('compact');
  });

  it('defaults the text-size step to normal when nothing has been saved yet', async () => {
    expect((await StorageService.getUserPreferences()).fontScale).toBe('normal');
  });
});

describe('R-0: migrating to showMetaInfo', () => {
  /** Seed storage with a preferences object written by an older build. */
  function seed(stored: Record<string, unknown>): void {
    Object.assign(chrome.storage.sync, {
      get: (key: string) => Promise.resolve({ [key]: stored }),
      set: () => Promise.resolve(),
    });
  }

  it('carries a stored includeMetadata forward as showMetaInfo', async () => {
    seed({ includeMetadata: false, includeTimestamps: true, fontScale: 'large' });
    const prefs = await StorageService.getUserPreferences();

    // The header block was the visible half, so it decides.
    expect(prefs.showMetaInfo).toBe(false);
    // Unrelated preferences survive the migration untouched.
    expect(prefs.fontScale).toBe('large');
  });

  it('ignores a stored includeTimestamps, which never rendered anything', async () => {
    // Honouring it would turn a preference the user never saw the effect of into
    // one that now shows a header they had switched off.
    seed({ includeMetadata: false, includeTimestamps: true });
    expect((await StorageService.getUserPreferences()).showMetaInfo).toBe(false);
  });

  it('prefers an already-migrated showMetaInfo over the legacy fields', async () => {
    seed({ showMetaInfo: false, includeMetadata: true });
    expect((await StorageService.getUserPreferences()).showMetaInfo).toBe(false);
  });

  it('falls back to the default when neither is stored', async () => {
    seed({ fontScale: 'compact' });
    expect((await StorageService.getUserPreferences()).showMetaInfo).toBe(
      DEFAULT_PREFERENCES.showMetaInfo
    );
  });
});

describe('P-4: the gear view theme preference', () => {
  beforeEach(() => {
    // A real in-memory store per test -- the previous describe block leaves
    // chrome.storage.sync.set as a no-op (its last seed() stub), which would
    // make every write here silently vanish.
    const store: Record<string, unknown> = {};
    Object.assign(chrome.storage.sync, {
      get: (key: string) => Promise.resolve({ [key]: store[key] }),
      set: (items: Record<string, unknown>) => {
        Object.assign(store, items);
        return Promise.resolve();
      },
    });
  });

  it('round-trips light/dark/auto', async () => {
    await StorageService.setThemePreference('dark');
    expect(await StorageService.getThemePreference()).toBe('dark');

    await StorageService.setThemePreference('light');
    expect(await StorageService.getThemePreference()).toBe('light');
  });

  it('defaults to auto when nothing has been saved yet', async () => {
    expect(await StorageService.getThemePreference()).toBe('auto');
  });

  it('is stored under its own key, separate from user_preferences', async () => {
    await StorageService.setThemePreference('dark');

    expect((await chrome.storage.sync.get('theme_preference')).theme_preference).toBe('dark');
    expect((await chrome.storage.sync.get('user_preferences')).user_preferences).toBeUndefined();
  });
});
