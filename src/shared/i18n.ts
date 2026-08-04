/**
 * Internationalization (i18n) utility functions
 *
 * Wraps the chrome.i18n API, and adds the one thing it cannot do: serve a
 * language other than the browser's. `chrome.i18n.getMessage` always resolves
 * against the browser UI locale and takes no locale argument, so the language
 * setting (`LanguagePreference`) is honoured by loading the chosen
 * `_locales/<code>/messages.json` by hand and answering from it first.
 *
 * Lookups stay synchronous — hundreds of call sites across the popup, the
 * exporters and the content script depend on that — so the bundle is loaded
 * once up front by `applyLanguagePreference()` and cached. Until that resolves
 * (or when the preference is `auto`), every lookup falls through to
 * chrome.i18n exactly as before.
 */

import {
  DEFAULT_LOCALE,
  type LanguagePreference,
  type SupportedLocale,
} from '../core/types/config';

/** One entry of a `_locales/<code>/messages.json` bundle. */
interface LocaleMessage {
  message: string;
}

type LocaleBundle = Record<string, LocaleMessage>;

/**
 * The pinned language, and the bundles backing it. `en` is loaded alongside
 * any other override for the same reason Chrome falls back to `default_locale`:
 * a key a translator has not reached yet must render as English, never as its
 * raw key.
 */
let overrideLocale: SupportedLocale | null = null;
let overrideBundle: LocaleBundle | null = null;
let fallbackBundle: LocaleBundle | null = null;

/**
 * Check if chrome.i18n is available (not available in test environment)
 */
function isI18nAvailable(): boolean {
  return (
    typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function'
  );
}

/** `chrome.runtime.getURL` is absent in tests and in a plain page context. */
function localeUrl(locale: SupportedLocale): string | null {
  if (typeof chrome === 'undefined' || typeof chrome.runtime?.getURL !== 'function') return null;
  return chrome.runtime.getURL(`_locales/${locale}/messages.json`);
}

async function loadBundle(locale: SupportedLocale): Promise<LocaleBundle | null> {
  const url = localeUrl(locale);
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as LocaleBundle;
  } catch (error) {
    console.error(`Failed to load the ${locale} message bundle:`, error);
    return null;
  }
}

/**
 * Point every later `getMessage()` at `preference`.
 *
 * Call once per context before rendering anything: the popup on open and after
 * the setting changes, the content script before it exports (that is where the
 * exporters run, so it is what decides the language of the file on disk).
 *
 * Failure is not fatal and not sticky — if the bundle cannot be read the
 * override is dropped and lookups go back to chrome.i18n, which is the
 * browser's language. A missing translation is worth degrading over; a popup
 * full of raw message keys is not.
 */
export async function applyLanguagePreference(preference: LanguagePreference): Promise<void> {
  if (preference === 'auto') {
    overrideLocale = null;
    overrideBundle = null;
    fallbackBundle = null;
    return;
  }

  const [chosen, fallback] = await Promise.all([
    loadBundle(preference),
    preference === DEFAULT_LOCALE ? Promise.resolve(null) : loadBundle(DEFAULT_LOCALE),
  ]);

  if (!chosen) {
    overrideLocale = null;
    overrideBundle = null;
    fallbackBundle = null;
    return;
  }

  overrideLocale = preference;
  overrideBundle = chosen;
  fallbackBundle = fallback;
}

/** Test seam: drop any loaded override so a case starts from `auto`. */
export function resetLanguageOverride(): void {
  overrideLocale = null;
  overrideBundle = null;
  fallbackBundle = null;
}

/**
 * Apply `$1`…`$9` and `$$`, which is all the bundles use.
 *
 * chrome.i18n also resolves named `$placeholder$` tokens through the entry's
 * `placeholders` block; no message here writes one (they all use `$n` directly,
 * with `placeholders` carrying only the translator's `example`), and the
 * locale suite pins `$n` parity across bundles, so positional is the whole
 * grammar to support.
 */
function substitute(message: string, substitutions?: string | string[]): string {
  const values = substitutions === undefined ? [] : [substitutions].flat();
  return message.replace(/\$(\$|[1-9])/g, (match, token: string) =>
    token === '$' ? '$' : (values[Number(token) - 1] ?? match)
  );
}

/**
 * Non-empty text for `key` in one bundle. A declared-but-blank `message` counts
 * as absent — it renders as nothing on screen, so it has to fall through to the
 * next bundle rather than end the search.
 */
function bundleMessage(bundle: LocaleBundle | null, key: string): string | null {
  const message = bundle?.[key]?.message;
  return message ? message : null;
}

/** The pinned language's text for `key`, or English, or nothing. */
function overrideMessage(key: string): string | null {
  return bundleMessage(overrideBundle, key) ?? bundleMessage(fallbackBundle, key);
}

/**
 * Get a localized message by key
 * @param key - Message key from messages.json
 * @param substitutions - Optional substitution values
 * @returns Localized message string
 */
export function getMessage(key: string, substitutions?: string | string[]): string {
  const pinned = overrideMessage(key);
  if (pinned !== null) return substitute(pinned, substitutions);

  if (!isI18nAvailable()) {
    // Fallback for test environment - return the key itself
    return key;
  }
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/**
 * Get the current UI language (e.g., 'en', 'es', 'fr')
 *
 * Follows the language setting when one is pinned, so the dates and numbers
 * formatted off it (`formatNumber`, the exporters' `toLocaleDateString`) come
 * out in the same language as the words around them.
 *
 * @returns Language code
 */
export function getUILanguage(): string {
  if (overrideLocale) return overrideLocale;
  if (!isI18nAvailable()) {
    return 'en';
  }
  return chrome.i18n.getUILanguage();
}

/**
 * Get a localized message with numeric substitution
 * Useful for messages with multiple placeholders
 * @param key - Message key from messages.json
 * @param values - Array of values to substitute
 * @returns Localized message string
 */
export function getMessageWithValues(key: string, ...values: (string | number)[]): string {
  const stringValues = values.map((v) => String(v));
  return getMessage(key, stringValues);
}

/**
 * Format a number with locale-specific formatting
 * @param num - Number to format
 * @returns Formatted number string
 */
export function formatNumber(num: number): string {
  const locale = getUILanguage();
  return num.toLocaleString(locale);
}

/**
 * Vendors capitalize their own names, and the message keys follow them:
 * `platformChatGPT`, `roleChatGPT`. Capitalizing the id `chatgpt` yields
 * `Chatgpt`, which matches no declared key — so the name is stated here rather
 * than derived. Ids that capitalize regularly need no entry.
 */
const DISPLAY_NAMES: Record<string, string> = {
  chatgpt: 'ChatGPT',
};

/**
 * Display name for a platform or role id — `chatgpt` → `ChatGPT`, `user` → `User`.
 * Doubles as the suffix of the message key and as the fallback when no bundle
 * declares that key.
 */
export function displayName(id: string): string {
  return DISPLAY_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Get platform name in current language
 * @param platformId - Platform identifier (chatgpt, claude, gemini, etc.)
 * @returns Localized platform name, or the display name when undeclared
 */
export function getPlatformName(platformId: string): string {
  const name = displayName(platformId);
  const message = getMessage(`platform${name}`);
  return message === `platform${name}` ? name : message;
}

/**
 * Get role name in current language
 * @param role - Role identifier (user, assistant, chatgpt, claude, gemini)
 * @returns Localized role name, or the display name when undeclared
 */
export function getRoleName(role: string): string {
  const name = displayName(role);
  const message = getMessage(`role${name}`);
  return message === `role${name}` ? name : message;
}
