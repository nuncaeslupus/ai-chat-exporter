/**
 * ChatGPT DOM selectors
 * Last live survey: chatgpt.com, 2026-11-13 (the 2026-11 app-shell rebuild)
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
// 2026-11: chatgpt.com shipped an app-shell rebuild that dropped EVERY hook
// below -- `data-message-author-role`, `data-turn`, `data-testid^=
// "conversation-turn-"`, `.markdown.prose`, `data-message-model-slug`. The new
// spelling comes first in each list, the pre-rebuild one stays second so the
// DOM snapshots in tests/fixtures/dom-snapshots/chatgpt/ keep parsing
// (docs/dev/parser-gotchas.md #1, last rule: keep two spellings per load-bearing
// hook; #17 covers this rebuild in full).
export const CHATGPT_SELECTORS = {
  // Main conversation container (`main#main`'s id is React-generated and gone;
  // bare `main` resolves the same node on both markups)
  conversationContainer: 'main',

  // Individual message elements (both user and assistant)
  messageElement: '[data-content-search-unit-key], [data-message-author-role]',

  // User messages specifically
  userMessage: '[data-user-message-bubble], [data-message-author-role="user"]',

  // Assistant messages specifically
  assistantMessage: '[data-chatgpt-selection-message-id], [data-message-author-role="assistant"]',

  // Content within messages - assistant uses markdown, user uses whitespace-pre-wrap
  messageContent: '[data-markdown-text-style], .markdown.prose, .whitespace-pre-wrap',

  // Conversation title in sidebar (active conversation)
  conversationTitle: 'a[data-active=""] .truncate span',

  // Model indicator (attribute on assistant messages). The 2026-11 app shell
  // exposes no model attribute at all, so this is pre-rebuild only and
  // `getModel()` returns null on the new markup -- an absent field, not a
  // wrong one. Optional, so selector-health never calls it drift.
  modelIndicator: '[data-message-model-slug]',

  // Custom selectors for ChatGPT-specific elements
  custom: {
    // Conversation turn containers (tag-agnostic: ChatGPT moved the turn
    // wrapper from <article> to <section> in 2026-07; data-testid survived)
    conversationTurn: '[data-turn-key], [data-testid^="conversation-turn-"]',
    // User turn specifically. The 2026-11 shell puts the role in the unit
    // key's own value (`<turn>:<index>:<role>`), which is why this matches on
    // a suffix rather than on a nearby role element: the `h4
    // [data-conversation-role="user"]` label is a *sibling* of the user unit,
    // not an ancestor or child of it, so `:has()` cannot reach it.
    userTurn: '[data-content-search-unit-key$=":user"], [data-turn="user"]',
    // Assistant turn specifically (see above)
    assistantTurn: '[data-content-search-unit-key$=":assistant"], [data-turn="assistant"]',
    // User message content specifically
    userMessageContent:
      '[data-user-message-bubble] .whitespace-pre-wrap, .user-message-bubble-color .whitespace-pre-wrap',
    // Assistant message content specifically
    assistantMessageContent: '[data-markdown-text-style], .markdown.prose',
    // Message ID attribute. ponytail: pre-rebuild spelling only. The 2026-11
    // shell moved the id to `data-chatgpt-selection-message-id` on a node
    // *inside* the turn, and every read site already falls back to
    // `generateId()`; no consumer reads the page's own id back, so chasing it
    // through a descendant lookup would buy nothing. Add that lookup if an
    // exporter ever needs ids stable across re-exports.
    messageIdAttr: 'data-message-id',
    // Model slug attribute
    modelSlugAttr: 'data-message-model-slug',
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
    // Web citation pill container. Pre-rebuild spelling only, deliberately:
    // the 2026-11 shell exposes no citation hook at all. `[data-dil-response]
    // a[href^="http"]` looked like one and is NOT -- measured live on
    // 2026-11-13, that block's anchors are the ordinary inline markdown links
    // of the answer body ("Ver oferta y presentar candidatura"), so matching
    // them would publish every inline link as a cited source in all six
    // exporters, and would also drop any linked inline image via the
    // image-exclusion list below. An absent Sources list beats a fabricated
    // one; restore this when a real citation hook is found on a live page.
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
 * Attribute the page's content script stashes a Deep Research iframe's own
 * relayed report text on, once the sandboxed frame's copy of the content
 * script posts it out over `postMessage` (lo-9001). Absent -> the frame could
 * not be read for any reason, and the parser falls back to naming the widget
 * instead of guessing at its content.
 */
export const EMBEDDED_FRAME_REPORT_ATTR = 'data-ai-chat-exporter-report-text';

/**
 * Same as `EMBEDDED_FRAME_REPORT_ATTR`, but for the sanitized-HTML relay
 * (D-31/D-33) -- preferred when present, since it carries the report's
 * headings, lists and tables through the structure-parsing path instead of a
 * flattened string. Falls back to `EMBEDDED_FRAME_REPORT_ATTR` when the relay
 * could only manage flattened text (HTML path failed, came back over its
 * sanity bound, or lost too much substance; see deep-research-frame.ts's
 * `relay()`).
 */
export const EMBEDDED_FRAME_REPORT_HTML_ATTR = 'data-ai-chat-exporter-report-html';

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
