/**
 * Chrome storage wrapper for extension data persistence
 */

import { STORAGE_KEYS, DEFAULT_PREFERENCES } from './constants';
import type { UserPreferences } from './messages';

/**
 * Preferences written before `includeMetadata` and `includeTimestamps` merged.
 *
 * Read-only shape: nothing writes these any more, but stored preferences sync
 * across devices and outlive an update, so they keep arriving.
 */
interface LegacyMetaPreferences {
  includeMetadata?: boolean;
  includeTimestamps?: boolean;
}

/**
 * Resolve the merged flag from whatever shape storage returns.
 *
 * The header block was the user-visible half, so `includeMetadata` decides. A
 * stored `includeTimestamps` is discarded rather than OR-ed in: it controlled
 * nothing that ever rendered — no parser wrote `Message.timestamp` when it was
 * set — so honouring it would turn a preference the user never saw the effect of
 * into one that now shows a header they had switched off.
 */
function migrateShowMetaInfo(stored: Partial<UserPreferences> & LegacyMetaPreferences): boolean {
  if (typeof stored.showMetaInfo === 'boolean') return stored.showMetaInfo;
  if (typeof stored.includeMetadata === 'boolean') return stored.includeMetadata;
  return DEFAULT_PREFERENCES.showMetaInfo;
}

/**
 * Storage service for managing extension data
 */
export class StorageService {
  /**
   * Get user preferences from storage
   */
  static async getUserPreferences(): Promise<UserPreferences> {
    try {
      const result: Record<string, unknown> = await chrome.storage.sync.get(
        STORAGE_KEYS.USER_PREFERENCES
      );
      const stored = result[STORAGE_KEYS.USER_PREFERENCES] as
        | (Partial<UserPreferences> & LegacyMetaPreferences)
        | undefined;
      if (!stored) return DEFAULT_PREFERENCES;
      return { ...stored, showMetaInfo: migrateShowMetaInfo(stored) } as UserPreferences;
    } catch (error) {
      console.error('Failed to get user preferences:', error);
      return DEFAULT_PREFERENCES;
    }
  }

  /**
   * Save user preferences to storage
   */
  static async setUserPreferences(preferences: Partial<UserPreferences>): Promise<void> {
    try {
      const current = await this.getUserPreferences();
      const updated = { ...current, ...preferences };
      await chrome.storage.sync.set({
        [STORAGE_KEYS.USER_PREFERENCES]: updated,
      });
    } catch (error) {
      console.error('Failed to save user preferences:', error);
      throw error;
    }
  }

  /**
   * Get last used export format
   */
  static async getLastExportFormat(): Promise<string | null> {
    try {
      const result: Record<string, unknown> = await chrome.storage.local.get(
        STORAGE_KEYS.LAST_EXPORT_FORMAT
      );
      return (result[STORAGE_KEYS.LAST_EXPORT_FORMAT] as string | undefined) || null;
    } catch (error) {
      console.error('Failed to get last export format:', error);
      return null;
    }
  }

  /**
   * Save last used export format
   */
  static async setLastExportFormat(format: string): Promise<void> {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.LAST_EXPORT_FORMAT]: format,
      });
    } catch (error) {
      console.error('Failed to save last export format:', error);
    }
  }

  /**
   * Get selection state for a conversation
   */
  static async getSelectionState(conversationId: string): Promise<string[] | null> {
    try {
      const key = `${STORAGE_KEYS.SELECTION_STATE}_${conversationId}`;
      const result: Record<string, unknown> = await chrome.storage.local.get(key);
      return (result[key] as string[] | undefined) || null;
    } catch (error) {
      console.error('Failed to get selection state:', error);
      return null;
    }
  }

  /**
   * Save selection state for a conversation
   */
  static async setSelectionState(conversationId: string, selectedIds: string[]): Promise<void> {
    try {
      const key = `${STORAGE_KEYS.SELECTION_STATE}_${conversationId}`;
      await chrome.storage.local.set({
        [key]: selectedIds,
      });
    } catch (error) {
      console.error('Failed to save selection state:', error);
    }
  }

  /**
   * Clear all storage data (useful for debugging)
   */
  static async clearAll(): Promise<void> {
    try {
      await chrome.storage.local.clear();
      await chrome.storage.sync.clear();
    } catch (error) {
      console.error('Failed to clear storage:', error);
      throw error;
    }
  }

  /**
   * Get all storage data (useful for debugging)
   */
  static async getAll(): Promise<Record<string, unknown>> {
    try {
      const local = await chrome.storage.local.get(null);
      const sync = await chrome.storage.sync.get(null);
      return { local, sync };
    } catch (error) {
      console.error('Failed to get all storage:', error);
      return {};
    }
  }
}
