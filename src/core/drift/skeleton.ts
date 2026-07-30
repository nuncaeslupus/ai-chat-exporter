/**
 * Builds a structural outline of a DOM subtree that cannot carry conversation
 * content.
 *
 * The rule that makes this safe: **attribute values are excluded by default and
 * safelisted in**. Excluding a denylist would be unsafe — `aria-label="Artifact
 * panel: <conversation title>"` and `data-turn-id="<uuid>"` both carry
 * identifying data, and the next such attribute is unknowable. Attribute
 * *names* are always kept: they are what identifies the markup to a maintainer.
 *
 * Text nodes become `text(N)`. Comments are skipped entirely.
 */

/**
 * Attributes whose values are structural with a known-small vocabulary, and so
 * are safe to reproduce verbatim. Nothing may be added here without checking
 * that the platform cannot put user text in it.
 */
export const SAFE_ATTR_VALUES: readonly string[] = [
  'data-turn',
  'data-message-author-role',
  'data-is-streaming',
  'role',
  'type',
];

export interface SkeletonOptions {
  maxNodes?: number;
  maxBytes?: number;
  maxDepth?: number;
}

const DEFAULTS = { maxNodes: 500, maxBytes: 32_768, maxDepth: 12 };

function renderAttributes(el: Element): string {
  const parts: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'class') continue; // rendered as .a.b on the tag itself
    if (SAFE_ATTR_VALUES.includes(attr.name)) {
      parts.push(`${attr.name}="${attr.value}"`);
    } else {
      parts.push(attr.name);
    }
  }
  return parts.length > 0 ? `[${parts.join('][')}]` : '';
}

function renderTag(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const classes = el.getAttribute('class')?.trim();
  const classPart = classes ? `.${classes}` : '';
  return `${tag}${classPart}${renderAttributes(el)}`;
}

export function buildSkeleton(root: Element, options: SkeletonOptions = {}): string {
  const { maxNodes, maxBytes, maxDepth } = { ...DEFAULTS, ...options };

  const lines: string[] = [];
  let bytes = 0;
  let visited = 0;
  let elided = 0;

  const walk = (el: Element, depth: number): void => {
    if (depth > maxDepth) {
      elided += el.querySelectorAll('*').length + 1;
      return;
    }
    if (visited >= maxNodes || bytes >= maxBytes) {
      elided += 1;
      return;
    }

    visited += 1;
    const line = `${'  '.repeat(depth)}${renderTag(el)}`;
    lines.push(line);
    bytes += line.length + 1;

    for (const child of Array.from(el.childNodes)) {
      // Node.TEXT_NODE === 3. Only the length survives.
      if (child.nodeType === 3) {
        const length = child.textContent?.trim().length ?? 0;
        if (length > 0) {
          const textLine = `${'  '.repeat(depth + 1)}text(${length})`;
          lines.push(textLine);
          bytes += textLine.length + 1;
        }
        continue;
      }
      // Node.ELEMENT_NODE === 1. Comments (8) and everything else are skipped.
      if (child.nodeType === 1) {
        walk(child as Element, depth + 1);
      }
    }
  };

  walk(root, 0);

  if (elided > 0) {
    lines.push(`…elided ${elided} nodes`);
  }

  return lines.join('\n');
}
