/**
 * Gemini-specific conversation parser
 *
 * Every selector comes from GEMINI_SELECTORS; see that file for how they were
 * verified against a live capture.
 */

import type { PlatformInfo, ParserConfig, QAPair, WebSearchResult } from '../../types';
import { BaseParser } from '../base-parser';
import { GEMINI_SELECTORS, GEMINI_DEEP_RESEARCH_SELECTORS, isGeminiUrl } from './selectors';

type SourceResult = NonNullable<WebSearchResult['results']>[number];

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
   * `.conversation-container`, so pairing is structural — no index zipping.
   *
   * A turn missing one half is emitted anyway, with that half empty and a
   * warning from `collectWarnings`. Dropping the whole container (the previous
   * behaviour) silently loses the question too, which is how an entire Deep
   * Research turn could disappear from an export with no signal.
   */
  protected extractQAPairs(config: ParserConfig): QAPair[] {
    const pairs: QAPair[] = [];
    const containers: Element[] = [];

    this.document.querySelectorAll(this.selectors.messageElement).forEach((container) => {
      const questionElement = container.querySelector(this.selectors.userMessage);
      const answerElement = container.querySelector(this.selectors.messageContent);

      const question = questionElement
        ? this.extractContent(questionElement, config.preserveHtml)
        : { content: '' };
      const answer = answerElement
        ? this.extractContent(answerElement, config.preserveHtml)
        : { content: '' };
      if (!question.content && !answer.content) {
        return;
      }

      pairs.push(
        this.createQAPair(
          pairs.length,
          this.createMessage('user', question.content, question.htmlContent),
          this.createMessage('assistant', answer.content, answer.htmlContent)
        )
      );
      containers.push(container);
    });

    this.attachDeepResearchReport(pairs, containers, config);

    return pairs;
  }

  /**
   * Flag half-empty turns so a partially-read conversation is visible to the
   * user instead of quietly shipping a blank question or answer.
   */
  protected override collectWarnings(pairs: QAPair[]): string[] | undefined {
    const warnings = super.collectWarnings(pairs) ?? [];

    for (const pair of pairs) {
      const turn = String(pair.index + 1);
      if (!pair.question.content) {
        warnings.push(`Turn ${turn}: the question could not be read`);
      }
      if (!pair.answer.content) {
        warnings.push(`Turn ${turn}: the answer could not be read`);
      }
    }

    return warnings.length > 0 ? warnings : undefined;
  }

  /**
   * Fold an open Deep Research report into the turn that links to it.
   *
   * The report body is appended to that turn's answer rather than filed under
   * new metadata: it *is* the assistant's answer, only rendered in a side
   * panel, and every exporter already renders an answer. (The ChatGPT parser
   * does the same thing for its multi-`message-content` research turns.) The
   * cited sources go to `metadata.webSearches`, the shape ChatGPT and Claude
   * already use for citations.
   *
   * ponytail: the panel's `thinking-panel` (42 steps, ~60k chars in the
   * capture) is deliberately left out — it is the model's internal narration,
   * collapsed by default in the UI, and would dwarf the report in every export.
   * Add it as a separate artifact if users ask for it.
   */
  private attachDeepResearchReport(
    pairs: QAPair[],
    containers: Element[],
    config: ParserConfig
  ): void {
    const selectors = GEMINI_DEEP_RESEARCH_SELECTORS;
    const panel = this.document.querySelector(selectors.panel);
    const body = panel?.querySelector(selectors.body);
    if (!panel || !body) {
      return;
    }

    // Only one immersive panel is open at a time, so the chip is the only link
    // back to its turn; fall back to the last turn when the chip is missing.
    const chipIndex = containers.findIndex((c) => c.querySelector(selectors.entryChip));
    const target = pairs[chipIndex >= 0 ? chipIndex : pairs.length - 1];
    if (!target) {
      return;
    }

    const report = this.extractContent(body, config.preserveHtml);
    if (!report.content) {
      return;
    }

    target.answer.content = [target.answer.content, report.content].filter(Boolean).join('\n\n');
    if (report.htmlContent) {
      target.answer.htmlContent = `${target.answer.htmlContent ?? ''}${report.htmlContent}`;
    }

    const results = this.extractDeepResearchSources(panel);
    if (results.length > 0) {
      const reportTitle = panel.querySelector(selectors.title)?.textContent.trim();
      const search: WebSearchResult = {
        query: reportTitle === undefined || reportTitle === '' ? 'Deep Research' : reportTitle,
        resultCount: results.length,
        results,
      };
      target.answer.metadata = { ...target.answer.metadata, webSearches: [search] };
    }
  }

  /**
   * The sources the Deep Research report cited, as `WebSearchResult` entries.
   */
  private extractDeepResearchSources(panel: Element): SourceResult[] {
    const selectors = GEMINI_DEEP_RESEARCH_SELECTORS;
    const sources: SourceResult[] = [];

    panel.querySelectorAll(selectors.source).forEach((item) => {
      const url = item.querySelector(selectors.sourceUrl)?.getAttribute('href');
      if (!url) {
        return;
      }
      const domain = item.querySelector(selectors.sourceDomain)?.textContent.trim() ?? '';
      const title = item.querySelector(selectors.sourceTitle)?.textContent.trim() ?? '';
      const source: SourceResult = { title: title || domain || url, url };
      if (domain) {
        source.domain = domain;
      }
      sources.push(source);
    });

    return sources;
  }
}
