/**
 * Message types and interfaces for extension communication
 */

import type { ExportFormat } from '../core/types';

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
export interface GetConversationMessage extends BaseMessage<'get_conversation'> {
  // No additional data needed
}

/**
 * User preferences interface
 */
export interface UserPreferences {
  includeMetadata: boolean;
  includeTimestamps: boolean;
  includeCodeBlocks: boolean;
  filenameTemplate: string;
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
}

/**
 * Type guard for export conversation message
 */
export function isExportConversationMessage(
  msg: unknown,
): msg is ExportConversationMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    msg.type === 'export_conversation'
  );
}

/**
 * Type guard for print conversation message
 */
export function isPrintConversationMessage(
  msg: unknown,
): msg is PrintConversationMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    msg.type === 'print_conversation'
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
  data: Omit<T, 'type' | 'timestamp'>,
): T {
  return {
    type,
    timestamp: Date.now(),
    ...data,
  } as T;
}
