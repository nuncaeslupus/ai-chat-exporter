/**
 * Shared constants for the AI Chat Exporter extension
 */

export const EXTENSION_NAME = 'AI Chat Exporter';
export const EXTENSION_VERSION = '1.0.0';

/**
 * Storage keys
 */
export const STORAGE_KEYS = {
  USER_PREFERENCES: 'user_preferences',
  LAST_EXPORT_FORMAT: 'last_export_format',
  SELECTION_STATE: 'selection_state',
} as const;

/**
 * Message types for extension communication
 */
export const MESSAGE_TYPES = {
  EXPORT_CONVERSATION: 'export_conversation',
  PRINT_CONVERSATION: 'print_conversation',
  GET_CONVERSATION: 'get_conversation',
  UPDATE_PREFERENCES: 'update_preferences',
  SHOW_NOTIFICATION: 'show_notification',
} as const;

/**
 * Default user preferences
 */
export const DEFAULT_PREFERENCES = {
  includeMetadata: true,
  includeCodeBlocks: true,
  filenameTemplate: '{title}_{date}',
  defaultFormat: 'pdf' as const,
  autoSelectAll: true,
};

/**
 * Supported platforms
 */
export const PLATFORMS = {
  CHATGPT: 'chatgpt',
  CLAUDE: 'claude',
  GEMINI: 'gemini',
  MISTRAL: 'mistral',
  GROK: 'grok',
} as const;

/**
 * Export formats
 */
export const EXPORT_FORMATS = {
  PDF: 'pdf',
  MARKDOWN: 'md',
  TEXT: 'txt',
  JSON: 'json',
  DOCX: 'docx',
} as const;

/**
 * Toast notification duration (ms)
 */
export const TOAST_DURATION = 3000;

/**
 * Button injection retry settings
 */
export const INJECTION_CONFIG = {
  MAX_RETRIES: 10,
  RETRY_DELAY: 500,
  OBSERVER_TIMEOUT: 30000,
};
