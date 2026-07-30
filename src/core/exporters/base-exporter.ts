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
import {
  displayName,
  getMessage,
  getPlatformName,
  getRoleName as localizedRoleName,
  getUILanguage,
} from '../../shared/i18n';

/**
 * Seconds -> "M:SS", or "H:MM:SS" once it passes an hour. Format-agnostic: the
 * six exporters all read it through `mediaLabel()`.
 */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(secs).padStart(2, '0')}`;
}

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
  protected createSuccessResult(content: string | Blob, filename: string): ExportResult {
    const blob = content instanceof Blob ? content : new Blob([content], { type: this.mimeType });

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
   * Format a timestamp for display, e.g. "2026-07-29 12:00:00".
   *
   * Local time (D-18): a reader's own clock, not UTC -- `toISOString()` used
   * to render every stamp in UTC regardless of where the reader was, so a
   * user in UTC+2 read a time two hours off from what actually happened.
   */
  protected formatTimestamp(date?: Date): string {
    if (!date) return '';
    const pad = (n: number): string => String(n).padStart(2, '0');
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    return `${y}-${m}-${d} ${this.formatTime(date)}`;
  }

  /**
   * Time of day only, e.g. "12:00:00". Local time, like `formatTimestamp` —
   * every stamp in an export reads off one clock (the reader's own), so the
   * day separators below cut on the same boundaries the times imply.
   */
  protected formatTime(date?: Date): string {
    if (!date) return '';
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  /**
   * A calendar day in the export locale and the reader's local time zone,
   * e.g. "29 jul 2026" / "Jul 29, 2026".
   */
  protected formatDay(date: Date): string {
    return date.toLocaleDateString(getUILanguage(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  /**
   * Format a per-message timestamp suffix to append after a role label,
   * e.g. " (12:00:00)". The date is deliberately absent: with timestamps on,
   * the day is announced once by a day separator (see `daySeparator`) instead
   * of being repeated on every message. Returns '' when timestamps are
   * disabled or the message has no timestamp, so callers can always append the
   * result directly without a separate presence check.
   */
  protected formatTimestampSuffix(date: Date | undefined, includeTimestamps: boolean): string {
    if (!includeTimestamps) return '';
    const formatted = this.formatTime(date);
    return formatted ? ` (${formatted})` : '';
  }

  /**
   * First and last message instants across the exported pairs, or null when no
   * message carries a timestamp. json reports these raw; every other format
   * renders `formatDateRange` instead.
   */
  protected dateBounds(
    pairs: readonly { question: { timestamp?: Date }; answer: { timestamp?: Date } }[]
  ): { from: Date; to: Date } | null {
    const times = pairs
      .flatMap((pair) => [pair.question.timestamp, pair.answer.timestamp])
      .filter((date): date is Date => date instanceof Date)
      .map((date) => date.getTime());
    if (times.length === 0) return null;

    return { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)) };
  }

  /**
   * The conversation's date range for the export header: a single day when it
   * all happened on one, otherwise "first – last". '' when no message carries a
   * timestamp, so callers can drop the whole line.
   */
  protected formatDateRange(
    pairs: readonly { question: { timestamp?: Date }; answer: { timestamp?: Date } }[]
  ): string {
    const bounds = this.dateBounds(pairs);
    if (!bounds) return '';

    const first = this.formatDay(bounds.from);
    const last = this.formatDay(bounds.to);
    return first === last ? first : `${first} – ${last}`;
  }

  /**
   * Day-separator emitter, one per export.
   *
   * Returns a function that yields "— 29 jul 2026 —" the first time a message
   * lands on a new day and '' otherwise (including for the very first day —
   * a single-day conversation gets no separator at all). Feed it every message
   * in render order; each exporter then only decides how to draw the line, not
   * when to draw it.
   */
  protected daySeparator(includeTimestamps: boolean): (date?: Date) => string {
    let lastDay: string | null = null;
    return (date?: Date): string => {
      if (!includeTimestamps || !date) return '';
      // Local calendar day, matching `formatDay`/`formatTimestamp` below.
      const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      if (day === lastDay) return '';
      const isFirstDay = lastDay === null;
      lastDay = day;
      return isFirstDay ? '' : `— ${this.formatDay(date)} —`;
    };
  }

  /**
   * Label for a playable media block, e.g. "Video: Lighthouse timelapse (2:14)".
   * Callers wrap it per format ("[...]", a markdown link, an <a>), so appending
   * the duration here is what puts it in every format at once.
   */
  protected mediaLabel(block: MediaBlock): string {
    const kind = block.kind === 'video' ? 'Video' : 'Audio';
    const label = block.alt ? `${kind}: ${block.alt}` : kind;
    // A 0/absent duration says nothing; only render a real one.
    return block.duration ? `${label} (${formatDuration(block.duration)})` : label;
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
  protected getMetadataLabel(
    field: 'platform' | 'model' | 'exported' | 'url' | 'dateRange'
  ): string {
    const keyMap = {
      platform: 'metadataFieldPlatform',
      model: 'metadataFieldModel',
      exported: 'metadataFieldExported',
      url: 'metadataFieldURL',
      dateRange: 'metadataFieldDateRange',
    };
    return getMessage(keyMap[field]);
  }

  /**
   * Get role name for display
   */
  protected getRoleName(role: string, platform?: string): string {
    // If platform is specified, try to get platform-specific assistant name
    if (role === 'assistant' && platform) {
      const key = `role${displayName(platform)}`;
      const message = getMessage(key);
      if (message !== key) return message;
    }

    // Fallback to generic role name
    return localizedRoleName(role);
  }
}
