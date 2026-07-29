/**
 * Internationalization (i18n) utility functions
 * Wraps chrome.i18n API for easier use throughout the extension
 */

/**
 * Check if chrome.i18n is available (not available in test environment)
 */
function isI18nAvailable(): boolean {
  return (
    typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function'
  );
}

/**
 * Get a localized message by key
 * @param key - Message key from messages.json
 * @param substitutions - Optional substitution values
 * @returns Localized message string
 */
export function getMessage(key: string, substitutions?: string | string[]): string {
  if (!isI18nAvailable()) {
    // Fallback for test environment - return the key itself
    return key;
  }
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/**
 * Get the current UI language (e.g., 'en', 'es', 'fr')
 * @returns Language code
 */
export function getUILanguage(): string {
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
