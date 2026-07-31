/**
 * Base parser with common functionality for all platform parsers
 */

import type {
  IParser,
  SelectorSet,
  ParserConfig,
  ParseResult,
  PlatformInfo,
  Message,
  MediaItem,
  QAPair,
  Conversation,
} from '../types';
import { DEFAULT_PARSER_CONFIG } from '../types';
import {
  checkOutputSanity,
  checkSelectorHealth,
  hasFailingRequiredSelector,
  fingerprint,
  type DriftReport,
} from '../drift';
import { flattenElementText } from '../utils/dom-text';

/**
 * Abstract base class for platform-specific parsers
 */
export abstract class BaseParser implements IParser {
  protected document: Document;
  protected config: ParserConfig;

  abstract readonly platformInfo: PlatformInfo;
  abstract readonly selectors: SelectorSet;

  constructor(document: Document, config: Partial<ParserConfig> = {}) {
    this.document = document;
    this.config = { ...DEFAULT_PARSER_CONFIG, ...config };
  }

  /**
   * Check if this parser can handle the current page
   */
  abstract canParse(): boolean;

  /**
   * Get the conversation title from the page
   */
  abstract getTitle(): string;

  /**
   * Get the model name if detectable
   */
  abstract getModel(): string | null;

  /**
   * Parse the current page into a Conversation
   */
  parse(config?: Partial<ParserConfig>): ParseResult {
    const mergedConfig = { ...this.config, ...config };

    try {
      const pairs = this.extractQAPairs(mergedConfig);
      const conversation = this.buildConversation(pairs);
      const warnings = this.collectWarnings(pairs);

      const result: ParseResult = {
        success: true,
        conversation,
      };
      if (warnings) {
        result.warnings = warnings;
      }
      const drift = this.detectDrift(pairs);
      if (drift) {
        result.drift = drift;
      }
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown parsing error',
      };
    }
  }

  /**
   * Extract Q&A pairs from the DOM
   */
  protected abstract extractQAPairs(config: ParserConfig): QAPair[];

  /**
   * Build a Conversation object from extracted pairs
   */
  protected buildConversation(pairs: QAPair[]): Conversation {
    const model = this.getModel();
    const conversation: Conversation = {
      id: this.generateId(),
      title: this.getTitle(),
      platform: this.platformInfo.id,
      pairs,
      url: this.getUrl(),
      createdAt: new Date(),
    };
    if (model) {
      conversation.model = model;
    }
    return conversation;
  }

  /**
   * Get the current page URL
   */
  protected getUrl(): string {
    return this.document.location?.href ?? '';
  }

  /**
   * Generate a unique ID
   */
  protected generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Create a Message object
   */
  protected createMessage(
    role: 'user' | 'assistant' | 'system',
    content: string,
    htmlContent?: string,
    id?: string
  ): Message {
    // D-18: no platform exposes a real per-message time in the DOM (see
    // claude-arsenal/queue/lo-4ab2.md for the capture evidence), so `timestamp`
    // is left unset rather than stamped with the capture moment -- a fabricated
    // "message time" is worse than none, since a reader can't tell it's invented.
    // Message.timestamp is optional for exactly this reason; a parser that does
    // find a real time (e.g. ClaudeParser.extractTimestamp) sets it itself.
    const message: Message = {
      id: id ?? this.generateId(),
      role,
      content,
    };
    if (htmlContent) {
      message.htmlContent = htmlContent;
    }
    return message;
  }

  /**
   * Create a Q&A pair from user and assistant messages
   */
  protected createQAPair(index: number, question: Message, answer: Message, id?: string): QAPair {
    return {
      id: id ?? this.generateId(),
      index,
      question,
      answer,
      selected: true, // Selected by default
    };
  }

  /**
   * Extract text content from an element, optionally preserving HTML
   */
  protected extractContent(
    element: Element,
    preserveHtml: boolean
  ): { content: string; htmlContent?: string } {
    // Clone the element to avoid modifying the DOM
    const clone = element.cloneNode(true) as Element;

    // Remove UI elements that shouldn't be in the export
    this.cleanupElement(clone);

    // D-35: plain textContent joins every descendant with no separator, so a
    // real table (or any other block structure) collapses into one run --
    // see flattenElementText for the boundary rules.
    const content = flattenElementText(clone).trim();

    if (preserveHtml) {
      return { content, htmlContent: clone.innerHTML };
    }
    return { content };
  }

  /**
   * Extract playable media (`<video>` / `<audio>`) from a message element.
   *
   * The generated-media widgets ("Create video", "Create music") render a
   * player next to the text body, not inside it, so `extractContent` never sees
   * them -- without this the clip is dropped from every export.
   */
  protected extractMedia(element: Element): MediaItem[] {
    const media: MediaItem[] = [];

    element.querySelectorAll('video, audio').forEach((player) => {
      // A player either carries `src` itself or delegates to <source> children.
      const source = player.querySelector('source');
      const src = player.getAttribute('src') ?? source?.getAttribute('src');
      if (!src) {
        return;
      }

      const item: MediaItem = {
        kind: player.tagName.toLowerCase() === 'video' ? 'video' : 'audio',
        src,
      };
      const alt = (player.getAttribute('aria-label') ?? player.getAttribute('title') ?? '').trim();
      if (alt) {
        item.alt = alt;
      }
      const mimeType = source?.getAttribute('type');
      if (mimeType) {
        item.mimeType = mimeType;
      }
      media.push(item);
    });

    return media;
  }

  /**
   * Clean up UI elements from a cloned element
   */
  private cleanupElement(element: Element): void {
    // Remove ALL buttons (ChatGPT UI has many button artifacts), including
    // non-<button> elements exposed as buttons via ARIA role (e.g. a `<span
    // role="button">` copy-table/copy-code control whose SVG sprite icon would
    // otherwise ship in htmlContent as a dead `/cdn/assets/sprites-...`
    // reference), plus screenreader-only elements. Naming is per design
    // system, not universal: ChatGPT ships `.sr-only`, Gemini (Angular CDK)
    // ships `.cdk-visually-hidden` — which is how "You said" prefixed every
    // Gemini question and "Opens in a new window" trailed every citation.
    // These two removals used to be four separate querySelectorAll passes
    // (one of which -- button[class*="copy"] -- was already a strict subset
    // of the plain `button` selector below and did nothing on its own);
    // combined into one pass since neither depends on the other's ordering.
    const chrome = element.querySelectorAll(
      'button, [role="button"], .sr-only, [class*="sr-only"], [class*="visually-hidden"], [style*="position: absolute"][style*="width: 1px"]'
    );
    chrome.forEach((el) => {
      el.remove();
    });

    // Collapse rendered math (KaTeX/MathJax) to a single representation before the
    // generic aria-hidden strip below runs. KaTeX emits up to three copies of the
    // same formula: `.katex-mathml` (with a lossless `annotation[encoding=
    // "application/x-tex"]` LaTeX source), and `.katex-html` (visual glyphs, marked
    // `aria-hidden="true"`). Gemini ships `.katex-html` only; ChatGPT ships all three.
    // Treating `.katex`/`mjx-container` as an atomic unit and replacing it with one
    // chosen text representation handles both platforms with one rule, so the
    // generic aria-hidden strip no longer needs a math carve-out (see below).
    const mathUnits = element.querySelectorAll('.katex, mjx-container');
    mathUnits.forEach((mathEl) => {
      // Skip units nested inside another math unit already being collapsed.
      if (mathEl.parentElement?.closest('.katex, mjx-container')) {
        return;
      }
      const annotation = mathEl.querySelector('annotation[encoding="application/x-tex"]');
      const mathml = mathEl.querySelector('.katex-mathml');
      const html = mathEl.querySelector('.katex-html');
      const text =
        annotation?.textContent?.trim() ||
        mathml?.textContent?.trim() ||
        html?.textContent?.trim() ||
        mathEl.textContent?.trim() ||
        '';

      // lo-320b: collapsing to one copy is only half the job — a bare LaTeX
      // string dropped inline reads as prose in every export. Delimit it and
      // tag it so HtmlContentParser can type it as math. The attribute is
      // `data-math-display`, NOT `data-math`: Gemini already ships
      // `data-math="<label>"` on its own math wrapper.
      const display =
        mathEl.closest('.katex-display') || mathEl.getAttribute('display') === 'true'
          ? 'block'
          : 'inline';
      const marker = mathEl.ownerDocument.createElement('span');
      marker.setAttribute('data-math-display', display);
      marker.textContent = display === 'block' ? `$$${text}$$` : `$${text}$`;
      mathEl.replaceWith(marker);
    });

    // Remove any remaining elements with aria-hidden="true" (decorative icons, etc).
    // Math's aria-hidden glyphs were already collapsed away above, so no carve-out
    // is needed here.
    const ariaHidden = element.querySelectorAll('[aria-hidden="true"]');
    ariaHidden.forEach((el) => {
      el.remove();
    });

    // Remove common ChatGPT UI artifacts
    const uiElements = element.querySelectorAll(
      '[class*="copy-code"], [class*="copy-btn"], svg, .avatar, [class*="icon"]'
    );
    uiElements.forEach((el) => {
      // Only remove if it's not inside a code block
      if (!el.closest('pre') && !el.closest('code')) {
        el.remove();
      }
    });

    // Clean up empty elements
    element.querySelectorAll('div:empty, span:empty').forEach((el) => {
      el.remove();
    });
  }

  /**
   * Selector keys whose zero-match means this parser is broken, as opposed to
   * a widget simply not being on the page. The five mandatory `SelectorSet`
   * keys are always required; a parser adds its own `custom.*` keys by
   * overriding this.
   */
  protected get requiredSelectorKeys(): readonly string[] {
    return [
      'conversationContainer',
      'messageElement',
      'userMessage',
      'assistantMessage',
      'messageContent',
    ];
  }

  /** Platform UI labels that must never appear as answer content. */
  protected get chromeStrings(): readonly string[] {
    return [];
  }

  /**
   * `textContent.length` of the turn element each pair's answer came from,
   * index-aligned with `pairs`. -1 means unknown, which suppresses the
   * `content-shortfall` rule for that pair — so the rule stays off until a
   * parser opts in by overriding this.
   */
  protected turnTextLengthsFor(pairs: QAPair[]): number[] {
    return pairs.map(() => -1);
  }

  /**
   * Assemble a drift report, or `undefined` when nothing is wrong.
   *
   * Best-effort by contract: a throw anywhere in here degrades to "no drift"
   * and the export proceeds. The safety net must never break an export.
   */
  protected detectDrift(pairs: QAPair[]): DriftReport | undefined {
    try {
      return this.detectDriftUnsafe(pairs);
    } catch {
      return undefined;
    }
  }

  /** The real work; `detectDrift` is the guard around it. */
  protected detectDriftUnsafe(pairs: QAPair[]): DriftReport | undefined {
    const sanityFindings = checkOutputSanity({
      pairs,
      turnCount: this.countTurnContainers(),
      turnTextLengths: this.turnTextLengthsFor(pairs),
      chromeStrings: this.chromeStrings,
    });

    // Happy path: only the required selectors decide whether there is drift
    // at all. The full sweep over every declared (incl. optional) selector is
    // only worth paying for once we know a report will actually be built.
    const requiredSelectorFailed = hasFailingRequiredSelector(
      this.document,
      this.selectors,
      this.requiredSelectorKeys
    );
    if (!requiredSelectorFailed && sanityFindings.length === 0) {
      return undefined;
    }

    const selectorFindings = checkSelectorHealth(
      this.document,
      this.selectors,
      this.requiredSelectorKeys
    );
    const failingSelectors = selectorFindings.filter((f) => f.required && f.matched <= 0);

    return {
      fingerprint: fingerprint({
        platform: this.platformInfo.id,
        extensionVersion: this.extensionVersion(),
        selectorKeys: failingSelectors.map((f) => f.key),
        ruleIds: sanityFindings.map((f) => f.rule),
      }),
      platform: this.platformInfo.id,
      extensionVersion: this.extensionVersion(),
      buildTarget: this.buildTarget(),
      detectedAt: new Date().toISOString().slice(0, 10),
      selectorFindings,
      sanityFindings,
    };
  }

  /** How many turn containers the DOM holds, however many pairs came out. */
  protected countTurnContainers(): number {
    try {
      return this.document.querySelectorAll(this.selectors.messageElement).length;
    } catch {
      return 0;
    }
  }

  private extensionVersion(): string {
    try {
      return chrome?.runtime?.getManifest?.().version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * The build target, derived from the UA but never storing it — a user agent
   * string is needlessly identifying for a report whose only job is to name a
   * broken selector.
   */
  private buildTarget(): 'chrome' | 'firefox' {
    const ua = this.document.defaultView?.navigator?.userAgent ?? '';
    return /firefox/i.test(ua) ? 'firefox' : 'chrome';
  }

  /**
   * Collect any warnings generated during parsing
   */
  protected collectWarnings(pairs: QAPair[]): string[] | undefined {
    const warnings: string[] = [];

    if (pairs.length === 0) {
      warnings.push('No Q&A pairs found in the conversation');
    }

    return warnings.length > 0 ? warnings : undefined;
  }
}
