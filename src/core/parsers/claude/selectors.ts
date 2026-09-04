/**
 * Claude DOM selectors
 * Captured from claude.ai conversation interface
 */

import type { SelectorSet } from '../../types';

/**
 * Claude-specific CSS selectors for DOM parsing
 */
export const CLAUDE_SELECTORS: SelectorSet = {
  // Main conversation container.
  // claude.ai switched the scroll container from `overflow-y-scroll` to
  // `overflow-y-auto` -- which made `canParse()` return false and stopped the
  // parser from running on the live site at all. Both spellings are kept so
  // the pre-2026 snapshots still resolve (lo-2478).
  // Progressively looser: the exact 2026 chain first (so a healthy page still
  // resolves the same node it always did), then the same node without the
  // spacing/flex utilities, which are the parts that churn, and finally a
  // variant carrying no utility class at all -- the container is whatever div
  // holds the turn wrappers as direct children, which is true regardless of
  // how Tailwind spells the scroll box. `querySelector` returns the first
  // match in document order rather than the first alternative that matches, so
  // the structural variant resolves the same node the class chains do on a
  // healthy page instead of shadowing them.
  conversationContainer:
    'div.overflow-y-auto.overflow-x-hidden.pt-6.flex-1, div.overflow-y-scroll.overflow-x-hidden.pt-6.flex-1, div.overflow-y-auto.overflow-x-hidden.flex-1, div.overflow-y-scroll.overflow-x-hidden.flex-1, div:has(> div[data-test-render-count])',

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
  // `div.font-claude-response` is kept as a second spelling: `data-is-streaming`
  // is a transport-state attribute on the streaming wrapper, so a change to how
  // responses stream can drop it while the response markup itself is untouched.
  // Without a second spelling that leaves every assistant turn unrecognized and
  // every pair unmatched -- the same single-point-of-failure shape that took
  // detection down twice (lo-2478).
  assistantMessage: 'div[data-is-streaming="false"], div.font-claude-response',

  // Content within messages
  messageContent:
    'p.whitespace-pre-wrap.break-words, div.standard-markdown, div.progressive-markdown',

  // Conversation title
  conversationTitle: 'button[data-testid="chat-title-button"] div.truncate',

  // Model indicator.
  // The inner `div.whitespace-nowrap` is gone from the 2026 markup (probed
  // live 2026-09-03: zero matches), so `getModel()` returned null and no
  // export carried a model at all. The button itself keeps the semantic
  // `data-testid` and its whole text is the model name ("Opus 5 High"), so
  // read the button. The old inner-div spelling is not kept as a fallback:
  // `querySelector` returns the first match in *document order*, and the
  // button is that div's ancestor, so the div could never win anyway.
  modelIndicator: 'button[data-testid="model-selector-dropdown"]',

  // Custom selectors for Claude-specific elements
  custom: {
    // Per-turn wrapper: every turn (user or assistant) gets one of these;
    // it survives even when a redesign guts the turn's inner content.
    turnContainer: 'div[data-test-render-count]',
    // User turn's inner wrapper -- what tells a user turn apart from an
    // assistant one in `extractQAPairs`.
    //
    // Probed live on claude.ai 2026-09-03: BOTH previous spellings match zero
    // nodes. `div.mb-1.mt-6.group` went with the 2026 redesign, and
    // `data-user-message-bubble` -- which the previous comment here claimed
    // had replaced it -- is not in the DOM either. With every alternative
    // dead, `isUserTurn` was false for every turn, so each user turn fell
    // through to the assistant check, failed that too, and was dropped as
    // "neither role recognized"; its answer was then dropped as an orphan.
    // Every conversation parsed to zero pairs, silently, because
    // `collectWarnings` only walks pairs that already exist.
    //
    // `data-testid="user-message"` is the hook that actually survives, and it
    // leads for that reason. It is the same node `userMessage` above resolves,
    // which is fine: role detection only asks whether the turn contains a user
    // bubble at all. The two dead spellings are kept so pre-2026 snapshots
    // still resolve -- but a selector list is only as live as its first
    // matching member, so measure them against the live page before trusting
    // any of them again (lo-2478, lo-d0f0).
    userTurnWrapper:
      '[data-testid="user-message"], [data-user-message-bubble], div.mb-1.mt-6.group',

    // Detection signals: any one of these means "this claude.ai page is
    // showing a conversation". canParse() ORs them instead of requiring the
    // `conversationContainer` utility-class chain, which is a pure layout
    // selector (`pt-6 flex-1`) that claude.ai rewrites on any spacing tweak.
    // Twice now that chain has gone stale and taken *all* detection with it
    // (lo-2478 -- overflow-y-scroll -> overflow-y-auto), because a failed
    // canParse() reports "no conversation found" rather than a parse warning.
    // These are attribute hooks and semantic classes: they change when the
    // turn markup changes, not when the padding does.
    conversationSignals:
      'div[data-test-render-count], div[data-testid="user-message"], [data-user-message-bubble], div[data-is-streaming], div.standard-markdown, div.progressive-markdown, div.font-claude-response',

    // User message specific selectors
    userMessageContent: 'div[data-testid="user-message"] p.whitespace-pre-wrap',
    userUploadedImages: 'div.relative.group\\/thumbnail img',
    userImageContainer: 'div.relative.group\\/thumbnail',

    // Assistant message specific selectors
    assistantMessageContent: 'div.standard-markdown, div.progressive-markdown',

    // Artifacts/Canvases selectors.
    // The cell is matched on its own, NOT via a wrapper class: claude.ai's
    // 2026 markup wraps it in `div.group/artifact-block` inside
    // `div.flex.flex-col.gap-2.py-2.pl-2`, and the `div.pt-3.pb-3` wrapper
    // this used to require is gone -- which silently dropped every artifact
    // from every export (lo-2478). `div.artifact-block-cell` is the one class
    // both the old and the current markup agree on.
    artifactContainer: 'div.artifact-block-cell',
    artifactTitle: 'div.leading-tight.text-sm.line-clamp-1',
    artifactType: 'div.text-xs.line-clamp-1.text-text-400',

    // Open artifact side panel. It renders OUTSIDE the turn containers
    // extractQAPairs walks, so it is looked up at document level and matched
    // back to its artifact block by title -- the same shape as Gemini's Deep
    // Research panel, which was dropped silently for exactly this reason.
    artifactPanel: 'div[data-skill-file-viewer]',
    artifactPanelTitle: 'h2[title]',
    artifactPanelBody: 'div.standard-markdown',

    // Web search selectors
    webSearchContainer: 'div.ease-out.transition-all.flex.flex-col.font-ui.leading-normal',
    webSearchButton: 'button.group\\/row',
    webSearchQuery: '.flex.gap-2.relative.font-base.text-left',
    webSearchResultCount: 'p.relative.bottom-\\[0\\.5px\\].pl-1.text-text-500',
    webSearchResults: 'div.flex.flex-nowrap.p-2.pt-0.flex-col a',
    webSearchResultTitle: 'p.relative.text-\\[0\\.875rem\\]',
    webSearchResultDomain: 'p.relative.bottom-\\[1px\\].text-\\[0\\.75rem\\].text-text-500',
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
