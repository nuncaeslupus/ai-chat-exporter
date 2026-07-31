/**
 * Strip executable markup from an HTML string before it becomes live DOM.
 *
 * Used at re-injection points where content that started out safe (escaped
 * text, or markdown parsed by a library like `marked` that passes raw inline
 * HTML through by default) is about to be inserted into a document that will
 * actually render it — e.g. the print preview document.
 *
 * Uses a <template> element: its content is an inert DocumentFragment, so
 * parsing untrusted HTML into it never executes scripts or loads resources.
 *
 * SEC-1: this is an ALLOWLIST of tags/attributes, not a denylist. A denylist
 * can never be complete — `<meta http-equiv=refresh>`, `<base>`, `<link>`,
 * `<form>`/`formaction` and SVG `xlink:href` all reached live DOM through the
 * previous 5-tag denylist. Anything not named below, including its content,
 * is dropped instead of chased tag-by-tag.
 */

/**
 * Tags the print preview and the Deep Research report relay actually need.
 *
 * `svg`/`title`/`desc` are here only so chatgpt/parser.ts's
 * `replaceDiagramsWithMarker`/`isPlausibleDiagram` (which run on this
 * function's *output*) can size-check a relayed diagram and either mark it
 * `[Diagram: ...]` or drop it as a decorative icon — the `<svg>` itself is
 * never rendered as-is, so no drawing element (`path`/`rect`/`text`/`use`/
 * `image`/`a`/`script`/`foreignObject`) needs to survive, only the `<svg>`
 * node's own size attributes and an optional accessible name.
 */
const ALLOWED_TAGS = new Set([
  'p',
  'div',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'pre',
  'code',
  'a',
  'img',
  'blockquote',
  'hr',
  'em',
  'strong',
  'del',
  'br',
  'sup',
  'sub',
  'b',
  'i',
  'u',
  'svg',
  'title',
  'desc',
]);

/** Attributes each allowed tag may keep, in addition to the universal `class`. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title']),
  svg: new Set(['width', 'height', 'viewbox', 'aria-label']),
  // A11Y-2: keeps a scrollable code block reachable by keyboard (WCAG 2.1.1) —
  // mirrors the `tabindex="0"` the html-exporter's own <pre> already carries
  // (A11Y-1/#216); this is the sanitizer both paths share.
  pre: new Set(['tabindex']),
};

/** Attributes validated with `safeUrl` rather than kept verbatim. */
const URL_ATTRS = new Set(['href', 'src']);

const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const SAFE_IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i;

/**
 * Resolve a URL-bearing attribute value against a scheme allowlist by
 * actually parsing it, instead of pattern-matching the string for
 * `javascript:` — parsing (via the `URL` constructor, the same algorithm a
 * browser uses to resolve `href`/`src`) strips ASCII tab/LF/CR from anywhere
 * in the string before reading the scheme, exactly as browsers do at
 * navigation/load time. A regex like `/^\s*javascript:/i` only anchors
 * *leading* whitespace, so `jav&#9;ascript:alert(1)` (a literal tab inside
 * the scheme once HTML entities are decoded) slips past it but still
 * resolves to `javascript:` when the browser navigates — this is what
 * closes that gap (SEC-1).
 *
 * Exported so exporters that write scraped URLs into `href`/`src` (e.g.
 * html-exporter.ts) share one validator instead of re-implementing it.
 *
 * @returns the original value (with internal tab/LF/CR stripped) when its
 * scheme is safe, a relative URL (resolves harmlessly against the page's own
 * origin), or an `allowImageData` inline image; `null` otherwise — callers
 * should drop the attribute/render as plain text when they get `null`.
 */
export function safeUrl(
  value: string | null | undefined,
  options: { allowImageData?: boolean } = {}
): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  // Browsers strip ASCII tab/LF/CR from anywhere in a URL before parsing its
  // scheme; matching that here is what closes the `jav\tascript:` bypass.
  const normalized = trimmed.replace(/[\t\n\r]/g, '');

  if (options.allowImageData && SAFE_IMAGE_DATA_URL.test(normalized)) {
    return normalized;
  }

  let parsed: URL;
  try {
    // A relative value (no scheme of its own) resolves against this fixed
    // dummy origin and comes out `https:`, which is allowlisted — only an
    // explicit, disallowed scheme (`javascript:`, `data:` outside
    // `allowImageData`, `vbscript:`, …) is ever rejected.
    parsed = new URL(normalized, 'https://sanitize-html.invalid/');
  } catch {
    return null;
  }

  return SAFE_URL_SCHEMES.has(parsed.protocol) ? normalized : null;
}

export function sanitizeHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  const toRemove: Element[] = [];

  let node = walker.nextNode() as Element | null;
  while (node) {
    const tag = node.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      // Removing the element removes its whole subtree, including any
      // content that never gets individually visited by this walk — e.g. a
      // nested <template>'s content lives in its own separate
      // DocumentFragment that a TreeWalker over the outer fragment never
      // descends into, so a <script> hidden inside it could otherwise
      // survive untouched. Dropping the <template> node itself sidesteps
      // that: its `.content` goes with it.
      toRemove.push(node);
    } else {
      const allowedForTag = ALLOWED_ATTRS[tag];
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        if (name === 'class') {
          continue; // universal and inert — selects CSS only, never a URL or code.
        }
        if (!allowedForTag?.has(name)) {
          node.removeAttribute(attr.name);
          continue;
        }
        if (URL_ATTRS.has(name)) {
          const safe = safeUrl(attr.value, { allowImageData: tag === 'img' });
          if (safe === null) {
            node.removeAttribute(attr.name);
          } else {
            node.setAttribute(attr.name, safe);
          }
        }
      }
    }
    node = walker.nextNode() as Element | null;
  }

  toRemove.forEach((el) => {
    el.remove();
  });

  return template.innerHTML;
}
