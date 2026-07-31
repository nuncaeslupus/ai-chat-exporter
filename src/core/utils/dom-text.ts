/**
 * Flatten an element's descendant text with boundaries between block-level
 * structure (D-35).
 *
 * `textContent` concatenates every descendant's text with no separator at
 * all. That is harmless for a genuinely inline element (`<strong>hello
 * world</strong>`), but any block structure not otherwise recognised by a
 * parser -- a div-based grid, an unhandled `<tr>`/`<td>` -- collapses into
 * one unreadable run: a real Gemini export turned a 4-column tax table into
 * `Hasta 6.000 EUR0 EUR19%De 6.000 EUR...`, silently joining numbers that
 * used to belong to different cells.
 *
 * Rule: an element's own tag decides whether *its* boundary fires, not
 * whether it happens to contain further structure. Table cells (`td`/`th`)
 * get a narrower separator (` | `) so a row stays readable on one line;
 * every other block-level element (row, paragraph, heading, list item,
 * section, …) gets a newline. Inline elements (`span`, `a`, `em`, `strong`,
 * `code`, `sup`, …) are not in either set, so they never introduce a
 * boundary -- only their text passes through, exactly as before.
 *
 * A text node's internal whitespace is collapsed to a single space (the same
 * normalisation `HtmlContentParser` already applies to inline prose), and a
 * text node that is nothing but whitespace is dropped rather than kept --
 * source indentation between tags must never masquerade as a real boundary
 * or a real word-separating space. `<pre>`/`<code>` are the one exception:
 * their content is copied byte-exact, whitespace included.
 */

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'section',
  'table',
  'tbody',
  'tfoot',
  'thead',
  'tr',
  'ul',
]);

const CELL_TAGS = new Set(['td', 'th']);

const CELL_SEPARATOR = ' | ';
const BLOCK_SEPARATOR = '\n';

/** 0 = inline (no boundary), 1 = cell-level, 2 = block-level. */
export function boundaryLevelForTag(tag: string): 0 | 1 | 2 {
  if (CELL_TAGS.has(tag)) return 1;
  if (BLOCK_TAGS.has(tag)) return 2;
  return 0;
}

/**
 * Flattens `root`'s descendants (see module docs for the boundary rules).
 * Deliberately does NOT trim the result: a caller that flattens a whole
 * message trims once at the end, but a caller flattening one inline sub-tree
 * (e.g. `HtmlContentParser`'s citation-pill path) needs to keep a meaningful
 * leading/trailing single space so it can merge cleanly with its siblings.
 */
export function flattenElementText(root: Element): string {
  const out: string[] = [];
  // 0 = no boundary owed, 1 = cell-level, 2 = block-level. Several boundaries
  // can be requested back-to-back with no real text between them (a row's
  // last cell closing right before the row itself closes) -- only the
  // strongest one is ever emitted, and only once, right before the next
  // real text.
  let pendingLevel = 0;

  const emit = (text: string): void => {
    if (!text) return;
    if (out.length > 0 && pendingLevel > 0) {
      out.push(pendingLevel >= 2 ? BLOCK_SEPARATOR : CELL_SEPARATOR);
    }
    pendingLevel = 0;
    out.push(text);
  };

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent ?? '';
      if (raw.trim() !== '') emit(raw.replace(/\s+/g, ' '));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === 'pre' || tag === 'code') {
      emit(el.textContent ?? '');
      return;
    }

    for (const child of Array.from(el.childNodes)) visit(child);

    pendingLevel = Math.max(pendingLevel, boundaryLevelForTag(tag));
  };

  for (const child of Array.from(root.childNodes)) visit(child);

  return out.join('');
}
