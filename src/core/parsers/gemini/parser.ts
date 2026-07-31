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

  /**
   * `textContent.length` of each pair's source `.conversation-container`,
   * index-aligned with the pairs `extractQAPairs` emits. Feeds
   * `turnTextLengthsFor` so the `content-shortfall` drift rule can fire for
   * Gemini (it is otherwise permanently suppressed -- see base-parser.ts).
   */
  private turnLengths: number[] = [];

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
   * Gemini exposes no model slug anywhere in the DOM. The composer's mode
   * picker is the closest thing, but its label is a *mode*: sometimes a model
   * family ("Flash", "Pro"), sometimes an effort tier ("Extended"). Reporting
   * it bare would put `Model: Extended` in an export header — a model name that
   * does not exist. So it is reported as what it is, which stays true either
   * way and still carries the information.
   *
   * ponytail: no allow-list of "real" model names — that would be a guess about
   * a value set we cannot see (the picker menu is closed in every capture) and
   * would silently drop labels the day Gemini renames one.
   */
  getModel(): string | null {
    const mode = this.textOf(this.selectors.modelIndicator);
    return mode === null ? null : `Gemini (${mode} mode)`;
  }

  /**
   * Whitespace-collapsed text of the first match, or null when absent or blank.
   * Angular templates wrap label text across lines, so a raw `trim()` leaves
   * newlines inside a title that then reaches the filename builder.
   */
  private textOf(selector: string | undefined): string | null {
    const text = selector
      ? this.document.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim()
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
    this.turnLengths = [];

    this.document.querySelectorAll(this.selectors.messageElement).forEach((container) => {
      const questionElement = container.querySelector(this.selectors.userMessage);
      // A model response can render more than one message-content block (e.g.
      // an extension/tool result alongside prose); querySelectorAll + join
      // matches ChatGPT's and Claude's multi-block handling instead of
      // silently keeping only the first block.
      const answerElements = container.querySelectorAll(this.selectors.messageContent);

      const question = questionElement
        ? this.extractContent(questionElement, config.preserveHtml)
        : { content: '' };
      const answerParts = Array.from(answerElements).map((el) =>
        this.extractContent(el, config.preserveHtml)
      );
      const answer = {
        content: answerParts
          .map((p) => p.content)
          .filter(Boolean)
          .join('\n\n'),
        htmlContent: answerParts.some((p) => p.htmlContent)
          ? answerParts
              .map((p) => p.htmlContent)
              .filter(Boolean)
              .join('\n')
          : undefined,
      };
      // "Create video" / "Create music" render their player inside
      // `model-response` but outside the `.markdown` body, so the clip has to
      // be picked up separately or it never reaches the export.
      const responseElement = container.querySelector(this.selectors.assistantMessage);
      const media = responseElement ? this.extractMedia(responseElement) : [];

      if (!question.content && !answer.content && media.length === 0) {
        return;
      }

      const answerMessage = this.createMessage('assistant', answer.content, answer.htmlContent);
      if (media.length > 0) {
        answerMessage.metadata = { ...answerMessage.metadata, media };
      }

      pairs.push(
        this.createQAPair(
          pairs.length,
          this.createMessage('user', question.content, question.htmlContent),
          answerMessage
        )
      );
      containers.push(container);
      this.turnLengths.push(container.textContent?.length ?? -1);
    });

    this.attachDeepResearchReport(pairs, containers, config);

    return pairs;
  }

  protected override turnTextLengthsFor(): number[] {
    return this.turnLengths;
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
      // A media-only answer (a generated clip with no prose) is read fine.
      if (!pair.answer.content && !pair.answer.metadata?.media?.length) {
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
