/**
 * Configuration types for user preferences
 */

/**
 * Filename template variables
 */
export interface FilenameVariables {
  /** Platform name (e.g., "ChatGPT") */
  platform: string;
  /** Conversation title */
  title: string;
  /** Date in YYYY-MM-DD format */
  date: string;
  /** Time in HH-MM format */
  time: string;
  /** Full datetime in YYYY-MM-DD_HH-MM format */
  datetime: string;
  /** Number of question/answer pairs, when the caller knows the conversation */
  pairCount?: string;
  /** Model name if available */
  model?: string;
}

/**
 * A piece of the filename the user composes in the popup.
 *
 * An ordered array, not a template string: the popup edits the pieces
 * directly, so storing a string would mean parsing it back on every open.
 * `text` belongs to `literal` alone — the free-text chip.
 */
export type FilenamePieceType =
  | 'platform'
  | 'model'
  | 'title'
  | 'date'
  | 'time'
  | 'pairCount'
  | 'literal';

export interface FilenamePiece {
  type: FilenamePieceType;
  /** Only meaningful for `literal`. */
  text?: string;
}

/**
 * The filename-shaping half of the user preferences, so the renderer can be
 * handed preferences without `src/core` having to know about the extension's
 * message types.
 *
 * `filenamePieces` is deliberately optional: absent means "never touched the
 * builder", and that case must keep rendering the legacy template string
 * byte for byte.
 */
export interface FilenamePreferences {
  filenameTemplate: string;
  filenamePieces?: FilenamePiece[] | undefined;
}

/**
 * The piece list the builder starts from and `Default` restores. Renders to
 * `{title}_{date}`.
 */
export const DEFAULT_FILENAME_PIECES: FilenamePiece[] = [{ type: 'title' }, { type: 'date' }];

/**
 * Popup-only theme preference. `auto` follows the OS via
 * `prefers-color-scheme`; `light`/`dark` pin the popup to one palette
 * regardless of the OS, via a `data-theme` attribute on the document root
 * (see popup.css). Exported HTML is out of scope -- it keeps its own
 * `prefers-color-scheme` block and adapts to whoever opens the file.
 */
export type ThemePreference = 'light' | 'dark' | 'auto';
