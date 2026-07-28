/**
 * Parser module exports and registry
 */

import type { Platform, ParserFactory, ParserRegistry } from '../types';
import { ChatGPTParser } from './chatgpt';
import { ClaudeParser } from './claude';
import { GeminiParser } from './gemini';

// Re-export parsers
export { BaseParser } from './base-parser';
export { ChatGPTParser } from './chatgpt';
export { CHATGPT_SELECTORS, isChatGPTUrl } from './chatgpt';
export { ClaudeParser } from './claude';
export { CLAUDE_SELECTORS, isClaudeUrl } from './claude';
export { GeminiParser } from './gemini';
export { GEMINI_SELECTORS, isGeminiUrl } from './gemini';

/**
 * Registry of available parsers
 */
export const parserRegistry: ParserRegistry = new Map<Platform, ParserFactory>([
  ['chatgpt', () => new ChatGPTParser(document)],
  ['claude', () => new ClaudeParser(document)],
  ['gemini', () => new GeminiParser(document)],
]);

/**
 * Get a parser for the specified platform
 */
export function getParser(platform: Platform): ReturnType<ParserFactory> | null {
  const factory = parserRegistry.get(platform);
  return factory ? factory() : null;
}

/**
 * Detect the current platform and return the appropriate parser
 */
export function detectParser(doc: Document = document): ReturnType<ParserFactory> | null {
  // Try each registered parser
  for (const [platform] of parserRegistry) {
    // Create parser with the provided document
    const parser = createParserForDocument(platform, doc);
    if (parser?.canParse()) {
      return parser;
    }
  }

  return null;
}

/**
 * Create a parser for a specific platform using a specific document
 */
export function createParserForDocument(
  platform: Platform,
  doc: Document
): ReturnType<ParserFactory> | null {
  switch (platform) {
    case 'chatgpt':
      return new ChatGPTParser(doc);
    case 'claude':
      return new ClaudeParser(doc);
    case 'gemini':
      return new GeminiParser(doc);
    default:
      return null;
  }
}
