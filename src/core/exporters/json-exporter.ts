/**
 * JSON format exporter
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
 * JSON export structure
 */
interface JsonExport {
  title: string;
  platform: string;
  model?: string;
  url: string;
  exportedAt: string;
  createdAt?: string;
  pairs: JsonPair[];
}

interface JsonPair {
  index: number;
  question: JsonMessage;
  answer: JsonMessage;
}

interface JsonMessage {
  role: string;
  content: string;
  htmlContent?: string;
  timestamp?: string;
  metadata?: any; // Include images, artifacts, web searches, etc.
}

/**
 * Exports conversations to JSON format
 */
export class JsonExporter extends BaseExporter {
  readonly format: ExportFormat = 'json';
  readonly extension = 'json';
  readonly mimeType = 'application/json';

  /**
   * Export selected Q&A pairs to JSON
   */
  async export(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      const content = this.generateJson(conversation, selectedPairs, options);
      return this.createSuccessResult(content, options.filename);
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Failed to export to JSON'
      );
    }
  }

  /**
   * Generate JSON content
   */
  private generateJson(
    conversation: Conversation,
    pairs: QAPair[],
    options: ExportOptions
  ): string {
    const exportData: JsonExport = {
      title: conversation.title,
      platform: conversation.platform,
      url: conversation.url,
      exportedAt: new Date().toISOString(),
      pairs: pairs.map((pair, index) => this.formatPair(pair, index, options)),
    };

    // Add optional metadata
    if (conversation.model) {
      exportData.model = conversation.model;
    }
    if (conversation.createdAt) {
      exportData.createdAt = conversation.createdAt.toISOString();
    }

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Format a single Q&A pair for JSON
   */
  private formatPair(pair: QAPair, index: number, options: ExportOptions): JsonPair {
    const jsonPair: JsonPair = {
      index,
      question: {
        role: pair.question.role,
        content: pair.question.content,
      },
      answer: {
        role: pair.answer.role,
        content: pair.answer.content,
      },
    };

    // Include HTML content if available for proper parsing later
    if (pair.question.htmlContent) {
      jsonPair.question.htmlContent = pair.question.htmlContent;
    }
    if (pair.answer.htmlContent) {
      jsonPair.answer.htmlContent = pair.answer.htmlContent;
    }

    // Include metadata (images, artifacts, web searches, etc.)
    if (pair.question.metadata) {
      jsonPair.question.metadata = pair.question.metadata;
    }
    if (pair.answer.metadata) {
      jsonPair.answer.metadata = pair.answer.metadata;
    }

    if (options.includeTimestamps) {
      if (pair.question.timestamp) {
        jsonPair.question.timestamp = pair.question.timestamp.toISOString();
      }
      if (pair.answer.timestamp) {
        jsonPair.answer.timestamp = pair.answer.timestamp.toISOString();
      }
    }

    return jsonPair;
  }
}
