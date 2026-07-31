/**
 * Shared constants for the AI Chat Exporter extension
 */

import type { UserPreferences } from './messages';
import type { ThemePreference } from '../core/types/config';

export const EXTENSION_NAME = 'AI Chat Exporter';

/**
 * Storage keys
 */
export const STORAGE_KEYS = {
  USER_PREFERENCES: 'user_preferences',
  LAST_EXPORT_FORMAT: 'last_export_format',
  SELECTION_STATE: 'selection_state',
  THEME_PREFERENCE: 'theme_preference',
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
  showMetaInfo: true,
  includeCodeBlocks: true,
  fontScale: 'normal',
  filenameTemplate: '{title}_{date}',
  defaultFormat: 'pdf' as const,
  autoSelectAll: true,
};

/**
 * Default popup theme preference. Stored separately from `UserPreferences`
 * (see `StorageService.getThemePreference`) -- it is popup-only app
 * configuration, not an export option, so it must not trip the Options row's
 * changed-from-default dot, which is derived from `DEFAULT_PREFERENCES` alone.
 */
export const DEFAULT_THEME: ThemePreference = 'auto';

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
 * when Claude or ChatGPT enrichment degrades an export, so the popup
 * resolves the user-facing text with `getMessage()` instead of the content
 * script hardcoding English prose.
 */
export const WARNING_KEYS = {
  /** The page's own conversation/organization id couldn't be read — reload/sign-in fixes it, not a retry. */
  IDS_MISSING: 'warningArtifactsIdsMissing',
  /** The Claude API call for enrichment data failed or returned nothing — can be a one-off network blip. */
  FETCH_FAILED: 'warningArtifactsFetchFailed',
  /** lo-08d3: the page's own ChatGPT conversation id couldn't be read — reload/sign-in fixes it, not a retry. */
  CHATGPT_IDS_MISSING: 'warningChatGPTIdsMissing',
  /** lo-08d3: the ChatGPT backend call for per-message timestamps failed or returned nothing — can be a one-off network blip. */
  CHATGPT_FETCH_FAILED: 'warningChatGPTFetchFailed',
  /** The PDF's embedded fonts can't render some script in the conversation (CJK/Arabic/Hebrew/Cyrillic/...) — those characters were replaced with a placeholder. Not retryable; DOCX/HTML render them correctly instead. */
  PDF_UNSUPPORTED_SCRIPT: 'warningPdfUnsupportedScript',
} as const;

/**
 * Warning keys whose underlying cause could plausibly clear on a second
 * attempt. The popup only offers Retry for a key in this set — never by
 * matching on the (translated) message text.
 */
export const RETRYABLE_WARNING_KEYS: ReadonlySet<string> = new Set([
  WARNING_KEYS.FETCH_FAILED,
  WARNING_KEYS.CHATGPT_FETCH_FAILED,
]);

/**
 * Locale keys the content script throws (as `Error.message`, carried to the
 * popup as `MessageResponse.error`) for a genuine export/print failure —
 * same idea as `WARNING_KEYS`, but for "nothing usable came out" instead of
 * "it worked, but degraded". The popup resolves these with `getMessage()`
 * instead of showing the content script's raw (English) exception text.
 */
export const ERROR_KEYS = {
  /** No parser matched the page, or the one that did failed to produce a conversation. */
  NO_CONVERSATION: 'errorNoConversationParsed',
  /** Zero pairs survive to export/print — nothing was parsed, or the popup's selection matched nothing left on a fresh re-parse. */
  NOTHING_TO_EXPORT: 'errorNothingToExport',
  /** `window.open()` for the print preview was blocked by the browser's popup blocker. */
  PRINT_POPUP_BLOCKED: 'errorPrintPopupBlocked',
  /** `getExporter(format)` returned nothing — should be unreachable from the popup's format list, kept as a defensive guard. */
  NO_EXPORTER: 'errorNoExporterForFormat',
} as const;

/**
 * Button injection retry settings
 */
export const INJECTION_CONFIG = {
  MAX_RETRIES: 10,
  RETRY_DELAY: 500,
  OBSERVER_TIMEOUT: 30000,
};
