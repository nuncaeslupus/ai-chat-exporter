/**
 * Claude-specific conversation parser (PLACEHOLDER)
 * TODO: Update with real selectors after capturing claude.ai DOM structure
 */

import type { PlatformInfo, ParserConfig, QAPair } from '../../types';
import { BaseParser } from '../base-parser';
import { CLAUDE_SELECTORS, isClaudeUrl } from './selectors';

/**
 * Parser for Claude conversations
 * NOTE: This is a minimal placeholder. Needs real DOM selectors from claude.ai
 */
export class ClaudeParser extends BaseParser {
  readonly platformInfo: PlatformInfo = {
    id: 'claude',
    name: 'Claude',
    urlPatterns: [/^https?:\/\/(www\.)?claude\.ai/],
  };

  readonly selectors = CLAUDE_SELECTORS;

  canParse(): boolean {
    return isClaudeUrl(this.getUrl());
  }

  getTitle(): string {
    return 'Claude Conversation';
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
