/**
 * HTML to Structured Content Parser
 * Converts HTML content into structured JSON representation
 */

import type {
  StructuredContentBlock,
  ParagraphBlock,
  CodeBlock,
  HeadingBlock,
  ListBlock,
  BlockquoteBlock,
  ImageBlock,
  TableBlock,
  InlineContent,
  ListItem,
} from '../types/structured-content';
import { flattenElementText, boundaryLevelForTag } from '../utils/dom-text';

/**
 * Parse HTML content into structured blocks
 */
export class HtmlContentParser {
  /**
   * Parse HTML string into structured content blocks
   */
  static parse(html: string): StructuredContentBlock[] {
    const parser = new DOMParser();

    // Wrap content in a div to prevent root-level text/inline elements
    // from being treated as separate blocks
    const wrappedHtml = `<div>${html}</div>`;
    const doc = parser.parseFromString(wrappedHtml, 'text/html');

    // Parse the wrapper div's children
    const wrapper = doc.body.firstElementChild;
    if (!wrapper) {
      return [];
    }

    // Check if the wrapper contains only inline content (no block elements)
    const hasBlockElements = Array.from(wrapper.children).some((child) => {
      const tag = child.tagName.toLowerCase();
      return [
        'p',
        'div',
        'pre',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'blockquote',
        'table',
        'hr',
        'img',
      ].includes(tag);
    });

    // If it contains only inline content, treat the whole thing as a single paragraph
    if (!hasBlockElements) {
      const inline = this.parseInlineContent(wrapper);
      if (inline.length > 0) {
        return [this.createParagraph(inline)];
      }
      return [];
    }

    // Otherwise, parse as normal block structure
    return this.parseElement(wrapper);
  }

