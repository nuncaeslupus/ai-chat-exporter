/**
 * Gemini-specific conversation parser
 *
 * Every selector comes from GEMINI_SELECTORS; see that file for how they were
 * verified against a live capture.
 */

import type { PlatformInfo, ParserConfig, QAPair } from '../../types';
import { BaseParser } from '../base-parser';
import { GEMINI_SELECTORS, isGeminiUrl } from './selectors';

/**
 * Parser for Gemini conversations
 */
export class GeminiParser extends BaseParser {
  readonly platformInfo: PlatformInfo = {
    id: 'gemini',
    name: 'Gemini',
    urlPatterns: [/^https?:\/\/(www\.)?gemini\.google\.com/],
  };

  readonly selectors = GEMINI_SELECTORS;

  canParse(): boolean {
    if (!isGeminiUrl(this.getUrl())) {
      return false;
    }
    return this.document.querySelector(this.selectors.conversationContainer) !== null;
  }

  getTitle(): string {
    return this.textOf(this.selectors.conversationTitle) ?? 'Gemini Conversation';
  }

  /**
   * Gemini exposes no per-message model slug; the mode switcher label is the
   * only model-ish string in the DOM (it reads "Gemini" or the picked model).
   */
  getModel(): string | null {
    return this.textOf(this.selectors.modelIndicator);
  }

  /**
   * Trimmed text of the first match, or null when absent or blank.
   */
  private textOf(selector: string | undefined): string | null {
    const text = selector
      ? this.document.querySelector(selector)?.textContent.trim()
      : undefined;
    return text === undefined || text === '' ? null : text;
  }

  getButtonInjectionPoint(): HTMLElement | null {
    const buttonArea = this.selectors.custom?.buttonArea;
    if (!buttonArea) {
      return null;
    }

    for (const selector of buttonArea.split(',')) {
      const element = this.document.querySelector(selector.trim());
      if (element) {
        return element as HTMLElement;
      }
    }

    return null;
  }

  /**
   * Extract Q&A pairs from the Gemini DOM.
   *
   * Gemini nests the question and its answer in the same
   * `.conversation-container`, so pairing is structural — no index zipping,
   * and a turn missing one half simply drops out.
   */
  protected extractQAPairs(config: ParserConfig): QAPair[] {
    const pairs: QAPair[] = [];

    this.document.querySelectorAll(this.selectors.messageElement).forEach((container) => {
      const questionElement = container.querySelector(this.selectors.userMessage);
      const answerElement = container.querySelector(this.selectors.messageContent);
      if (!questionElement || !answerElement) {
        return;
      }

      const question = this.extractContent(questionElement, config.preserveHtml);
      const answer = this.extractContent(answerElement, config.preserveHtml);
      if (!question.content || !answer.content) {
        return;
      }

      pairs.push(
        this.createQAPair(
          pairs.length,
          this.createMessage('user', question.content, question.htmlContent),
          this.createMessage('assistant', answer.content, answer.htmlContent)
        )
      );
    });

    return pairs;
  }
}
