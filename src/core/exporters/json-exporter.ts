/**
 * JSON format exporter
 */

import type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  Conversation,
  QAPair,
  MessageMetadata,
} from '../types';
import { BaseExporter } from './base-exporter';

/**
 * JSON export structure
 */
export interface JsonExport {
  /**
   * Schema revision. Bumped to 2 by R-1's redesign, which changed the shape a
   * consumer sees: timestamps carry a UTC offset rather than being normalized
   * to `Z`, and the key order is now declared rather than incidental.
   */
  schemaVersion: number;
  /**
   * The optional fields admit an explicit `undefined` (not just absence) because
   * the object is built as one literal to fix the key order — see
   * `generateJson`. `JSON.stringify` drops them, so the emitted document is
   * unchanged; this only lets the literal name every key under
   * `exactOptionalPropertyTypes`.
   */
  title?: string | undefined;
  platform?: string | undefined;
  model?: string | undefined;
  url?: string | undefined;
  exportedAt: string;
  createdAt?: string | undefined;
  /**
   * Conversation date range as ISO bounds. The other formats render this as a
   * localized header line; json keeps the raw instants so a consumer can format
   * (or re-range) it itself. Absent when no message carries a timestamp.
   */
  dateRange?: { from: string; to: string } | undefined;
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
  metadata?: MessageMetadata; // Include images, artifacts, web searches, etc.
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
    const meta = options.showMetaInfo;
    const bounds = meta ? this.dateBounds(pairs) : null;

    /**
     * One literal, in a declared order (R-7). It used to be built by assigning
     * conditionally, so the key order fell out of which fields happened to
     * exist — `pairs` landed second, ahead of the metadata, and a conversation
     * without a model shifted every key after it. A diff between two exports
     * was unreadable as a result. `undefined` values are dropped by
     * `JSON.stringify`, so absent fields cost nothing but do not reorder
     * anything either.
     */
    const exportData: JsonExport = {
      schemaVersion: 2,
      title: meta ? conversation.title : undefined,
      platform: meta ? conversation.platform : undefined,
      model: meta && conversation.model ? conversation.model : undefined,
      url: meta ? conversation.url : undefined,
      exportedAt: this.toIsoWithOffset(new Date()),
      createdAt:
        meta && conversation.createdAt ? this.toIsoWithOffset(conversation.createdAt) : undefined,
      dateRange: bounds
        ? { from: this.toIsoWithOffset(bounds.from), to: this.toIsoWithOffset(bounds.to) }
        : undefined,
      pairs: pairs.map((pair, index) => this.formatPair(pair, index, options)),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * ISO-8601 in local time with an explicit UTC offset, e.g.
   * `2026-07-29T15:12:04+02:00`.
   *
   * `toISOString()` normalizes to `Z`, which silently discards where the
   * conversation happened — a reader in UTC+2 could not tell 15:12 local from
   * 15:12 UTC. The same instant, with the offset kept, round-trips through
   * `new Date()` unchanged.
   */
  private toIsoWithOffset(date: Date): string {
    const pad = (n: number): string => String(Math.floor(Math.abs(n))).padStart(2, '0');
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes < 0 ? '-' : '+';
    const offset = `${sign}${pad(offsetMinutes / 60)}:${pad(offsetMinutes % 60)}`;
    return (
      `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`
    );
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

    if (options.showMetaInfo) {
      if (pair.question.timestamp) {
        jsonPair.question.timestamp = this.toIsoWithOffset(pair.question.timestamp);
      }
      if (pair.answer.timestamp) {
        jsonPair.answer.timestamp = this.toIsoWithOffset(pair.answer.timestamp);
      }
    }

    return jsonPair;
  }
}
