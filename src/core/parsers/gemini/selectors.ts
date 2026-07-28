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
 * Deep Research selectors.
 *
 * A Deep Research turn renders its report OUTSIDE the `.conversation-container`
 * that holds the question: `chat-window` gets a sibling
 * `immersive-panel > deep-research-immersive-panel`, and the chat turn keeps
 * only a one-line "I've completed your research" plus an
 * `immersive-entry-chip` pointing at that panel. Iterating containers alone
 * therefore drops the entire report — see docs/dev/parser-gotchas.md.
 *
 * Kept out of `GEMINI_SELECTORS.custom` on purpose: these only exist on a page
 * with an open Deep Research panel, so the general selector-liveness guard must
 * not require them to match every capture.
 *
 * Verified against tests/fixtures/dom-snapshots/gemini/deep-research-2026-07.html
 * (live capture, 2026-07-28).
 */
export const GEMINI_DEEP_RESEARCH_SELECTORS = {
  panel: 'deep-research-immersive-panel',
  /** Report title in the panel toolbar; also the chip's `.card-title`. */
  title: '.title-text',
  /** The report body. Same shape as an in-chat answer, hence the same selector. */
  body: 'message-content .markdown',
  /**
   * Only the sources the report actually cited. The panel also lists
   * `.unused-sources` (read but not cited) — 144 of them in the capture against
   * 55 used, which is noise in an export.
   */
  source: '.source-list.used-sources browse-web-item',
  sourceUrl: 'a[data-test-id="browse-web-item-link"]',
  sourceDomain: '[data-test-id="domain-name"]',
  sourceTitle: '[data-test-id="sub-title"]',
  /** The in-chat pointer at the panel; identifies which turn owns the report. */
  entryChip: 'immersive-entry-chip',
} as const;

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
