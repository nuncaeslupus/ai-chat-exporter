/**
 * Filename Service
 * Handles filename generation from templates and sanitization
 */

import type { Conversation } from '../types/conversation';
import type { FilenameVariables } from '../types/config';

/**
 * Platform display names
 */
const PLATFORM_NAMES: Record<string, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  mistral: 'Mistral',
  grok: 'Grok',
};

/**
 * Filesystem filename byte ceiling (ext4/APFS/NTFS all cap at 255 bytes).
 */
const MAX_FILENAME_BYTES = 255;

/**
 * Bytes reserved for the extension the caller appends via addExtension()
 * (e.g. ".docx"). Longest current export extension is "docx" (4 chars);
 * this leaves margin for a few more.
 */
const EXTENSION_BYTE_RESERVE = 10;

/**
 * Byte budget for the filename stem, before the extension is appended.
 */
const MAX_STEM_BYTES = MAX_FILENAME_BYTES - EXTENSION_BYTE_RESERVE;

/**
 * Service for generating and sanitizing filenames
 */
export class FilenameService {
  /**
   * Generate filename from template and variables
   */
  static generateFilename(template: string, variables: FilenameVariables): string {
    let filename = template;

    // Replace all variables
    filename = filename.replace(/{platform}/g, variables.platform);
    filename = filename.replace(/{title}/g, variables.title);
    filename = filename.replace(/{date}/g, variables.date);
    filename = filename.replace(/{time}/g, variables.time);
    filename = filename.replace(/{datetime}/g, variables.datetime);

    // Handle optional model - remove if not present
    if (variables.model) {
      filename = filename.replace(/{model}/g, variables.model);
    } else {
      filename = filename.replace(/_{model}/g, '');
      filename = filename.replace(/{model}_/g, '');
      filename = filename.replace(/{model}/g, '');
    }

    // Clean up empty parts (e.g., "_{date}" when title is empty)
    filename = filename.replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
    filename = filename.replace(/_+/g, '_'); // Collapse multiple underscores

    // Sanitize the result
    return this.sanitizeFilename(filename);
  }

  /**
   * Sanitize filename by removing forbidden characters and applying rules
   */
  static sanitizeFilename(filename: string): string {
    // Remove forbidden characters: / \ : * ? " < > |
    let sanitized = filename.replace(/[/\\:*?"<>|]/g, '');

    // Replace spaces with hyphens
    sanitized = sanitized.replace(/\s+/g, '-');

    // Remove multiple consecutive hyphens
    sanitized = sanitized.replace(/-+/g, '-');

    // Trim leading and trailing hyphens
    sanitized = sanitized.replace(/^-+|-+$/g, '');

    // Truncate to the byte budget (filesystem limits are in bytes, not
    // UTF-16 code units — a 200-char CJK title is ~600 bytes).
    if (new TextEncoder().encode(sanitized).length > MAX_STEM_BYTES) {
      sanitized = this.truncateToByteLength(sanitized, MAX_STEM_BYTES);
      // Trim trailing hyphen if truncation created one
      sanitized = sanitized.replace(/-+$/, '');
    }

    return sanitized;
  }

  /**
   * Truncate a string so its UTF-8 encoding fits within maxBytes, cutting
   * only on code-point boundaries (never splits a surrogate pair into a
   * lone/invalid one). A multi-code-point grapheme cluster (e.g. a
   * combining mark, or an emoji ZWJ sequence) can still be split at its
   * boundary — that's a display quirk, not data corruption, and out of
   * scope here (would need Intl.Segmenter for full correctness).
   */
  private static truncateToByteLength(str: string, maxBytes: number): string {
    const encoder = new TextEncoder();
    let result = '';
    let byteLength = 0;
    for (const codePoint of str) {
      const codePointBytes = encoder.encode(codePoint).length;
      if (byteLength + codePointBytes > maxBytes) break;
      result += codePoint;
      byteLength += codePointBytes;
    }
    return result;
  }

  /**
   * Get filename variables from conversation
   */
  static getVariablesFromConversation(conversation: Conversation): FilenameVariables {
    // Re-wrap rather than trust the field: the popup reads the conversation
    // back over chrome.tabs.sendMessage, which JSON-serialises a Date to a
    // string, and a string has no getFullYear(). `new Date(aDate)` is a
    // no-op copy, so the content-script path is unaffected.
    const date = conversation.createdAt ? new Date(conversation.createdAt) : new Date();

    const variables: FilenameVariables = {
      platform: PLATFORM_NAMES[conversation.platform] || conversation.platform,
      title: conversation.title,
      date: this.formatDate(date),
      time: this.formatTime(date),
      datetime: this.formatDateTime(date),
    };

    // Only include model if it exists
    if (conversation.model) {
      variables.model = conversation.model;
    }

    return variables;
  }

  /**
   * Add extension to filename (replacing existing extension if present)
   */
  static addExtension(filename: string, extension: string): string {
    // Remove leading dot from extension if present
    const ext = extension.startsWith('.') ? extension.substring(1) : extension;

    // Remove existing extension
    const withoutExt = filename.replace(/\.[^.]*$/, '');

    // Handle empty filename
    if (withoutExt === '') {
      return `.${ext}`;
    }

    return `${withoutExt}.${ext}`;
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private static formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Format time as HH-MM
   */
  private static formatTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}-${minutes}`;
  }

  /**
   * Format datetime as YYYY-MM-DD_HH-MM
   */
  private static formatDateTime(date: Date): string {
    return `${this.formatDate(date)}_${this.formatTime(date)}`;
  }
}
