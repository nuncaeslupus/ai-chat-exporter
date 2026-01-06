/**
 * Gemini-specific conversation parser (PLACEHOLDER)
 * TODO: Update with real selectors after capturing gemini.google.com DOM structure
 */

import type { PlatformInfo, ParserConfig, QAPair } from '../../types';
import { BaseParser } from '../base-parser';
import { GEMINI_SELECTORS, isGeminiUrl } from './selectors';

/**
 * Parser for Gemini conversations
 * NOTE: This is a minimal placeholder. Needs real DOM selectors from gemini.google.com
 */
export class GeminiParser extends BaseParser {
  readonly platformInfo: PlatformInfo = {
    id: 'gemini',
    name: 'Gemini',
    urlPatterns: [/^https?:\/\/(www\.)?gemini\.google\.com/],
  };

  readonly selectors = GEMINI_SELECTORS;

  canParse(): boolean {
    return isGeminiUrl(this.getUrl());
  }

  getTitle(): string {
    return 'Gemini Conversation';
  }

  getModel(): string | null {
    return null;
  }

  getButtonInjectionPoint(): HTMLElement | null {
    return null;
  }

  protected extractQAPairs(_config: ParserConfig): QAPair[] {
    // TODO: Implement after capturing real DOM
    return [];
  }
}
