/**
 * Base exporter with common functionality for all format exporters
 */

import type {
  IExporter,
  ExportFormat,
  ExportOptions,
  ExportResult,
  Conversation,
  MediaBlock,
  QAPair,
} from '../types';
import { getMessage, getPlatformName } from '../../shared/i18n';

/**
 * Abstract base class for format-specific exporters
 */
export abstract class BaseExporter implements IExporter {
  abstract readonly format: ExportFormat;
  abstract readonly extension: string;
  abstract readonly mimeType: string;

  /**
   * Export selected Q&A pairs from a conversation
   */
  abstract export(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult>;

  /**
   * Validate options for this exporter
   */
  validateOptions(options: ExportOptions): boolean {
    if (options.format !== this.format) {
      return false;
    }
    if (!options.filename || options.filename.trim() === '') {
      return false;
    }
    return true;
  }

  /**
   * Create a successful export result
   */
  protected createSuccessResult(
    content: string | Blob,
    filename: string
  ): ExportResult {
    const blob =
      content instanceof Blob
        ? content
        : new Blob([content], { type: this.mimeType });

    return {
      success: true,
      blob,
      filename: `${filename}.${this.extension}`,
      mimeType: this.mimeType,
    };
  }

  /**
   * Create an error export result
   */
  protected createErrorResult(error: string): ExportResult {
    return {
      success: false,
      error,
    };
  }

  /**
   * Format a timestamp for display
   */
  protected formatTimestamp(date?: Date): string {
    if (!date) return '';
    return date.toISOString().replace('T', ' ').substring(0, 19);
  }

  /**
   * Format a per-message timestamp suffix to append after a role label,
   * e.g. " (2025-01-01 12:00:00)". Returns '' when timestamps are disabled
   * or the message has no timestamp, so callers can always append the
   * result directly without a separate presence check.
   */
  protected formatTimestampSuffix(date: Date | undefined, includeTimestamps: boolean): string {
    if (!includeTimestamps) return '';
    const formatted = this.formatTimestamp(date);
    return formatted ? ` (${formatted})` : '';
  }

  /**
   * Label for a playable media block, e.g. "Video: Lighthouse timelapse".
   * Callers wrap it per format ("[...]", a markdown link, an <a>).
   */
  protected mediaLabel(block: MediaBlock): string {
    const kind = block.kind === 'video' ? 'Video' : 'Audio';
    return block.alt ? `${kind}: ${block.alt}` : kind;
  }

  /**
   * Format platform name for display
   */
  protected formatPlatformName(platform: string): string {
    return getPlatformName(platform);
  }

  /**
   * Get metadata field label
   */
  protected getMetadataLabel(field: 'platform' | 'model' | 'exported' | 'url'): string {
    const keyMap = {
      platform: 'metadataFieldPlatform',
      model: 'metadataFieldModel',
      exported: 'metadataFieldExported',
      url: 'metadataFieldURL',
    };
    return getMessage(keyMap[field]);
  }

  /**
   * Get role name for display
   */
  protected getRoleName(role: string, platform?: string): string {
    // If platform is specified, try to get platform-specific assistant name
    if (role === 'assistant' && platform) {
      const key = `role${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
      const message = getMessage(key);
      if (message !== key) return message;
    }

    // Fallback to generic role name
    const key = `role${role.charAt(0).toUpperCase()}${role.slice(1)}`;
    const message = getMessage(key);
    return message !== key ? message : role.charAt(0).toUpperCase() + role.slice(1);
  }
}
