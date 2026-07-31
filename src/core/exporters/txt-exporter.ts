/**
 * Plain text format exporter
 */

import type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  Conversation,
  QAPair,
  StructuredContentBlock,
  StructuredConversation,
  StructuredQAPair,
  InlineContent,
  ListBlock,
  TableBlock,
} from '../types';
import { BaseExporter } from './base-exporter';
import { ConversationStructureService } from '../services';

/**
 * Fixed line width for the plain-text export (R-5).
 *
 * Prose is wrapped to this. Code lines, table rows and bare URLs are
 * deliberately exempt: wrapping code changes the code, wrapping a table row
 * breaks the ASCII box, and wrapping a URL makes it uncopyable.
 */
const TXT_WIDTH = 72;

/**
 * Exports conversations to plain text format
 */
export class TextExporter extends BaseExporter {
  readonly format: ExportFormat = 'txt';
  readonly extension = 'txt';
  readonly mimeType = 'text/plain';

  /**
   * Export selected Q&A pairs to plain text
   */
  async export(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      // Convert to structured format (only the selected pairs)
      const structured = ConversationStructureService.toStructured({
        ...conversation,
        pairs: selectedPairs,
      });
      const content = this.generateText(structured, options);
      return this.createSuccessResult(content, options.filename);
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Failed to export to plain text'
      );
    }
  }

  /**
   * Generate plain text content
   */
  private generateText(conversation: StructuredConversation, options: ExportOptions): string {
    const lines: string[] = [];

    // Title
    lines.push(...this.wrap(conversation.title));
    lines.push('='.repeat(Math.min(conversation.title.length, TXT_WIDTH)));
    lines.push('');

    // Metadata section
    if (options.showMetaInfo) {
      lines.push(
        `${this.getMetadataLabel('platform')}: ${this.formatPlatformName(conversation.platform)}`
      );
      if (conversation.model) {
        lines.push(`${this.getMetadataLabel('model')}: ${conversation.model}`);
      }
      const dateRange = this.formatDateRange(conversation.pairs);
      if (dateRange) {
        lines.push(`${this.getMetadataLabel('dateRange')}: ${dateRange}`);
      }
      if (conversation.createdAt) {
        lines.push(
          `${this.getMetadataLabel('exported')}: ${this.formatTimestamp(conversation.createdAt)}`
        );
      }
      lines.push(`${this.getMetadataLabel('url')}: ${conversation.url}`);
      lines.push('');
      lines.push('-'.repeat(TXT_WIDTH));
      lines.push('');
    }

    // Q&A pairs
    const assistantName = this.getRoleName('assistant', conversation.platform);
    const daySeparator = this.daySeparator(options.showMetaInfo);
    for (let i = 0; i < conversation.pairs.length; i++) {
      const pair = conversation.pairs[i];
      if (pair) {
        lines.push(...this.formatPair(pair, assistantName, options, daySeparator));
        if (i < conversation.pairs.length - 1) {
          lines.push('');
          lines.push('-'.repeat(TXT_WIDTH));
          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Wrap prose to `TXT_WIDTH`, never splitting a word.
   *
   * A word longer than the available width (a long URL, a hash) is emitted on
   * its own over-long line rather than broken — a broken URL cannot be copied,
   * which is worse than a ragged margin.
   */
  private wrap(text: string, indent = ''): string[] {
    const limit = Math.max(TXT_WIDTH - indent.length, 1);
    const out: string[] = [];
    for (const paragraph of text.split('\n')) {
      let current = '';
      for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
        if (!current) {
          current = word;
        } else if (current.length + 1 + word.length <= limit) {
          current += ` ${word}`;
        } else {
          out.push(indent + current);
          current = word;
        }
      }
      out.push(indent + current);
    }
    return out;
  }

  /**
   * `USER · 12:04` over a rule of its own exact width (R-5).
   *
   * Uppercase and underlined rather than `User (12:00:00):` — plain text has no
   * type scale, so case and an underline are the only weight available, and the
   * three underline characters (`=` title, `-` role, `~` body heading) are what
   * carry the document's hierarchy.
   */
  private roleLabel(
    name: string,
    timestamp: Date | undefined,
    includeTimestamps: boolean
  ): string[] {
    const time =
      includeTimestamps && timestamp ? ` · ${this.formatTime(timestamp).slice(0, 5)}` : '';
    const label = `${name.toUpperCase()}${time}`;
    return [label, '-'.repeat(Math.min(label.length, TXT_WIDTH))];
  }

  /**
   * Format a single Q&A pair
   */
  private formatPair(
    pair: StructuredQAPair,
    assistantName: string,
    options: ExportOptions,
    daySeparator: (date?: Date) => string
  ): string[] {
    const lines: string[] = [];
    const pushDaySeparator = (date?: Date): void => {
      const separator = daySeparator(date);
      if (separator) {
        lines.push(separator, '');
      }
    };

    // User message — indented two spaces, the plain-text equivalent of the
    // pdf's turn fill: it is what marks who is asking.
    pushDaySeparator(pair.question.timestamp);
    lines.push(
      ...this.roleLabel(this.getRoleName('user'), pair.question.timestamp, options.showMetaInfo)
    );
    lines.push(...this.renderBlocks(pair.question.blocks, '  '));
    lines.push('');

    // Assistant message
    pushDaySeparator(pair.answer.timestamp);
    lines.push(...this.roleLabel(assistantName, pair.answer.timestamp, options.showMetaInfo));
    lines.push(...this.renderBlocks(pair.answer.blocks));

    // Add artifacts if present
    if (pair.answer.metadata?.artifacts && Array.isArray(pair.answer.metadata.artifacts)) {
      const artifactsWithContent = pair.answer.metadata.artifacts.filter((a) => a.content);

      if (artifactsWithContent.length > 0) {
        lines.push('');
        lines.push(`${this.artifactsSectionLabel()}:`);
        lines.push('');

        for (const artifact of artifactsWithContent) {
          lines.push(`--- ${artifact.title} ---`);
          if (artifact.typeLabel) {
            lines.push(`${this.artifactTypeFieldLabel()}: ${artifact.typeLabel}`);
          }
          lines.push('');
          lines.push(artifact.content || '');
          lines.push('');
        }
      }
    }

    // Add cited sources (Gemini Deep Research, ChatGPT/Claude web search)
    if (pair.answer.metadata?.webSearches && Array.isArray(pair.answer.metadata.webSearches)) {
      for (const search of pair.answer.metadata.webSearches) {
        if (!search.results?.length) {
          continue;
        }
        lines.push('');
        lines.push(`${this.sourcesSectionLabel(search.query)}:`);
        lines.push('');
        for (const result of search.results) {
          lines.push(`- ${result.title}${result.domain ? ` (${result.domain})` : ''}`);
          lines.push(`  ${result.url}`);
        }
      }
    }

    return lines;
  }

  /**
   * Render structured content blocks to plain text lines
   */
  private renderBlocks(blocks: StructuredContentBlock[], indent = ''): string[] {
    const lines: string[] = [];

    for (const block of blocks) {
      switch (block.type) {
        case 'paragraph': {
          const text = this.inlineToText(block.content);
          if (text.trim()) {
            lines.push(...this.wrap(text, indent));
            lines.push('');
          }
          break;
        }

        case 'heading': {
          const headingText = this.inlineToText(block.content).trim();
          if (headingText) {
            const wrapped = this.wrap(headingText, indent);
            lines.push('');
            lines.push(...wrapped);
            // The rule matches the longest rendered line, not the raw string,
            // so a wrapped heading is still underlined to its real width.
            const widest = Math.max(...wrapped.map((l) => l.length));
            lines.push(indent + '~'.repeat(widest - indent.length));
            lines.push('');
          }
          break;
        }

        // Fenced with its language and NOT indented (R-5). Indenting steals
        // columns from the widest lines in the file and wraps real code.
        case 'code':
          lines.push('');
          lines.push(`\`\`\`${block.language ?? ''}`);
          lines.push(block.code);
          lines.push('```');
          lines.push('');
          break;

        case 'list':
          lines.push(...this.renderList(block, 0, indent));
          lines.push('');
          break;

        case 'blockquote': {
          lines.push('');
          const quoteLines = this.renderBlocks(block.content, indent);
          for (const line of quoteLines) {
            if (line.trim()) {
              lines.push(`> ${line}`);
            } else {
              lines.push('>');
            }
          }
          lines.push('');
          break;
        }

        case 'hr':
          lines.push('');
          lines.push('-'.repeat(TXT_WIDTH));
          lines.push('');
          break;

        // Plain text can't show it; the URL is the only way back to the picture.
        case 'image':
          lines.push('');
          lines.push(`[Image: ${block.alt || 'image'}] ${block.url}`);
          lines.push('');
          break;

        // Plain text can't play it; the URL is the only way back to the clip.
        case 'media':
          lines.push('');
          lines.push(`[${this.mediaLabel(block)}] ${block.url}`);
          lines.push('');
          break;

        case 'table':
          lines.push('');
          lines.push(...this.renderTable(block));
          lines.push('');
          break;
      }
    }

    return lines;
  }

  /**
   * Render a table to plain text
   */
  private renderTable(block: TableBlock): string[] {
    const lines: string[] = [];
    const allRows: string[][] = [];

    // Collect all cells from headers and body
    if (block.headers && block.headers.length > 0) {
      allRows.push(block.headers.map((cell: InlineContent[]) => this.inlineToText(cell).trim()));
    }

    if (block.rows && block.rows.length > 0) {
      for (const row of block.rows) {
        allRows.push(row.map((cell: InlineContent[]) => this.inlineToText(cell).trim()));
      }
    }

    if (allRows.length === 0) return lines;

    // Calculate column widths
    const numCols = Math.max(...allRows.map((row) => row.length));
    const colWidths: number[] = [];

    for (let col = 0; col < numCols; col++) {
      const maxWidth = Math.max(
        ...allRows.map((row) => (row[col] || '').length),
        3 // Minimum width
      );
      colWidths.push(maxWidth);
    }

    /**
     * A boxed table when there is a header row, `=` under the header (R-5).
     *
     * The rule under the header is `=` rather than `-` so the header is
     * distinguishable from the box itself in a monospace reader — the same
     * `=`/`-` weighting the title and role rules use.
     */
    const hasHeader = Boolean(block.headers && block.headers.length > 0);
    const rule = (fill: string): string =>
      `+${colWidths.map((w) => fill.repeat(w + 2)).join('+')}+`;

    if (hasHeader) lines.push(rule('-'));

    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      if (!row) continue;
      const cells = colWidths.map((w, j) => (row[j] ?? '').padEnd(w));
      lines.push(`| ${cells.join(' | ')} |`);

      if (i === 0 && hasHeader) {
        lines.push(rule('='));
      }
    }

    if (hasHeader) lines.push(rule('-'));

    return lines;
  }

  /**
   * Render a list to plain text lines
   */
  private renderList(block: ListBlock, depth: number, base = ''): string[] {
    const lines: string[] = [];
    const indent = base + '  '.repeat(depth);

    for (const [i, item] of block.items.entries()) {
      const prefix = block.ordered ? `${i + 1}.` : '-';
      const text = this.inlineToText(item.content).trim();

      if (text) {
        // Wrap the item, then hang the continuation under the text rather than
        // under the marker, so a wrapped bullet still reads as one item.
        const hang = indent + ' '.repeat(prefix.length + 1);
        const wrapped = this.wrap(text, hang);
        const [first, ...rest] = wrapped;
        lines.push(`${indent}${prefix} ${(first ?? '').trimStart()}`);
        lines.push(...rest);
      }

      if (item.nested) {
        lines.push(...this.renderList(item.nested, depth + 1, base));
      }
    }

    return lines;
  }

  /**
   * Convert inline content to plain text
   */
  private inlineToText(content: InlineContent[]): string {
    return content
      .map((item) =>
        item.type === 'link' && item.url && item.url !== item.text
          ? `${item.text} (${item.url})`
          : item.text
      )
      .join('');
  }
}
