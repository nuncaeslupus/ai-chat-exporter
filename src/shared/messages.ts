/**
 * Message types and interfaces for extension communication
 */

import type { QAPair, ExportFormat, ExportOptions } from '../core/types';

/**
 * Base message interface
 */
interface BaseMessage<T extends string = string> {
  type: T;
  timestamp: number;
}

/**
 * Export conversation message
 */
export interface ExportConversationMessage extends BaseMessage<'export_conversation'> {
  format: ExportFormat;
  selectedPairs: QAPair[];
  options: ExportOptions;
}

/**
 * Print conversation message
 */
export interface PrintConversationMessage extends BaseMessage<'print_conversation'> {
  selectedPairs: QAPair[];
}

/**
 * Get conversation message
 */
export interface GetConversationMessage extends BaseMessage<'get_conversation'> {
  // No additional data needed
}

/**
 * Update preferences message
 */
export interface UpdatePreferencesMessage extends BaseMessage<'update_preferences'> {
  preferences: Partial<UserPreferences>;
}

/**
 * Show notification message
 */
export interface ShowNotificationMessage extends BaseMessage<'show_notification'> {
  message: string;
  notificationType: 'success' | 'error' | 'info';
}

/**
 * User preferences interface
 */
export interface UserPreferences {
  includeMetadata: boolean;
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
 * Type guard for update preferences message
 */
export function isUpdatePreferencesMessage(
  msg: unknown,
): msg is UpdatePreferencesMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    msg.type === 'update_preferences'
  );
}

/**
 * Type guard for show notification message
 */
export function isShowNotificationMessage(
  msg: unknown,
): msg is ShowNotificationMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    msg.type === 'show_notification'
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
