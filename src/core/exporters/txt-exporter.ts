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
  InlineContent,
} from '../types';
import { BaseExporter } from './base-exporter';
import { ConversationStructureService } from '../services';

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
  private generateText(
    conversation: any, // StructuredConversation
    options: ExportOptions
  ): string {
    const lines: string[] = [];

    // Title
    lines.push(conversation.title);
    lines.push('='.repeat(conversation.title.length));
    lines.push('');

    // Metadata section
    if (options.includeMetadata) {
      lines.push(`Platform: ${this.formatPlatformName(conversation.platform)}`);
      if (conversation.model) {
        lines.push(`Model: ${conversation.model}`);
      }
      if (conversation.createdAt) {
        lines.push(`Exported: ${this.formatTimestamp(conversation.createdAt)}`);
      }
      lines.push(`URL: ${conversation.url}`);
      lines.push('');
      lines.push('-'.repeat(40));
      lines.push('');
    }

    // Q&A pairs
    const assistantName = this.getAssistantName(conversation.platform);
    for (let i = 0; i < conversation.pairs.length; i++) {
      const pair = conversation.pairs[i];
      if (pair) {
        lines.push(...this.formatPair(pair, assistantName, options));
        if (i < conversation.pairs.length - 1) {
          lines.push('');
          lines.push('-'.repeat(40));
          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Format a single Q&A pair
   */
  private formatPair(pair: any, assistantName: string, options: ExportOptions): string[] {
    const lines: string[] = [];

    // User message
    lines.push(`User${this.formatTimestampSuffix(pair.question.timestamp, options.includeTimestamps)}:`);
    lines.push(...this.renderBlocks(pair.question.blocks));
    lines.push('');

    // Assistant message
    lines.push(`${assistantName}${this.formatTimestampSuffix(pair.answer.timestamp, options.includeTimestamps)}:`);
    lines.push(...this.renderBlocks(pair.answer.blocks));

    // Add artifacts if present
    if (pair.answer.metadata?.artifacts && Array.isArray(pair.answer.metadata.artifacts)) {
      const artifactsWithContent = pair.answer.metadata.artifacts.filter((a: any) => a.content);

      if (artifactsWithContent.length > 0) {
        lines.push('');
        lines.push('Artifacts:');
        lines.push('');

        for (const artifact of artifactsWithContent) {
          lines.push(`--- ${artifact.title} ---`);
          if (artifact.typeLabel) {
            lines.push(`Type: ${artifact.typeLabel}`);
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
        lines.push(`Sources — ${search.query || 'References'}:`);
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
  private renderBlocks(blocks: StructuredContentBlock[]): string[] {
    const lines: string[] = [];

    for (const block of blocks) {
      switch (block.type) {
        case 'paragraph':
          const text = this.inlineToText(block.content);
          if (text.trim()) {
            lines.push(text);
            lines.push('');
          }
          break;

        case 'heading':
          const headingText = this.inlineToText(block.content);
          if (headingText.trim()) {
            lines.push('');
            lines.push(headingText);
            lines.push('~'.repeat(headingText.length));
            lines.push('');
          }
          break;

        case 'code':
          lines.push('');
          if (block.language) {
            lines.push(`[${block.language}]`);
          }
          lines.push(block.code);
          lines.push('');
          break;

        case 'list':
          lines.push(...this.renderList(block, 0));
          lines.push('');
          break;

        case 'blockquote':
          lines.push('');
          const quoteLines = this.renderBlocks(block.content);
          for (const line of quoteLines) {
            if (line.trim()) {
              lines.push(`> ${line}`);
            } else {
              lines.push('>');
            }
          }
          lines.push('');
          break;

        case 'hr':
          lines.push('');
          lines.push('-'.repeat(40));
          lines.push('');
          break;

        case 'image':
          lines.push('');
          lines.push(`[Image: ${block.alt || 'image'}]`);
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
  private renderTable(block: any): string[] {
    const lines: string[] = [];
    const allRows: string[][] = [];

    // Collect all cells from headers and body
    if (block.headers && block.headers.length > 0) {
      allRows.push(
        block.headers.map((cell: InlineContent[]) => this.inlineToText(cell).trim())
      );
    }

    if (block.rows && block.rows.length > 0) {
      for (const row of block.rows) {
        allRows.push(row.map((cell: InlineContent[]) => this.inlineToText(cell).trim()));
      }
    }

    if (allRows.length === 0) return lines;

    // Calculate column widths
    const numCols = Math.max(...allRows.map(row => row.length));
    const colWidths: number[] = [];

    for (let col = 0; col < numCols; col++) {
      const maxWidth = Math.max(
        ...allRows.map(row => (row[col] || '').length),
        3 // Minimum width
      );
      colWidths.push(maxWidth);
    }

    // Render rows
    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      if (!row) continue;
      const cells = row.map((cell, j) => cell.padEnd(colWidths[j] || 0));
      lines.push(`| ${cells.join(' | ')} |`);

      // Add separator after header row
      if (i === 0 && block.headers && block.headers.length > 0) {
        const separators = colWidths.map(w => '-'.repeat(w));
        lines.push(`| ${separators.join(' | ')} |`);
      }
    }

    return lines;
  }

  /**
   * Render a list to plain text lines
   */
  private renderList(block: any, depth: number): string[] {
    const lines: string[] = [];
    const indent = '  '.repeat(depth);

    for (let i = 0; i < block.items.length; i++) {
      const item = block.items[i];
      const prefix = block.ordered ? `${i + 1}.` : '-';
      const text = this.inlineToText(item.content);

      if (text.trim()) {
        lines.push(`${indent}${prefix} ${text}`);
      }

      if (item.nested) {
        lines.push(...this.renderList(item.nested, depth + 1));
      }
    }

    return lines;
  }

  /**
   * Convert inline content to plain text
   */
  private inlineToText(content: InlineContent[]): string {
    return content
      .map(item =>
        item.type === 'link' && item.url && item.url !== item.text
          ? `${item.text} (${item.url})`
          : item.text
      )
      .join('');
  }

  /**
   * Get assistant name based on platform
   */
  private getAssistantName(platform: string): string {
    const platformNames: Record<string, string> = {
      chatgpt: 'ChatGPT',
      claude: 'Claude',
      gemini: 'Gemini',
    };

    return platformNames[platform] || 'Assistant';
  }
}
