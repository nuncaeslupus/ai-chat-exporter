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

/**
 * Parse HTML content into structured blocks
 */
export class HtmlContentParser {
  /**
   * Parse HTML string into structured content blocks
   */
  static parse(html: string): StructuredContentBlock[] {
    // DEBUG: Check what HTML is being received for parsing
    console.log('🔍 HtmlContentParser.parse called with:', {
      htmlLength: html.length,
      htmlPreview: html.substring(0, 300),
      hasTables: html.includes('<table'),
      hasCode: html.includes('<code'),
      hasNewlines: html.includes('\n')
    });

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
    const hasBlockElements = Array.from(wrapper.children).some(child => {
      const tag = child.tagName.toLowerCase();
      return ['p', 'div', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
              'ul', 'ol', 'blockquote', 'table', 'hr', 'img'].includes(tag);
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
          const hasNestedBlocks = el.querySelector('table, pre, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, hr, img');
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
      const classMatch = codeEl.className.match(/language-(\w+)/);
      if (classMatch && classMatch[1]) {
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
   * Parse a table
   */
  private static parseTable(el: Element): TableBlock | null {
    const thead = el.querySelector('thead');
    const tbody = el.querySelector('tbody') || el;

    // Parse headers
    const headers: InlineContent[][] = [];
    if (thead) {
      const headerRows = thead.querySelectorAll('tr');
      for (const row of headerRows) {
        const headerRow: InlineContent[][] = [];
        const cells = row.querySelectorAll('th, td');
        for (const cell of cells) {
          headerRow.push(this.parseInlineContent(cell));
        }
        if (headerRow.length > 0) {
          headers.push(...headerRow);
        }
      }
    }

    // Parse body rows
    const rows: InlineContent[][][] = [];
    const bodyRows = tbody.querySelectorAll(':scope > tr');
    for (const row of bodyRows) {
      // Skip header rows if they're in tbody
      if (row.closest('thead')) continue;

      const rowCells: InlineContent[][] = [];
      const cells = row.querySelectorAll('th, td');
      for (const cell of cells) {
        rowCells.push(this.parseInlineContent(cell));
      }
      if (rowCells.length > 0) {
        rows.push(rowCells);
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
   * Parse inline content with formatting
   */
  private static parseInlineContent(
    element: Element,
    excludeElements: Element[] = []
  ): InlineContent[] {
    const result: InlineContent[] = [];

    // DEBUG: Check inline content parsing
    console.log('🔍 parseInlineContent:', {
      tagName: element.tagName,
      childNodeCount: element.childNodes.length,
      textContent: element.textContent?.substring(0, 100),
      hasCodeChildren: Array.from(element.children).some(c => c.tagName === 'CODE')
    });

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
          result.push({ type: 'text', text: normalizedText });
        }
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const el = child as Element;
      const tagName = el.tagName.toLowerCase();

      switch (tagName) {
        case 'strong':
        case 'b': {
          const children = this.parseInlineContent(el);
          if (children.length > 0) {
            result.push({
              type: 'bold',
              text: el.textContent || '',
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
              text: el.textContent || '',
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
            text: el.textContent || '',
            url: href,
          });
          break;
        }
        case 'del':
        case 's': {
          result.push({
            type: 'strikethrough',
            text: el.textContent || '',
          });
          break;
        }
        default: {
          // For other elements, just extract text
          const text = el.textContent || '';
          if (text) {
            result.push({ type: 'text', text });
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
