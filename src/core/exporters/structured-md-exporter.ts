/**
 * Structured Markdown Exporter
 * Generates clean markdown from structured conversation content
 */

import type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  Conversation,
  QAPair,
  StructuredContentBlock,
  InlineContent,
} from '../types';
import { BaseExporter } from './base-exporter';
import { ConversationStructureService } from '../services';
import { getMessage } from '../../shared/i18n';

export class StructuredMarkdownExporter extends BaseExporter {
  readonly format: ExportFormat = 'md';
  readonly extension = 'md';
  readonly mimeType = 'text/markdown';

  async export(
    conversation: Conversation,
    _selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      // Convert to structured format
      const structured = ConversationStructureService.toStructured(conversation);

      // Generate markdown
      const markdown = this.generateMarkdown(structured, options);

      return this.createSuccessResult(markdown, options.filename);
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Failed to export to Markdown'
      );
    }
  }

  private generateMarkdown(conversation: any, options: ExportOptions): string {
    const lines: string[] = [];

    // Title
    lines.push(`# ${conversation.title}`);
    lines.push('');

    // Metadata as a table
    if (options.includeMetadata) {
      lines.push(`| **${getMessage('metadataTableHeaderField')}** | **${getMessage('metadataTableHeaderValue')}** |`);
      lines.push('|---|---|');
      lines.push(`| ${this.getMetadataLabel('platform')} | ${this.formatPlatformName(conversation.platform)} |`);
      if (conversation.model) {
        lines.push(`| ${this.getMetadataLabel('model')} | ${conversation.model} |`);
      }
      lines.push(`| ${this.getMetadataLabel('exported')} | ${this.formatTimestamp(conversation.createdAt)} |`);
      lines.push(`| ${this.getMetadataLabel('url')} | ${conversation.url} |`);
      lines.push('');
    }

    // Horizontal rule before conversation
    lines.push('---');
    lines.push('');

    // Q&A pairs
    for (let i = 0; i < conversation.pairs.length; i++) {
      const pair = conversation.pairs[i];

      // User question
      lines.push(`### 👤 ${this.getRoleName('user')}`);
      lines.push('');
      lines.push(...this.renderBlocks(pair.question.blocks));

      // Assistant answer
      lines.push(`### 🤖 ${this.getRoleName('assistant', conversation.platform)}`);
      lines.push('');
      lines.push(...this.renderBlocks(pair.answer.blocks));

      // Add separator between pairs (but not after the last one)
      if (i < conversation.pairs.length - 1) {
        lines.push('---');
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Render structured content blocks to markdown
   */
  private renderBlocks(blocks: StructuredContentBlock[]): string[] {
    const lines: string[] = [];

    for (const block of blocks) {
      switch (block.type) {
        case 'paragraph':
          const paraText = this.renderInline(block.content).trim();
          if (paraText) {
            lines.push(paraText);
            lines.push('');
          }
          break;

        case 'heading':
          const hashes = '#'.repeat(Math.min(block.level + 3, 6)); // +3 because title is h1, User/Assistant are h3
          const headingText = this.renderInline(block.content).trim();
          if (headingText) {
            lines.push(`${hashes} ${headingText}`);
            lines.push('');
          }
          break;

        case 'code':
          lines.push(`\`\`\`${block.language}`);
          lines.push(block.code);
          lines.push('```');
          lines.push('');
          break;

        case 'list':
          lines.push(...this.renderList(block, 0));
          lines.push('');
          break;

        case 'blockquote':
          const quoteLines = this.renderBlocks(block.content);
          lines.push(...quoteLines.map(line => (line ? `> ${line}` : '>')));
          lines.push('');
          break;

        case 'hr':
          lines.push('---');
          lines.push('');
          break;

        case 'image':
          const alt = block.alt || 'image';
          const title = block.title ? ` "${block.title}"` : '';
          // Use HTML img tag if we have dimensions, otherwise use Markdown syntax
          if (block.width || block.height) {
            const width = block.width ? ` width="${block.width}"` : '';
            const height = block.height ? ` height="${block.height}"` : '';
            lines.push(`<img src="${block.url}" alt="${alt}"${width}${height}>`);
          } else {
            lines.push(`![${alt}](${block.url}${title})`);
          }
          lines.push('');
          break;

        case 'table':
          lines.push(...this.renderTable(block));
          lines.push('');
          break;
      }
    }

    return lines;
  }

  /**
   * Render a table to markdown
   */
  private renderTable(block: any): string[] {
    const lines: string[] = [];

    // Render headers if present
    if (block.headers && block.headers.length > 0) {
      const headerCells = block.headers.map((cell: InlineContent[]) =>
        this.renderInline(cell).trim() || ' '
      );
      lines.push(`| ${headerCells.join(' | ')} |`);

      // Separator row
      const separators = headerCells.map(() => '---');
      lines.push(`| ${separators.join(' | ')} |`);
    }

    // Render body rows
    if (block.rows && block.rows.length > 0) {
      for (const row of block.rows) {
        const rowCells = row.map((cell: InlineContent[]) =>
          this.renderInline(cell).trim() || ' '
        );
        lines.push(`| ${rowCells.join(' | ')} |`);
      }
    }

    return lines;
  }

  /**
   * Render a list to markdown
   */
  private renderList(block: any, depth: number): string[] {
    const lines: string[] = [];
    const indent = '  '.repeat(depth);

    block.items.forEach((item: any, index: number) => {
      const prefix = block.ordered ? `${index + 1}.` : '-';
      const content = this.renderInline(item.content).trim();

      // Put content on the same line as the bullet/number
      if (content) {
        lines.push(`${indent}${prefix} ${content}`);
      }

      if (item.nested) {
        lines.push(...this.renderList(item.nested, depth + 1));
      }
    });

    return lines;
  }

  /**
   * Render inline content to markdown
   */
  private renderInline(content: InlineContent[]): string {
    return content
      .map(item => {
        switch (item.type) {
          case 'text':
            return item.text;

          case 'bold':
            return `**${item.text}**`;

          case 'italic':
            return `*${item.text}*`;

          case 'code':
            return `\`${item.text}\``;

          case 'link':
            return `[${item.text}](${item.url})`;

          case 'strikethrough':
            return `~~${item.text}~~`;

          default:
            return item.text;
        }
      })
      .join('');
  }
}
