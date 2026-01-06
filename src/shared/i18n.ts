/**
 * Internationalization (i18n) utility functions
 * Wraps chrome.i18n API for easier use throughout the extension
 */

/**
 * Check if chrome.i18n is available (not available in test environment)
 */
function isI18nAvailable(): boolean {
  return typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function';
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
  const stringValues = values.map(v => String(v));
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
 * Get platform name in current language
 * @param platformId - Platform identifier (chatgpt, claude, gemini, etc.)
 * @returns Localized platform name
 */
export function getPlatformName(platformId: string): string {
  const key = `platform${platformId.charAt(0).toUpperCase()}${platformId.slice(1)}`;
  const message = getMessage(key);

  // If no i18n available or no translation found, return formatted platform ID
  if (!isI18nAvailable() || message === key) {
    // Handle special cases
    if (platformId === 'chatgpt') return 'ChatGPT';
    if (platformId === 'claude') return 'Claude';
    if (platformId === 'gemini') return 'Gemini';
    // Default: capitalize first letter
    return platformId.charAt(0).toUpperCase() + platformId.slice(1);
  }

  return message;
}

/**
 * Get role name in current language
 * @param role - Role identifier (user, assistant, chatgpt, claude, gemini)
 * @returns Localized role name
 */
export function getRoleName(role: string): string {
  const key = `role${role.charAt(0).toUpperCase()}${role.slice(1)}`;
  const message = getMessage(key);

  // If no i18n available or no translation found, return formatted role name
  if (!isI18nAvailable() || message === key) {
    // Handle special cases
    if (role === 'chatgpt') return 'ChatGPT';
    if (role === 'claude') return 'Claude';
    if (role === 'gemini') return 'Gemini';
    if (role === 'user') return 'User';
    if (role === 'assistant') return 'Assistant';
    // Default: capitalize first letter
    return role.charAt(0).toUpperCase() + role.slice(1);
  }

  return message;
}
