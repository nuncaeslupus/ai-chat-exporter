/**
 * Shared constants for the AI Chat Exporter extension
 */

import type { UserPreferences } from './messages';

export const EXTENSION_NAME = 'AI Chat Exporter';

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
  GET_DRIFT_SKELETON: 'get_drift_skeleton',
  UPDATE_PREFERENCES: 'update_preferences',
  SHOW_NOTIFICATION: 'show_notification',
} as const;

/**
 * Default user preferences
 */
export const DEFAULT_PREFERENCES: UserPreferences = {
  includeMetadata: true,
  includeTimestamps: true,
  includeCodeBlocks: true,
  fontScale: 'normal',
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
 * Locale keys the content script hands back (as `MessageResponse.warning`)
 * when Claude enrichment degrades an export, so the popup resolves the
 * user-facing text with `getMessage()` instead of the content script
 * hardcoding English prose.
 */
export const WARNING_KEYS = {
  /** The page's own conversation/organization id couldn't be read — reload/sign-in fixes it, not a retry. */
  IDS_MISSING: 'warningArtifactsIdsMissing',
  /** The Claude API call for enrichment data failed or returned nothing — can be a one-off network blip. */
  FETCH_FAILED: 'warningArtifactsFetchFailed',
} as const;

/**
 * Warning keys whose underlying cause could plausibly clear on a second
 * attempt. The popup only offers Retry for a key in this set — never by
 * matching on the (translated) message text.
 */
export const RETRYABLE_WARNING_KEYS: ReadonlySet<string> = new Set([WARNING_KEYS.FETCH_FAILED]);

/**
 * Button injection retry settings
 */
export const INJECTION_CONFIG = {
  MAX_RETRIES: 10,
  RETRY_DELAY: 500,
  OBSERVER_TIMEOUT: 30000,
};
