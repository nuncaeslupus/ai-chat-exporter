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
 * Registry of available parsers. Each factory takes the `Document` to parse,
 * so the same map serves both the live page (`detectParser()`) and an
 * arbitrary document (tests, drift tooling).
 */
export const parserRegistry: ParserRegistry = new Map<Platform, ParserFactory>([
  ['chatgpt', (doc) => new ChatGPTParser(doc)],
  ['claude', (doc) => new ClaudeParser(doc)],
  ['gemini', (doc) => new GeminiParser(doc)],
]);

/**
 * Detect the current platform and return the appropriate parser
 */
export function detectParser(doc: Document = document): ReturnType<ParserFactory> | null {
  for (const [, factory] of parserRegistry) {
    const parser = factory(doc);
    if (parser.canParse()) {
      return parser;
    }
  }

  return null;
}
