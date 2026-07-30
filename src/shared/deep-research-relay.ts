/**
 * Wire format for the message a Deep Research / connector-widget sandboxed
 * iframe (`*.web-sandbox.oaiusercontent.com`) posts to its parent page with
 * the report text it rendered.
 *
 * `window.postMessage`, not `chrome.runtime.sendMessage`: the frame's
 * `sandbox="allow-scripts allow-same-origin allow-forms"` keeps its own
 * origin, so a content script can run inside it (lo-9001), but that frame
 * has no channel to the parent page's content script other than the one the
 * DOM already gives any iframe.
 */

/**
 * Origin pattern for the sandboxed connector-widget host. Scoped to the
 * `web-sandbox` subdomain specifically -- not all of `oaiusercontent.com`,
 * which also serves user file uploads -- so a message claiming to be a
 * report from a different `oaiusercontent.com` subdomain is rejected.
 */
export const DEEP_RESEARCH_FRAME_ORIGIN_RE =
  /^https:\/\/[a-z0-9-]+\.web-sandbox\.oaiusercontent\.com$/;

const DEEP_RESEARCH_MESSAGE_TYPE = 'ai-chat-exporter:deep-research-report';

/**
 * `html` is sanitized markup (structure intact -- headings, lists, tables);
 * `text` is the flattened fallback used when the HTML path failed or came
 * back too large (see deep-research-frame.ts's `relay()`). Never both --
 * exactly one of the two carries the captured content.
 */
export interface DeepResearchFrameMessage {
  type: typeof DEEP_RESEARCH_MESSAGE_TYPE;
  html?: string;
  text?: string;
}

export function createDeepResearchFrameMessage(
  content: { html: string } | { text: string }
): DeepResearchFrameMessage {
  return { type: DEEP_RESEARCH_MESSAGE_TYPE, ...content };
}

export function isDeepResearchFrameMessage(data: unknown): data is DeepResearchFrameMessage {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const candidate = data as { type?: unknown; html?: unknown; text?: unknown };
  if (candidate.type !== DEEP_RESEARCH_MESSAGE_TYPE) {
    return false;
  }
  return typeof candidate.html === 'string' || typeof candidate.text === 'string';
}
