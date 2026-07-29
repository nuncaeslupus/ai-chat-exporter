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
   * Find the best injection point for UI buttons
   */
  abstract getButtonInjectionPoint(): HTMLElement | null;

  /**
   * Get platform-specific theme name
   */
  getTheme(): string {
    return this.platformInfo.id;
  }

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

    const content = clone.textContent?.trim() ?? '';

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
