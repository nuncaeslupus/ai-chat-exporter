/**
 * Configuration types for user preferences
 */

/**
 * Filename template variables
 */
export interface FilenameVariables {
  /** Platform name (e.g., "ChatGPT") */
  platform: string;
  /** Conversation title */
  title: string;
  /** Date in YYYY-MM-DD format */
  date: string;
  /** Time in HH-MM format */
  time: string;
  /** Full datetime in YYYY-MM-DD_HH-MM format */
  datetime: string;
  /** Number of question/answer pairs, when the caller knows the conversation */
  pairCount?: string;
  /** Model name if available */
  model?: string;
}

/**
 * A piece of the filename the user composes in the popup.
 *
 * An ordered array, not a template string: the popup edits the pieces
 * directly, so storing a string would mean parsing it back on every open.
 * `text` belongs to `literal` alone — the free-text chip.
 */
export type FilenamePieceType =
  | 'platform'
  | 'model'
  | 'title'
  | 'date'
  | 'time'
  | 'pairCount'
  | 'literal';

export interface FilenamePiece {
  type: FilenamePieceType;
  /** Only meaningful for `literal`. */
  text?: string;
}

/**
 * The filename-shaping half of the user preferences, so the renderer can be
 * handed preferences without `src/core` having to know about the extension's
 * message types.
 *
 * `filenamePieces` is deliberately optional: absent means "never touched the
 * builder", and that case must keep rendering the legacy template string
 * byte for byte.
 */
export interface FilenamePreferences {
  filenameTemplate: string;
  filenamePieces?: FilenamePiece[] | undefined;
}

/**
 * The piece list the builder starts from and `Default` restores. Renders to
 * `{title}_{date}`.
 */
export const DEFAULT_FILENAME_PIECES: FilenamePiece[] = [{ type: 'title' }, { type: 'date' }];

/**
 * Popup-only theme preference. `auto` follows the OS via
 * `prefers-color-scheme`; `light`/`dark` pin the popup to one palette
 * regardless of the OS, via a `data-theme` attribute on the document root
 * (see popup.css). Exported HTML is out of scope -- it keeps its own
 * `prefers-color-scheme` block and adapts to whoever opens the file.
 */
export type ThemePreference = 'light' | 'dark' | 'auto';

/**
 * The locales that ship a `_locales/<code>/messages.json` bundle. Kept in the
 * same order the language picker lists them (alphabetical by native name),
 * which is also the order `tests/unit/extension/locales.test.ts` checks parity
 * in — a bundle added on disk without an entry here is never offered.
 */
export const SUPPORTED_LOCALES = ['ca', 'de', 'en', 'es', 'fr', 'it', 'pt'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * The manifest's `default_locale`, and so the bundle every other one falls
 * back to for a key its translator has not reached yet.
 */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * The language everything the extension writes comes out in: the popup's own
 * screens *and* the exported file (role names, section headings, dates).
 *
 * `auto` is the default and means "whatever the browser is set to" — it keeps
 * `chrome.i18n` in charge, which is the behaviour every install had before this
 * setting existed. Any other value pins the language, which `chrome.i18n`
 * cannot do (`getMessage` always resolves against the browser UI locale), so
 * the override is served from a bundle loaded by hand — see `src/shared/i18n.ts`.
 */
export type LanguagePreference = 'auto' | SupportedLocale;

/**
 * Each language named in itself. A picker that lists `German` to someone who
 * only reads German is the one list that must never be translated, so these
 * are literals here rather than message keys.
 */
export const LOCALE_NATIVE_NAMES: Record<SupportedLocale, string> = {
  ca: 'Català',
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  pt: 'Português',
};

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isLanguagePreference(value: string): value is LanguagePreference {
  return value === 'auto' || isSupportedLocale(value);
}
