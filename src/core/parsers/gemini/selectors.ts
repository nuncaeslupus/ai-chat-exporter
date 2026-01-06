/**
 * Gemini DOM selectors (PLACEHOLDER)
 * TODO: Capture real DOM from gemini.google.com and update selectors
 */

import type { SelectorSet } from '../../types';

/**
 * Gemini-specific CSS selectors for DOM parsing
 * NOTE: These are placeholders and need to be updated with real selectors
 */
export const GEMINI_SELECTORS: SelectorSet = {
  conversationContainer: 'main',
  messageElement: '.message',
  userMessage: '.user-message',
  assistantMessage: '.assistant-message',
  messageContent: '.message-content',
  conversationTitle: 'header h1',
  modelIndicator: '.model-indicator',
  custom: {
    buttonArea: 'main header',
  },
};

/**
 * Gemini URL patterns for detection
 */
export const GEMINI_URL_PATTERNS = [/^https?:\/\/(www\.)?gemini\.google\.com/];

/**
 * Check if a URL matches Gemini
 */
export function isGeminiUrl(url: string): boolean {
  return GEMINI_URL_PATTERNS.some((pattern) => pattern.test(url));
}
