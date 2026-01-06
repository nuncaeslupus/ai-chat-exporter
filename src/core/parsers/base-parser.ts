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
    const message: Message = {
      id: id ?? this.generateId(),
      role,
      content,
      timestamp: new Date(),
    };
    if (htmlContent) {
      message.htmlContent = htmlContent;
    }
    return message;
  }

  /**
   * Create a Q&A pair from user and assistant messages
   */
  protected createQAPair(
    index: number,
    question: Message,
    answer: Message,
    id?: string
  ): QAPair {
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

    // DEBUG: Check what HTML is being captured
    console.log('🔍 Parser extractContent:', {
      preserveHtml,
      contentLength: content.length,
      htmlLength: clone.innerHTML.length,
      htmlPreview: clone.innerHTML.substring(0, 200),
      hasCodeTags: clone.innerHTML.includes('<code'),
      hasTableTags: clone.innerHTML.includes('<table')
    });

    if (preserveHtml) {
      return { content, htmlContent: clone.innerHTML };
    }
    return { content };
  }

  /**
   * Clean up UI elements from a cloned element
   */
  private cleanupElement(element: Element): void {
    // Remove copy buttons and their text
    const copyButtons = element.querySelectorAll('button[class*="copy"], button[class*="Copy"]');
    copyButtons.forEach(btn => btn.remove());

    // Remove ALL buttons (ChatGPT UI has many button artifacts)
    const allButtons = element.querySelectorAll('button');
    allButtons.forEach(btn => btn.remove());

    // Remove screenreader-only elements
    const srOnly = element.querySelectorAll('.sr-only, [class*="sr-only"], [style*="position: absolute"][style*="width: 1px"]');
    srOnly.forEach(el => el.remove());

    // Remove any elements with aria-hidden="true"
    const ariaHidden = element.querySelectorAll('[aria-hidden="true"]');
    ariaHidden.forEach(el => el.remove());

    // Remove common ChatGPT UI artifacts
    const uiElements = element.querySelectorAll(
      '[class*="copy-code"], [class*="copy-btn"], svg, .avatar, [class*="icon"]'
    );
    uiElements.forEach(el => {
      // Only remove if it's not inside a code block
      if (!el.closest('pre') && !el.closest('code')) {
        el.remove();
      }
    });

    // Clean up empty elements
    element.querySelectorAll('div:empty, span:empty').forEach(el => el.remove());
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
