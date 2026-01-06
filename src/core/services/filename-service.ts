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
 * Maximum filename length (excluding extension)
 */
const MAX_FILENAME_LENGTH = 200;

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

    // Truncate to max length
    if (sanitized.length > MAX_FILENAME_LENGTH) {
      sanitized = sanitized.substring(0, MAX_FILENAME_LENGTH);
      // Trim trailing hyphen if truncation created one
      sanitized = sanitized.replace(/-+$/, '');
    }

    return sanitized;
  }

  /**
   * Get filename variables from conversation
   */
  static getVariablesFromConversation(conversation: Conversation): FilenameVariables {
    const date = conversation.createdAt || new Date();

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