  /**
   * Parse an element into structured blocks
   */
  private static parseElement(element: Element): StructuredContentBlock[] {
    const blocks: StructuredContentBlock[] = [];

    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent?.trim();
        if (text) {
          blocks.push(this.createParagraph([{ type: 'text', text }]));
        }
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const el = child as Element;
      const tagName = el.tagName.toLowerCase();

      switch (tagName) {
        case 'pre': {
          const codeBlock = this.parseCodeBlock(el);
          if (codeBlock) blocks.push(codeBlock);
          break;
        }
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6': {
          const heading = this.parseHeading(el);
          if (heading) blocks.push(heading);
          break;
        }
        case 'ul':
        case 'ol': {
          const list = this.parseList(el);
          if (list) blocks.push(list);
          break;
        }
        case 'blockquote': {
          const blockquote = this.parseBlockquote(el);
          if (blockquote) blocks.push(blockquote);
          break;
        }
        case 'hr': {
          blocks.push({ type: 'hr' });
          break;
        }
        case 'img': {
          const image = this.parseImage(el);
          if (image) blocks.push(image);
          break;
        }
        case 'a': {
          // An anchor wrapping an image (linked thumbnail/citation) has no text
          // content of its own to fall back on, so parseInlineContent() would
          // silently drop it. Unwrap the image here and carry the href as
          // linkUrl; a text-only anchor keeps the pre-existing inline behavior.
          const img = el.querySelector('img');
          const image = img ? this.parseImage(img) : null;
          if (image) {
            const href = (el as HTMLAnchorElement).href;
            if (href) image.linkUrl = href;
            blocks.push(image);
            break;
          }
          const inline = this.parseInlineContent(el);
          if (inline.length > 0) {
            blocks.push(this.createParagraph(inline));
          }
          break;
        }
        case 'table': {
          const table = this.parseTable(el);
          if (table) blocks.push(table);
          break;
        }
        case 'p':
        case 'div': {
          // Check if this div contains block-level elements (like tables)
          // If so, recursively parse its children rather than treating as inline
          // 'img' belongs here: parseInlineContent has no image case, so an image
          // left to the inline path is read as textContent ('') and silently dropped.
          const hasNestedBlocks = el.querySelector(
            'table, pre, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, hr, img'
          );
          if (hasNestedBlocks) {
            // Recursively parse children as blocks
            const nestedBlocks = this.parseElement(el);
            blocks.push(...nestedBlocks);
          } else {
            // No block elements, treat as inline content
            const inline = this.parseInlineContent(el);
            if (inline.length > 0) {
              blocks.push(this.createParagraph(inline));
            }
          }
          break;
        }
        default: {
          // For other elements, try to extract inline content
          const inline = this.parseInlineContent(el);
          if (inline.length > 0) {
            blocks.push(this.createParagraph(inline));
          }
        }
      }
    }

    return blocks;
  }

  /**
   * Parse a code block
   */
  private static parseCodeBlock(pre: Element): CodeBlock | null {
    const code = pre.querySelector('code') || pre;
    const codeText = code.textContent?.trim() || '';

    if (!codeText) return null;

    // Try to detect language from class
    let language = 'code';
    const codeEl = pre.querySelector('code');
    if (codeEl) {
      const classMatch = /language-(\w+)/.exec(codeEl.className);
      if (classMatch?.[1]) {
        language = classMatch[1];
      }
    }

    return {
      type: 'code',
      language,
      code: codeText,
    };
  }

  /**
   * Parse a heading
   */
  private static parseHeading(el: Element): HeadingBlock | null {
    const level = parseInt(el.tagName[1] || '1') as 1 | 2 | 3 | 4 | 5 | 6;
    const content = this.parseInlineContent(el);

    if (content.length === 0) return null;

    return {
      type: 'heading',
      level,
      content,
    };
  }

  /**
   * Parse a list
   */
  private static parseList(el: Element): ListBlock | null {
    const ordered = el.tagName.toLowerCase() === 'ol';
    const items: ListItem[] = [];

    for (const li of el.querySelectorAll(':scope > li')) {
      const nestedList = li.querySelector('ul, ol');
      const item: ListItem = {
        content: this.parseInlineContent(li, nestedList ? [nestedList] : []),
      };

      if (nestedList) {
        const nested = this.parseList(nestedList);
        if (nested) {
          item.nested = nested;
        }
      }

      items.push(item);
    }

    if (items.length === 0) return null;

    return {
      type: 'list',
      ordered,
      items,
    };
  }

  /**
   * Parse a blockquote
   */
  private static parseBlockquote(el: Element): BlockquoteBlock | null {
    const content = this.parseElement(el);

    if (content.length === 0) return null;

    return {
      type: 'blockquote',
      content,
    };
  }

  /**
   * Parse an image
   */
  private static parseImage(el: Element): ImageBlock | null {
    const img = el as HTMLImageElement;
    const url = img.src;
    const alt = img.alt || '';
    const title = img.title;

    if (!url) return null;

    const imageBlock: ImageBlock = {
      type: 'image',
      url,
      alt,
      ...(title && { title }),
    };

    // Add dimensions if available
    const widthAttr = img.getAttribute('width');
    const heightAttr = img.getAttribute('height');

    if (widthAttr) {
      imageBlock.width = parseInt(widthAttr, 10);
    }
    if (heightAttr) {
      imageBlock.height = parseInt(heightAttr, 10);
    }

    return imageBlock;
  }

  /**
   * Parse a table.
   *
   * EXP-4: every downstream exporter (md/html/docx/txt/pdf) reads a cell by
   * its column INDEX, so the grid has to be normalised here, once, rather
   * than have each of the six formats reinvent colspan/rowspan handling --
   * three of them (md/txt/pdf) can't represent a real span at all. Both
   * `expandSpannedRows` (colspan/rowspan) and the ragged-row padding below
   * exist so a value can never be attributed to the wrong heading.
   */
  private static parseTable(el: Element): TableBlock | null {
    const thead = el.querySelector('thead');
    const tbody = el.querySelector('tbody') || el;

    // Parse header rows, expanding any colspan/rowspan into real grid
    // positions, then merge the (possibly multi-row) thead into one header
    // row -- see mergeHeaderRows for why "merge" rather than "concatenate"
    // (the old bug) or "keep the last row" (loses the primary label).
    const headerRowEls = thead ? Array.from(thead.querySelectorAll('tr')) : [];
    const headers = this.mergeHeaderRows(this.expandSpannedRows(headerRowEls));

    // Parse body rows with the same span expansion.
    const bodyRowEls = Array.from(tbody.querySelectorAll(':scope > tr')).filter(
      (row) => !row.closest('thead') // Skip header rows if they're in tbody
    );
    const rows = this.expandSpannedRows(bodyRowEls).filter((row) => row.length > 0);

    // A row that's short for reasons OTHER than a span -- a malformed/ragged
    // <tr> with fewer cells than the header -- still needs padding, or a
    // renderer indexing by column would shift its values left into earlier
    // headings. Pad only; never truncate a longer row.
    const numCols = headers.length;
    if (numCols > 0) {
      for (const row of rows) {
        while (row.length < numCols) row.push([]);
      }
    }

    // Skip empty tables
    if (headers.length === 0 && rows.length === 0) return null;

    return {
      type: 'table',
      headers,
      rows,
    };
  }

  /**
   * Parse a `colspan`/`rowspan` attribute. Missing, non-numeric, and `< 1`
   * all mean "no span" (1); clamped at 1000 (the browser's own ceiling for
   * the attribute) so a malformed/hostile value can't blow up the grid loop
   * below.
   */
  private static parseSpanAttr(value: string | null): number {
    const n = value ? parseInt(value, 10) : 1;
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, 1000);
  }

  /**
   * Expand `colspan`/`rowspan` across a set of `<tr>` rows into their real
   * grid positions. A spanned cell's content is pushed once, at its
   * top-left position; every other grid position it covers (to its right
   * for colspan, below it for rowspan) gets an empty placeholder (`[]`) so
   * a cell that comes after the span in the same row -- or a value in a
   * later row -- keeps the column index it visually belongs to, instead of
   * shifting left into an earlier heading.
   */
  private static expandSpannedRows(rowEls: Element[]): InlineContent[][][] {
    const grid: InlineContent[][][] = [];
    // colIndex -> rows still reserved by an earlier (unfinished) rowspan.
    const pending = new Map<number, number>();

    for (const row of rowEls) {
      const gridRow: InlineContent[][] = [];
      let col = 0;
      const isReserved = (c: number): boolean => (pending.get(c) ?? 0) > 0;
      const fillReserved = (): void => {
        while (isReserved(col)) {
          gridRow[col] = [];
          col++;
        }
      };
      // Only reservations that existed BEFORE this row started get
      // decremented at the end -- a rowspan created by a cell in THIS row
      // reserves rows starting next, not this one.
      const reservedBeforeThisRow = new Set(pending.keys());

      for (const cell of Array.from(row.querySelectorAll('th, td'))) {
        fillReserved();

        const colspan = this.parseSpanAttr(cell.getAttribute('colspan'));
        const rowspan = this.parseSpanAttr(cell.getAttribute('rowspan'));

        gridRow[col] = this.parseInlineContent(cell);
        if (rowspan > 1) pending.set(col, rowspan - 1);
        col++;

        for (let span = 1; span < colspan; span++) {
          fillReserved();
          gridRow[col] = [];
          if (rowspan > 1) pending.set(col, rowspan - 1);
          col++;
        }
      }
      fillReserved(); // trailing rowspan(s) that outlive every cell in this row

      for (const c of reservedBeforeThisRow) {
        const remaining = (pending.get(c) ?? 0) - 1;
        if (remaining <= 0) pending.delete(c);
        else pending.set(c, remaining);
      }

      grid.push(gridRow);
    }

    return grid;
  }

  /**
   * Merge a normalised header grid (one row per `<thead>` `<tr>`, already
   * colspan/rowspan-expanded) into a single header row.
   *
   * A multi-row `<thead>` usually layers a coarser label over a finer one
   * (e.g. "Region"/"Q1" with a "(EUR)"/"(EUR)" units row beneath it).
   * Concatenating every row's cells (the old bug) doubles the column count;
   * keeping only the last row silently drops whichever row carries the
   * primary label. Joining column-wise with a space keeps both, and no
   * format here (md/txt included) can render a real multi-row header
   * anyway, so a single composite row loses nothing they could have shown.
   */
  private static mergeHeaderRows(headerGrid: InlineContent[][][]): InlineContent[][] {
    if (headerGrid.length <= 1) return headerGrid[0] ?? [];

    const numCols = Math.max(...headerGrid.map((row) => row.length));
    const merged: InlineContent[][] = [];
    for (let col = 0; col < numCols; col++) {
      let cell: InlineContent[] = [];
      for (const row of headerGrid) {
        const part = row[col];
        if (!part || part.length === 0) continue;
        cell = cell.length === 0 ? part : [...cell, { type: 'text', text: ' ' }, ...part];
      }
      merged.push(cell);
    }
    return merged;
  }

  /**
   * Parse inline content with formatting
   */
  /**
   * An element's text as inline PROSE: whitespace collapsed to single spaces.
   *
   * D-23. Chat platforms pretty-print their markup, so an inline widget — a
   * web-search citation pill, a tooltip wrapper — carries the page's newlines
   * and indentation in its `textContent`. Flattened raw, one sentence became ten
   * lines in md and txt, and the blank lines split the Markdown paragraph into
   * several. Text NODES were already normalised here; element flattening was not,
   * which is why it only showed up around widgets.
   *
   * Deliberately not used for inline `<code>` or for a math marker: there the
   * whitespace is content, not source formatting.
   *
   * D-35: delegates to `flattenElementText`, which also inserts a boundary
   * between block-level descendants (so an unrecognised block -- a div-based
   * table row, say -- flattened through here can never join two cells into
   * one run) while leaving genuinely inline content unchanged.
   */
  private static inlineText(el: Element): string {
    return flattenElementText(el);
  }

  /**
   * Append a text run, merging it into the previous one when that is also plain
   * text.
   *
   * Each flattened widget contributes both a leading and a trailing space, so
   * without merging the pieces join as `research  MDN Web Docs  web.dev .` —
   * doubled spaces and a gap before the full stop. Merging lets the collapse run
   * across the seam between two runs, which is where the doubling lives.
   */
  private static pushText(result: InlineContent[], text: string): void {
    const previous = result[result.length - 1];
    if (previous?.type === 'text') {
      previous.text = `${previous.text}${text}`.replace(/\s+/g, ' ');
      return;
    }
    result.push({ type: 'text', text });
  }

  private static parseInlineContent(
    element: Element,
    excludeElements: Element[] = []
  ): InlineContent[] {
    const result: InlineContent[] = [];

    for (const child of Array.from(element.childNodes)) {
      // Skip excluded elements
      if (child.nodeType === Node.ELEMENT_NODE && excludeElements.includes(child as Element)) {
        continue;
      }

      if (child.nodeType === Node.TEXT_NODE) {
        const originalText = child.textContent || '';
        const trimmedText = originalText.trim();
        // Only skip completely empty text nodes
        if (trimmedText) {
          // Normalize whitespace: collapse sequences of whitespace into single spaces
          // This preserves spacing while removing unwanted newlines from HTML formatting
          const normalizedText = originalText.replace(/\s+/g, ' ');
          this.pushText(result, normalizedText);
        }
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const el = child as Element;
      const tagName = el.tagName.toLowerCase();

      // lo-320b: the math marker BaseParser.cleanupElement leaves behind. Its
      // text is already the delimited LaTeX source, so this only adds the type
      // and the display mode. Checked before the tag switch because the marker
      // is a plain <span>, which the switch would otherwise flatten to text.
      const mathDisplay = el.getAttribute('data-math-display');
      if (mathDisplay) {
        result.push({
          type: 'math',
          text: el.textContent || '',
          display: mathDisplay === 'block' ? 'block' : 'inline',
        });
        continue;
      }

      switch (tagName) {
        case 'strong':
        case 'b': {
          const children = this.parseInlineContent(el);
          if (children.length > 0) {
            result.push({
              type: 'bold',
              text: this.inlineText(el),
              children,
            });
          }
          break;
        }
        case 'em':
        case 'i': {
          const children = this.parseInlineContent(el);
          if (children.length > 0) {
            result.push({
              type: 'italic',
              text: this.inlineText(el),
              children,
            });
          }
          break;
        }
        case 'code': {
          // Inline code (not in pre)
          if (!el.closest('pre')) {
            result.push({
              type: 'code',
              text: el.textContent || '',
            });
          }
          break;
        }
        case 'a': {
          const href = (el as HTMLAnchorElement).href;
          result.push({
            type: 'link',
            text: this.inlineText(el),
            url: href,
          });
          break;
        }
        case 'del':
        case 's': {
          result.push({
            type: 'strikethrough',
            text: this.inlineText(el),
          });
          break;
        }
        default: {
          // A math marker is often wrapped — KaTeX puts display math inside
          // `.katex-display`, Gemini wraps inline math in its own `.math-inline`
          // span. Flattening the wrapper to textContent would keep the delimited
          // source but lose the math type, so recurse to reach the marker.
          if (el.querySelector('[data-math-display]')) {
            result.push(...this.parseInlineContent(el));
            break;
          }
          // Any other element is flattened as prose — this is the citation-pill
          // path, and the one that made D-23 visible.
          const text = this.inlineText(el);
          if (text.trim()) {
            // D-35: a paragraph's InlineContent is one flowing text run, so a
            // block-level stray (an unrecognised div-based table row, a `tr`,
            // a `td`) can't carry a real line break here -- but it still must
            // never fuse wordlessly into whatever came before it (e.g. two
            // adjacent row divs with no whitespace between them in source).
            // A forced space guarantees a boundary; pushText's own whitespace
            // collapse below then normalises it exactly like any other
            // inter-word space, so this cannot double up or leak into D-23's
            // inline-widget spacing.
            const needsBoundary = boundaryLevelForTag(tagName) > 0 && result.length > 0;
            this.pushText(result, needsBoundary ? ` ${text}` : text);
          }
        }
      }
    }

    return result;
  }

  /**
   * Create a paragraph block
   */
  private static createParagraph(content: InlineContent[]): ParagraphBlock {
    return {
      type: 'paragraph',
      content,
    };
  }
}
