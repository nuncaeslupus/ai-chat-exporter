/**
 * Gemini DOM selectors
 *
 * Verified against a live capture of gemini.google.com (2026-01-17); the
 * trimmed copy lives at tests/fixtures/dom-snapshots/gemini/real-capture.html.
 * Gemini is an Angular app, so its custom element names (`chat-window`,
 * `user-query-content`, `message-content`) are the durable identity here —
 * every `ng-*` class is build-generated and must never be selected on.
 */

import type { SelectorSet } from '../../types';

/**
 * Gemini-specific CSS selectors for DOM parsing
 */
export const GEMINI_SELECTORS: SelectorSet = {
  conversationContainer: 'chat-window',
  messageElement: '.conversation-container',
  userMessage: 'user-query-content',
  assistantMessage: 'model-response',
  // The answer body only. `model-response` also wraps the thinking panel,
  // sources and the action bar, none of which belong in an export.
  messageContent: 'message-content .markdown',
  conversationTitle: '.conversation-title-container .conversation-title',
  // The sidebar carries a `.conversation-title` per conversation in the
  // account, so the title selector must stay scoped to the top bar.
  modelIndicator: '[data-test-id="bard-mode-switcher"] [data-test-id="bard-text"]',
  custom: {
    buttonArea: '.top-bar-actions .right-section, .top-bar-actions',
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
