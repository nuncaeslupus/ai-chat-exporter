/**
 * ChatGPT DOM selectors
 * Based on real DOM capture from 2026-01-01
 */

import type { SelectorSet } from '../../types';

/**
 * ChatGPT-specific CSS selectors for DOM parsing
 */
// `satisfies` rather than `: SelectorSet` on purpose: it still checks the shape,
// but keeps `custom`'s keys known so the parser can read `selectors.custom.foo`
// without a `?? '<literal>'` fallback. Those fallbacks were a second copy of
// every selector living in parser.ts -- exactly the drift this file exists to
// prevent (docs/dev/parser-gotchas.md #2).
export const CHATGPT_SELECTORS = {
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
    // Conversation turn containers (tag-agnostic: ChatGPT moved the turn
    // wrapper from <article> to <section> in 2026-07; data-testid survived)
    conversationTurn: '[data-testid^="conversation-turn-"]',
    // User turn specifically (tag-agnostic, see above)
    userTurn: '[data-turn="user"]',
    // Assistant turn specifically (tag-agnostic, see above)
    assistantTurn: '[data-turn="assistant"]',
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
    // Code artifact language label (legacy markup, pre-CodeMirror)
    codeArtifactLanguage: 'div.h-9',
    // Code artifact content (legacy markup, pre-CodeMirror)
    codeArtifactContent: 'code.whitespace-pre\\!, code[class*="language-"]',
    // Code artifact sticky header (CodeMirror 6 viewer, 2026-07+): holds the
    // language name as plain text next to an icon, alongside Copy/Run buttons
    codeArtifactStickyHeader: '.sticky',
    // Code artifact content (CodeMirror 6 viewer, 2026-07+): <code> has no
    // class at all, so scope to the editor's own content pre specifically
    codeArtifactCodeMirrorCode: '.cm-content code, #code-block-viewer code',
    // Web citation pill container
    citationPill: '[data-testid="webpage-citation-pill"]',
    // Web citation link
    citationLink: '[data-testid="webpage-citation-pill"] a',
    // Sidebar title fallbacks, tried in order after `conversationTitle`
    conversationTitleFallback:
      'a[data-active="true"] .truncate span, nav a[href*="/c/"] .truncate span',
    // Title text inside a sidebar conversation link (the link itself is matched
    // by href, built from the conversation id in the URL)
    conversationTitleText: '.truncate span',
    // Canvas / textdoc turn container
    canvasContainer: '[id^="textdoc-message-"]',
    // Canvas editable content, inside the canvas container
    canvasContent: '.ProseMirror, .prose',
    // Generated-image turn container
    generatedImageContainer: '.group\\/imagegen-image, [class*="imagegen"]',
    // Title of a generated-image turn, in the turn header
    generatedImageTitle: '.message-role, [class*="font-medium"]',
    // Deep-research summary button ("Research completed in 6m · 18 sources ·")
    deepResearchButton: 'button[class*="text-token-text-tertiary"]',
    // Widget rendered in a cross-origin sandboxed frame instead of in the page
    // (Deep Research is `internal://deep-research`). The title names the widget.
    embeddedWidgetFrame: 'iframe[title^="internal://"]',
  },
} satisfies SelectorSet;

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
