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
 * `text` is the flattened fallback used when the HTML path failed, came back
 * too large, or captured materially less substance than the text tier would
 * have (see deep-research-frame.ts's `relay()`). Never both -- exactly one of
 * the two carries the captured content.
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

/**
 * Parent origins the sandboxed relay is allowed to deliver a report to -- the
 * ChatGPT hosts the manifest already declares content scripts for. Posting a
 * report to `'*'` would hand it to whatever origin happens to own
 * `window.parent`, which the frame cannot verify from inside a cross-origin
 * sandbox (it can't read `window.parent.location.origin` to check). Scoping
 * the target origin is one-way hardening against that: it protects the report
 * from an unexpected embedder, the opposite direction from the origin check
 * `content-script.ts` already does on the *receiving* end (SEC-3).
 */
export const CHATGPT_PARENT_ORIGINS = ['https://chatgpt.com', 'https://chat.openai.com'] as const;

/**
 * Posts the report to the parent once per allowed origin instead of once with
 * `'*'`. `postMessage` only ever delivers to a window whose actual origin
 * matches the `targetOrigin` argument -- the browser silently drops the call
 * for every origin that isn't a match -- so broadcasting one call per
 * allowlisted origin reaches the real parent when it's ChatGPT and reaches
 * nobody otherwise, without the sandbox ever needing to know which one it is.
 */
export function postDeepResearchFrameMessage(
  target: Pick<Window, 'postMessage'>,
  content: { html: string } | { text: string }
): void {
  const message = createDeepResearchFrameMessage(content);
  for (const origin of CHATGPT_PARENT_ORIGINS) {
    target.postMessage(message, origin);
  }
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
