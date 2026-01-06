/**
 * Markdown format exporter
 */

import type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  Conversation,
  QAPair,
} from '../types';
import { BaseExporter } from './base-exporter';

/**
 * Exports conversations to Markdown format
 */
export class MarkdownExporter extends BaseExporter {
  readonly format: ExportFormat = 'md';
  readonly extension = 'md';
  readonly mimeType = 'text/markdown';

  /**
   * Export selected Q&A pairs to Markdown
   */
  async export(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      const content = this.generateMarkdown(conversation, selectedPairs, options);
      return this.createSuccessResult(content, options.filename);
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Failed to export to Markdown'
      );
    }
  }

  /**
   * Generate Markdown content
   */
  private generateMarkdown(
    conversation: Conversation,
    pairs: QAPair[],
    options: ExportOptions
  ): string {
    const lines: string[] = [];

    // Title
    lines.push(`# ${conversation.title}`);
    lines.push('');

    // Metadata section
    if (options.includeMetadata) {
      lines.push(`**Platform:** ${this.formatPlatformName(conversation.platform)}`);
      if (conversation.model) {
        lines.push(`**Model:** ${conversation.model}`);
      }
      if (conversation.createdAt) {
        lines.push(`**Exported:** ${this.formatTimestamp(conversation.createdAt)}`);
      }
      lines.push(`**URL:** ${conversation.url}`);
      lines.push('---');
      lines.push('');
    }

    // Q&A pairs
    for (const pair of pairs) {
      lines.push(...this.formatPair(pair, options));
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format a single Q&A pair
   */
  private formatPair(pair: QAPair, options: ExportOptions): string[] {
    const lines: string[] = [];

    // User message
    lines.push('## User');
    if (options.includeTimestamps && pair.question.timestamp) {
      lines.push(`*${this.formatTimestamp(pair.question.timestamp)}*`);
      lines.push('');
    }
    lines.push(pair.question.content);
    lines.push('');

    // Assistant message
    lines.push('## Assistant');
    if (options.includeTimestamps && pair.answer.timestamp) {
      lines.push(`*${this.formatTimestamp(pair.answer.timestamp)}*`);
      lines.push('');
    }
    lines.push(pair.answer.content);

    return lines;
  }
}
