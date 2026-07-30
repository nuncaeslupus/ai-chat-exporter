/**
 * Message types and interfaces for extension communication
 */

import type { ExportFormat, FilenamePreferences, FontScale } from '../core/types';
import type { DriftReport } from '../core/drift/types';
import { MESSAGE_TYPES } from './constants';

/**
 * Base message interface
 */
interface BaseMessage<T extends string = string> {
  type: T;
  timestamp: number;
}

/**
 * Export conversation message
 *
 * `selectedIndices` is optional: the popup's selection UI sends the indices
 * of the pairs to export, but the context-menu / keyboard-shortcut senders
 * (service worker) have no selection UI and omit it, meaning "export
 * everything" (see `applySelection` in content-script.ts).
 */
export interface ExportConversationMessage extends BaseMessage<'export_conversation'> {
  format: ExportFormat;
  selectedIndices?: number[];
}

/**
 * Print conversation message
 *
 * See `ExportConversationMessage` for `selectedIndices` semantics.
 */
export interface PrintConversationMessage extends BaseMessage<'print_conversation'> {
  format: ExportFormat;
  selectedIndices?: number[];
}

/**
 * Get conversation message
 */
export type GetConversationMessage = BaseMessage<'get_conversation'>;

/**
 * The popup asking the content script for a structural skeleton of the current
 * page. Built on demand: a user who never opens the report view never has one.
 */
export interface GetDriftSkeletonMessage {
  type: typeof MESSAGE_TYPES.GET_DRIFT_SKELETON;
}

export function isGetDriftSkeletonMessage(message: unknown): message is GetDriftSkeletonMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === MESSAGE_TYPES.GET_DRIFT_SKELETON
  );
}

/**
 * User preferences interface
 */
export interface UserPreferences extends FilenamePreferences {
  includeMetadata: boolean;
  includeTimestamps: boolean;
  includeCodeBlocks: boolean;
  /** Type-size step applied to pdf/docx/html exports. */
  fontScale: FontScale;
  defaultFormat: ExportFormat;
  autoSelectAll: boolean;
}

/**
 * Message response interface
 */
export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** Set when the operation succeeded but the result is degraded. */
  warning?: string;
  /** Carried alongside `data` by `GET_CONVERSATION`; content-free by construction. */
  drift?: DriftReport;
}

/**
 * Type guard for export conversation message
 */
export function isExportConversationMessage(msg: unknown): msg is ExportConversationMessage {
  return (
    typeof msg === 'object' && msg !== null && 'type' in msg && msg.type === 'export_conversation'
  );
}

/**
 * Type guard for print conversation message
 */
export function isPrintConversationMessage(msg: unknown): msg is PrintConversationMessage {
  return (
    typeof msg === 'object' && msg !== null && 'type' in msg && msg.type === 'print_conversation'
  );
}

/**
 * Type guard for get conversation message
 */
export function isGetConversationMessage(msg: unknown): msg is GetConversationMessage {
  return (
    typeof msg === 'object' && msg !== null && 'type' in msg && msg.type === 'get_conversation'
  );
}

/**
 * Create a message with timestamp
 */
export function createMessage<T extends BaseMessage>(
  type: T['type'],
  data: Omit<T, 'type' | 'timestamp'>
): T {
  return {
    type,
    timestamp: Date.now(),
    ...data,
  } as T;
}
