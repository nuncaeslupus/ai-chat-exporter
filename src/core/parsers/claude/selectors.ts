/**
 * Claude DOM selectors (PLACEHOLDER)
 * TODO: Capture real DOM from claude.ai and update selectors
 */

import type { SelectorSet } from '../../types';

/**
 * Claude-specific CSS selectors for DOM parsing
 * NOTE: These are placeholders and need to be updated with real selectors
 */
export const CLAUDE_SELECTORS: SelectorSet = {
  // Main conversation container
  conversationContainer: 'main',

  // Individual message elements (both user and assistant)
  messageElement: '[data-message], .message',

  // User messages specifically
  userMessage: '[data-sender="user"], .user-message',

  // Assistant messages specifically
  assistantMessage: '[data-sender="assistant"], .assistant-message',

  // Content within messages
  messageContent: '.message-content, .prose',

  // Conversation title
  conversationTitle: 'header h1, .conversation-title',

  // Model indicator
  modelIndicator: '[data-model], .model-indicator',

  // Custom selectors for Claude-specific elements
  custom: {
    // Button injection area (near header)
    buttonArea: 'main header, main > div:first-child',
  },
};

/**
 * Claude URL patterns for detection
 */
export const CLAUDE_URL_PATTERNS = [/^https?:\/\/(www\.)?claude\.ai/];

/**
 * Check if a URL matches Claude
 */
export function isClaudeUrl(url: string): boolean {
  return CLAUDE_URL_PATTERNS.some((pattern) => pattern.test(url));
}
