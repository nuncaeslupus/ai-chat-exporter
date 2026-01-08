/**
 * ChatGPT DOM selectors
 * Based on real DOM capture from 2026-01-01
 */

import type { SelectorSet } from '../../types';

/**
 * ChatGPT-specific CSS selectors for DOM parsing
 */
export const CHATGPT_SELECTORS: SelectorSet = {
  // Main conversation container
  conversationContainer: 'main#main',

  // Individual message elements (both user and assistant)
  messageElement: '[data-message-author-role]',

  // User messages specifically
  userMessage: '[data-message-author-role="user"]',

  // Assistant messages specifically
  assistantMessage: '[data-message-author-role="assistant"]',

  // Content within messages - assistant uses markdown, user uses whitespace-pre-wrap
  messageContent: '.markdown.prose, .whitespace-pre-wrap',

  // Conversation title in sidebar (active conversation)
  conversationTitle: 'a[data-active=""] .truncate span',

  // Model indicator (attribute on assistant messages)
  modelIndicator: '[data-message-model-slug]',

  // Custom selectors for ChatGPT-specific elements
  custom: {
    // Conversation turn containers
    conversationTurn: 'article[data-testid^="conversation-turn-"]',
    // User turn specifically
    userTurn: 'article[data-turn="user"]',
    // Assistant turn specifically
    assistantTurn: 'article[data-turn="assistant"]',
    // User message content specifically
    userMessageContent: '.user-message-bubble-color .whitespace-pre-wrap',
    // Assistant message content specifically
    assistantMessageContent: '.markdown.prose',
    // Message ID attribute
    messageIdAttr: 'data-message-id',
    // Model slug attribute
    modelSlugAttr: 'data-message-model-slug',
    // Button injection area (near header)
    buttonArea: 'main header, main > div:first-child',
    // Code artifact container (escape ! in class name)
    codeArtifactContainer: 'pre.overflow-visible\\!',
    // Code artifact language label
    codeArtifactLanguage: 'div.h-9',
    // Code artifact content
    codeArtifactContent: 'code.whitespace-pre\\!, code[class*="language-"]',
    // Web citation pill container
    citationPill: '[data-testid="webpage-citation-pill"]',
    // Web citation link
    citationLink: '[data-testid="webpage-citation-pill"] a',
  },
};

/**
 * ChatGPT URL patterns for detection
 */
export const CHATGPT_URL_PATTERNS = [
  /^https?:\/\/(www\.)?chat\.openai\.com/,
  /^https?:\/\/(www\.)?chatgpt\.com/,
];

/**
 * Check if a URL matches ChatGPT
 */
export function isChatGPTUrl(url: string): boolean {
  return CHATGPT_URL_PATTERNS.some((pattern) => pattern.test(url));
}
