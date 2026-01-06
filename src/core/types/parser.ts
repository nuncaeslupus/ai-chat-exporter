/**
 * Parser interfaces and types
 */

import type { Conversation, Platform, PlatformInfo } from './conversation';

/**
 * Configuration for a parser
 */
export interface ParserConfig {
  /** Whether to include system messages */
  includeSystemMessages: boolean;
  /** Whether to preserve HTML formatting */
  preserveHtml: boolean;
  /** Maximum message length before truncation (0 = no limit) */
  maxMessageLength: number;
}

/**
 * Default parser configuration
 */
export const DEFAULT_PARSER_CONFIG: ParserConfig = {
  includeSystemMessages: false,
  preserveHtml: true,
  maxMessageLength: 0,
};

/**
 * Result of parsing a conversation
 */
export interface ParseResult {
  /** Whether parsing was successful */
  success: boolean;
  /** Parsed conversation (if successful) */
  conversation?: Conversation;
  /** Error message (if unsuccessful) */
  error?: string;
  /** Warnings during parsing */
  warnings?: string[];
}

/**
 * DOM selector definitions for a platform
 */
export interface SelectorSet {
  /** Selector for the conversation container */
  conversationContainer: string;
  /** Selector for individual message elements */
  messageElement: string;
  /** Selector for user messages */
  userMessage: string;
  /** Selector for assistant messages */
  assistantMessage: string;
  /** Selector for message content */
  messageContent: string;
  /** Selector for conversation title */
  conversationTitle?: string;
  /** Selector for model indicator */
  modelIndicator?: string;
  /** Additional platform-specific selectors */
  custom?: Record<string, string>;
}

/**
 * Interface for platform-specific conversation parsers
 */
export interface IParser {
  /** Platform information */
  readonly platformInfo: PlatformInfo;

  /** DOM selectors for this platform */
  readonly selectors: SelectorSet;

  /**
   * Check if this parser can handle the current page
   */
  canParse(): boolean;

  /**
   * Parse the current page into a Conversation
   */
  parse(config?: Partial<ParserConfig>): ParseResult;

  /**
   * Get the conversation title from the page
   */
  getTitle(): string;

  /**
   * Get the model name if detectable
   */
  getModel(): string | null;

  /**
   * Find the best injection point for UI buttons
   */
  getButtonInjectionPoint(): HTMLElement | null;

  /**
   * Get platform-specific theme name
   */
  getTheme(): string;
}

/**
 * Parser factory function type
 */
export type ParserFactory = () => IParser;

/**
 * Parser registry type
 */
export type ParserRegistry = Map<Platform, ParserFactory>;
