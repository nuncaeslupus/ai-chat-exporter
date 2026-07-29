/**
 * Claude DOM selectors
 * Captured from claude.ai conversation interface
 */

import type { SelectorSet } from '../../types';

/**
 * Claude-specific CSS selectors for DOM parsing
 */
export const CLAUDE_SELECTORS: SelectorSet = {
  // Main conversation container
  conversationContainer: 'div.overflow-y-scroll.overflow-x-hidden.pt-6.flex-1',

  // Individual message elements (both user and assistant)
  // Every turn (user or assistant) is wrapped in div[data-test-render-count];
  // div.mb-1.mt-6.group is nested inside that wrapper for user turns only.
  messageElement: 'div[data-test-render-count], div.mb-1.mt-6.group',

  // User messages specifically
  userMessage: 'div[data-testid="user-message"]',

  // Assistant messages specifically. Used by the parser to tell a turn's
  // role apart (alongside custom.userTurnWrapper for the user side) when
  // pairing turns structurally -- previously declared here but never read
  // by parser.ts, which hardcoded this same selector inline instead (lo-d0f0).
  assistantMessage: 'div[data-is-streaming="false"]',

  // Content within messages
  messageContent:
    'p.whitespace-pre-wrap.break-words, div.standard-markdown, div.progressive-markdown',

  // Conversation title
  conversationTitle: 'button[data-testid="chat-title-button"] div.truncate',

  // Model indicator
  modelIndicator: 'button[data-testid="model-selector-dropdown"] div.whitespace-nowrap',

  // Custom selectors for Claude-specific elements
  custom: {
    // Button injection area (page header)
    buttonArea: 'header[data-testid="page-header"] div.right-3.flex.gap-2',

    // Per-turn wrapper: every turn (user or assistant) gets one of these;
    // it survives even when a redesign guts the turn's inner content.
    turnContainer: 'div[data-test-render-count]',
    // User turn's inner wrapper -- present for every user turn regardless of
    // whether data-testid="user-message" survives inside it (lo-d0f0).
    userTurnWrapper: 'div.mb-1.mt-6.group',

    // User message specific selectors
    userMessageContent: 'div[data-testid="user-message"] p.whitespace-pre-wrap',
    userUploadedImages: 'div.relative.group\\/thumbnail img',
    userImageContainer: 'div.relative.group\\/thumbnail',

    // Assistant message specific selectors
    assistantMessageContent: 'div.standard-markdown, div.progressive-markdown',
    assistantResponseBody: 'p.font-claude-response-body',

    // Artifacts/Canvases selectors
    artifactContainer: 'div.pt-3.pb-3 div.artifact-block-cell',
    artifactTitle: 'div.leading-tight.text-sm.line-clamp-1',
    artifactType: 'div.text-xs.line-clamp-1.text-text-400',

    // Web search selectors
    webSearchContainer: 'div.ease-out.transition-all.flex.flex-col.font-ui.leading-normal',
    webSearchButton: 'button.group\\/row',
    webSearchQuery: '.flex.gap-2.relative.font-base.text-left',
    webSearchResultCount: 'p.relative.bottom-\\[0\\.5px\\].pl-1.text-text-500',
    webSearchResults: 'div.flex.flex-nowrap.p-2.pt-0.flex-col a',
    webSearchResultTitle: 'p.relative.text-\\[0\\.875rem\\]',
    webSearchResultDomain: 'p.relative.bottom-\\[1px\\].text-\\[0\\.75rem\\].text-text-500',

    // Timestamp
    timestamp: 'span.text-text-500.text-xs',

    // Message actions (to exclude)
    messageActions: 'div[role="group"][aria-label="Message actions"]',
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
