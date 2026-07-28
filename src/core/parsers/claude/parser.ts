/**
 * Claude-specific conversation parser
 */

import type {
  PlatformInfo,
  ParserConfig,
  QAPair,
  Message,
  Artifact,
  WebSearchResult,
} from '../../types';
import { BaseParser } from '../base-parser';
import { CLAUDE_SELECTORS, isClaudeUrl } from './selectors';

// content-script.ts creates a fresh ClaudeParser per parse() call (see
// detectParser()), so an instance-level cache would never hit. This module
// stays loaded for the lifetime of the content script, so a module-level
// cache survives across parser instances and avoids re-encoding the same
// image on every export_conversation / print_conversation / get_conversation
// message. Bounded (not a plain unbounded Map) so a long chat page with many
// distinct images can't grow this without limit; oldest entries are evicted
// first once the cap is hit.
// ponytail: FIFO eviction via Map insertion order, not true LRU — good enough
// for a bound, upgrade to LRU only if eviction order turns out to matter.
const IMAGE_DATA_URL_CACHE_MAX_SIZE = 200;
const imageDataUrlCache = new Map<string, string>();

function getCachedImageDataUrl(src: string): string | undefined {
  return imageDataUrlCache.get(src);
}

function setCachedImageDataUrl(src: string, dataUrl: string): void {
  if (imageDataUrlCache.size >= IMAGE_DATA_URL_CACHE_MAX_SIZE) {
    const oldestKey = imageDataUrlCache.keys().next().value;
    if (oldestKey !== undefined) {
      imageDataUrlCache.delete(oldestKey);
    }
  }
  imageDataUrlCache.set(src, dataUrl);
}

/**
 * Parser for Claude conversations
 */
export class ClaudeParser extends BaseParser {
  readonly platformInfo: PlatformInfo = {
    id: 'claude',
    name: 'Claude',
    urlPatterns: [/^https?:\/\/(www\.)?claude\.ai/],
  };

  readonly selectors = CLAUDE_SELECTORS;

  /**
   * Check if this parser can handle the current page
   */
  canParse(): boolean {
    const url = this.getUrl();
    if (!isClaudeUrl(url)) {
      return false;
    }

    // Also check if conversation container exists
    const container = this.document.querySelector(this.selectors.conversationContainer);
    return container !== null;
  }

  /**
   * Get the conversation title from the page
   */
  getTitle(): string {
    // Try the chat title button in header
    const titleElement = this.selectors.conversationTitle
      ? this.document.querySelector(this.selectors.conversationTitle)
      : null;
    const title = titleElement?.textContent?.trim();

    if (title && title !== 'Claude') {
      return title;
    }

    // Fallback to page title
    const pageTitle = this.document.querySelector('title')?.textContent?.trim();
    if (pageTitle && pageTitle !== 'Claude') {
      return pageTitle;
    }

    return this.getDefaultTitle();
  }

  /**
   * Get the model name if detectable
   */
  getModel(): string | null {
    const modelSelector = this.selectors.modelIndicator;
    if (!modelSelector) {
      return null;
    }

    const modelElement = this.document.querySelector(modelSelector);
    if (!modelElement) {
      return null;
    }

    const modelText = modelElement.textContent?.trim();
    if (!modelText) {
      return null;
    }

    // Claude shows models like "Sonnet 4.5", "Opus 4", "Haiku 4"
    // Prepend "Claude" if not already present
    if (modelText.toLowerCase().includes('claude')) {
      return modelText;
    }

    return `Claude ${modelText}`;
  }

  /**
   * Find the best injection point for UI buttons
   */
  getButtonInjectionPoint(): HTMLElement | null {
    // Try to find the container with the model selector button
    const modelButton = this.document.querySelector('button[data-testid="model-selector-dropdown"]');
    if (modelButton?.parentElement) {
      return modelButton.parentElement;
    }

    // Fallback: try the buttonArea selector
    const buttonArea = this.selectors.custom?.buttonArea;
    if (buttonArea) {
      const element = this.document.querySelector(buttonArea);
      if (element) {
        return element as HTMLElement;
      }
    }

    // Last fallback: header itself
    const header = this.document.querySelector('header[data-testid="page-header"]');
    if (header) {
      return header as HTMLElement;
    }

    return null;
  }

  /**
   * Extract Q&A pairs from the Claude DOM.
   *
   * Pairs structurally: turns are walked in document order (one query over
   * `custom.turnContainer`, which wraps every turn of either role), and each
   * recognized user turn is paired with the assistant turn that immediately
   * follows it. A turn's role is told apart by `custom.userTurnWrapper` (the
   * user bubble's own wrapper, which survives even when a redesign guts the
   * `data-testid="user-message"` content inside it) versus `assistantMessage`.
   * A turn whose content fails to extract still occupies its slot in that
   * walk -- it degrades to an empty half plus a warning (see
   * `collectWarnings`) instead of being dropped, which is what previously let
   * a later answer silently shift onto the wrong question (lo-d0f0).
   */
  protected extractQAPairs(config: ParserConfig): QAPair[] {
    const pairs: QAPair[] = [];
    const turnContainer = this.selectors.custom?.turnContainer || 'div[data-test-render-count]';
    const userTurnWrapper = this.selectors.custom?.userTurnWrapper || 'div.mb-1.mt-6.group';
    const turns = this.document.querySelectorAll(turnContainer);

    let pendingQuestion: Message | null = null;
    let hasPendingQuestion = false;

    turns.forEach((turn) => {
      const isUserTurn = turn.querySelector(userTurnWrapper) !== null;

      if (isUserTurn) {
        if (hasPendingQuestion) {
          // The previous user turn never got an assistant reply (e.g. the
          // conversation was regenerated). Keep it as its own pair with an
          // empty answer instead of letting this turn's answer attach to it.
          pairs.push(
            this.createQAPair(
              pairs.length,
              pendingQuestion ?? this.createMessage('user', ''),
              this.createMessage('assistant', '')
            )
          );
        }
        pendingQuestion = this.extractUserMessage(turn, config);
        hasPendingQuestion = true;
        return;
      }

      const isAssistantTurn = turn.querySelector(this.selectors.assistantMessage) !== null;
      if (!isAssistantTurn) {
        // Neither role recognized structurally; nothing to pair here.
        return;
      }

      const answer = this.extractAssistantMessage(turn, config);
      if (!hasPendingQuestion) {
        // Orphan assistant turn with no preceding question; nothing to pair.
        return;
      }
      pairs.push(
        this.createQAPair(
          pairs.length,
          pendingQuestion ?? this.createMessage('user', ''),
          answer ?? this.createMessage('assistant', '')
        )
      );
      pendingQuestion = null;
      hasPendingQuestion = false;
    });

    // A trailing pending question (no assistant reply yet) is an in-progress
    // conversation -- skip it, same as before.

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
   * Extract a single user message
   */
  private extractUserMessage(element: Element, config: ParserConfig): Message | null {
    const messageId = this.generateId();

    // Extract uploaded images first
    const images = this.extractUserUploadedImages(element);

    // Extract text content
    const contentSelector = this.selectors.custom?.userMessageContent || 'p.whitespace-pre-wrap';
    const contentElement = element.querySelector(contentSelector);

    if (!contentElement) {
      // If no text but has images, create a message indicating images only
      if (images.length > 0) {
        const imageDescriptions = images.map(img => img.alt || 'image').join(', ');
        return this.createMessageWithMetadata(
          'user',
          `[Uploaded images: ${imageDescriptions}]`,
          undefined,
          messageId,
          { images }
        );
      }
      return null;
    }

    const { content, htmlContent } = this.extractContent(contentElement, config.preserveHtml);
    if (!content && images.length === 0) {
      return null;
    }

    // Extract timestamp if available
    const timestamp = this.extractTimestamp(element);

    const message = this.createMessage('user', content || '', htmlContent, messageId);
    if (timestamp) {
      message.timestamp = timestamp;
    }

    // Add images to metadata
    if (images.length > 0) {
      message.metadata = { ...message.metadata, images };
    }

    return message;
  }

  /**
   * Extract user uploaded images
   */
  private extractUserUploadedImages(element: Element): { src: string; alt?: string; width?: number; height?: number }[] {
    const images: { src: string; alt?: string; width?: number; height?: number }[] = [];

    const imageContainers = element.querySelectorAll('div.relative.group\\/thumbnail');

    imageContainers.forEach((container) => {
      const img = container.querySelector('img');
      if (!img) {
        return;
      }

      const src = img.getAttribute('src');
      if (!src) {
        return;
      }

      // Try to get alt from img, or from data-testid attribute on container's child
      const alt = img.getAttribute('alt') || container.querySelector('[data-testid]')?.getAttribute('data-testid');
      const widthAttr = img.getAttribute('width');
      const heightAttr = img.getAttribute('height');

      // Try to convert blob URLs to data URLs synchronously if possible
      // Note: If it's already a data URL or http(s) URL, keep it as is
      const finalSrc = this.tryGetImageDataUrl(img, src);

      const imageData: { src: string; alt?: string; width?: number; height?: number } = { src: finalSrc };
      if (alt) imageData.alt = alt;
      // Only include dimensions if they're actually specified in the HTML
      if (widthAttr) imageData.width = parseInt(widthAttr, 10);
      if (heightAttr) imageData.height = parseInt(heightAttr, 10);

      images.push(imageData);
    });

    return images;
  }

  /**
   * Try to get image as data URL if it's a blob URL
   * Falls back to original src if conversion fails
   */
  private tryGetImageDataUrl(imgElement: HTMLImageElement, originalSrc: string): string {
    // If it's already a data URL, return as-is
    if (originalSrc.startsWith('data:')) {
      return originalSrc;
    }

    // Same image src encoded before (possibly by a prior ClaudeParser
    // instance) — reuse it instead of re-running the canvas encode.
    const cached = getCachedImageDataUrl(originalSrc);
    if (cached) {
      return cached;
    }

    // For blob URLs or regular URLs, try to draw to canvas and get data URL
    try {
      const canvas = this.document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        return originalSrc;
      }

      // Set canvas dimensions to match image
      canvas.width = imgElement.naturalWidth || imgElement.width || 300;
      canvas.height = imgElement.naturalHeight || imgElement.height || 300;

      // Draw image to canvas
      ctx.drawImage(imgElement, 0, 0);

      // Convert to data URL
      const dataUrl = canvas.toDataURL('image/png');
      setCachedImageDataUrl(originalSrc, dataUrl);
      return dataUrl;
    } catch (error) {
      // If conversion fails (CORS, etc.), return original src
      console.warn('[Claude Parser] Could not convert image to data URL:', error);
      return originalSrc;
    }
  }

  /**
   * Extract a single assistant message
   */
  private extractAssistantMessage(element: Element, config: ParserConfig): Message | null {
    const messageId = this.generateId();
    console.log('[Claude Parser] extractAssistantMessage called for element:', element.tagName);

    // Extract all content parts
    const contentParts: string[] = [];
    const htmlParts: string[] = [];

    // Extract web searches
    console.log('[Claude Parser] About to extract web searches...');
    const webSearches = this.extractWebSearches(element);
    console.log('[Claude Parser] Web searches extracted:', webSearches.length);
    if (webSearches.length > 0) {
      webSearches.forEach(search => {
        contentParts.push(`[Web Search: ${search.query}]`);
        if (search.results && search.results.length > 0) {
          contentParts.push(`Found ${search.resultCount || search.results.length} results`);
        }
      });
    }

    // Extract text content from standard-markdown or progressive-markdown
    const markdownContainers = element.querySelectorAll('div.standard-markdown, div.progressive-markdown');
    console.log('[Claude Parser] Found markdown containers:', markdownContainers.length);
    markdownContainers.forEach((container) => {
      const { content, htmlContent } = this.extractContent(container, config.preserveHtml);
      if (content) {
        contentParts.push(content);
      }
      if (htmlContent) {
        htmlParts.push(htmlContent);
      }
    });

    // Extract artifacts
    console.log('[Claude Parser] About to extract artifacts...');
    const artifacts = this.extractArtifacts(element);
    console.log('[Claude Parser] Artifacts extracted:', artifacts.length);
    if (artifacts.length > 0) {
      artifacts.forEach(artifact => {
        contentParts.push(`[${artifact.typeLabel || artifact.type}: ${artifact.title}]`);
      });
    }

    console.log('[Claude Parser] Total content parts:', contentParts.length);
    if (contentParts.length === 0) {
      console.log('[Claude Parser] No content parts, returning null');
      return null;
    }

    // Combine all content
    const combinedContent = contentParts.join('\n\n');
    console.log('[Claude Parser] Combined content preview (first 500 chars):', combinedContent.substring(0, 500));
    console.log('[Claude Parser] Combined content includes Web Search:', combinedContent.includes('[Web Search:'));
    console.log('[Claude Parser] Combined content includes artifacts:', combinedContent.includes('[Imagen:') || combinedContent.includes('[Documento:') || combinedContent.includes('[Diagrama:'));
    const combinedHtml = htmlParts.length > 0 ? htmlParts.join('\n') : undefined;

    // Extract timestamp
    const timestamp = this.extractTimestamp(element);

    const message = this.createMessage('assistant', combinedContent, combinedHtml, messageId);
    if (timestamp) {
      message.timestamp = timestamp;
    }

    // Add metadata
    if (artifacts.length > 0 || webSearches.length > 0) {
      message.metadata = { ...message.metadata };
      if (artifacts.length > 0) {
        message.metadata.artifacts = artifacts;
      }
      if (webSearches.length > 0) {
        message.metadata.webSearches = webSearches;
      }
    }

    return message;
  }

  /**
   * Extract artifacts/canvases from a message
   */
  private extractArtifacts(element: Element): Artifact[] {
    const artifacts: Artifact[] = [];

    const artifactContainers = element.querySelectorAll('div.pt-3.pb-3');
    console.log('[Claude Parser] Found artifact containers:', artifactContainers.length);

    artifactContainers.forEach((container) => {
      // Check if this contains an artifact
      const artifactBlock = container.querySelector('div.artifact-block-cell');
      console.log('[Claude Parser] Artifact block found:', !!artifactBlock);
      if (!artifactBlock) {
        return;
      }

      // Extract title
      const titleElement = artifactBlock.querySelector('div.leading-tight.text-sm.line-clamp-1');
      const title = titleElement?.textContent?.trim() || 'Untitled Artifact';
      console.log('[Claude Parser] Artifact title:', title);

      // Extract type label (e.g., "Imagen", "Artefacto interactivo", "Documento", "Diagrama")
      const typeElement = artifactBlock.querySelector('div.text-xs.line-clamp-1.text-text-400');
      const typeLabel = typeElement?.textContent?.trim() || '';
      console.log('[Claude Parser] Artifact typeLabel:', typeLabel);

      // Determine artifact type based on label
      let type = 'unknown';
      let language: string | undefined;

      if (typeLabel.includes('Imagen') || typeLabel.includes('Image')) {
        type = 'image';
        language = 'svg';
      } else if (typeLabel.includes('interactivo') || typeLabel.includes('interactive')) {
        type = 'react';
        language = 'react';
      } else if (typeLabel.includes('Documento') || typeLabel.includes('Document')) {
        type = 'document';
        language = 'markdown';
      } else if (typeLabel.includes('Diagrama') || typeLabel.includes('Diagram')) {
        type = 'diagram';
        language = 'mermaid';
      } else if (typeLabel.includes('Código') || typeLabel.includes('Code')) {
        type = 'code';
      }

      const artifact: Artifact = {
        type,
        title,
        typeLabel,
      };
      if (language) {
        artifact.language = language;
      }

      artifacts.push(artifact);
    });

    return artifacts;
  }

  /**
   * Extract web search results from a message
   */
  private extractWebSearches(element: Element): WebSearchResult[] {
    const searches: WebSearchResult[] = [];

    const searchContainers = element.querySelectorAll('div.ease-out.transition-all.flex.flex-col.font-ui');
    console.log('[Claude Parser] Found search containers:', searchContainers.length);

    searchContainers.forEach((container) => {
      // Check if this is a web search widget
      const searchButton = container.querySelector('button.group\\/row');
      if (!searchButton) {
        return;
      }

      // Extract query
      const queryElement = container.querySelector('.flex.gap-2.relative.font-base');
      const query = queryElement?.textContent?.trim() || '';
      console.log('[Claude Parser] Search query:', query);

      if (!query) {
        console.log('[Claude Parser] No query found, skipping');
        return;
      }

      // Extract result count
      const countElement = container.querySelector('p.text-text-500.font-small');
      const countText = countElement?.textContent?.trim() || '';
      const countMatch = /(\d+)/.exec(countText);
      const resultCount = countMatch?.[1] ? parseInt(countMatch[1], 10) : undefined;

      // Extract individual results
      const results: { title: string; url: string; favicon?: string; domain?: string }[] = [];
      const resultLinks = container.querySelectorAll('div.flex.flex-nowrap.p-2 a');

      resultLinks.forEach((link) => {
        const href = link.getAttribute('href');
        if (!href) {
          return;
        }

        const titleElement = link.querySelector('p.text-\\[0\\.875rem\\]');
        const title = titleElement?.textContent?.trim() || '';

        const domainElement = link.querySelector('p.text-\\[0\\.75rem\\].text-text-500');
        const domain = domainElement?.textContent?.trim() || '';

        // ponytail: the citation favicon <img src> is taken straight off
        // claude.ai's DOM, and chat UIs serve those from third-party hosts
        // (ChatGPT's citation pills use logo.clearbit.com -- see
        // tests/fixtures/dom-snapshots/chatgpt/citations.html). Carrying it
        // into the export would make the exported file phone out to that host
        // every time it is opened, leaking the cited domains and the reader's
        // IP. Favicons are decorative, so drop them -- same resolution as
        // lo-8312 took for ChatGPT.
        const result: { title: string; url: string; favicon?: string; domain?: string } = {
          title,
          url: href,
        };
        if (domain) result.domain = domain;

        results.push(result);
      });

      const search: WebSearchResult = {
        query,
        results,
      };
      if (resultCount !== undefined) {
        search.resultCount = resultCount;
      }

      searches.push(search);
    });

    return searches;
  }

  /**
   * Extract timestamp from a message element
   */
  private extractTimestamp(element: Element): Date | undefined {
    const timestampSelector = this.selectors.custom?.timestamp;
    if (!timestampSelector) {
      return undefined;
    }

    const timestampElement = element.querySelector(timestampSelector);
    if (!timestampElement) {
      return undefined;
    }

    const timeText = timestampElement.textContent?.trim();
    if (!timeText) {
      return undefined;
    }

    // Claude shows time in HH:MM format (e.g., "18:40")
    // We'll create a date with today's date and the given time
    const timeMatch = /(\d{1,2}):(\d{2})/.exec(timeText);
    if (!timeMatch) {
      return undefined;
    }

    const hours = parseInt(timeMatch[1] || '0', 10);
    const minutes = parseInt(timeMatch[2] || '0', 10);

    const now = new Date();
    now.setHours(hours, minutes, 0, 0);

    return now;
  }

  /**
   * Helper to create a message with metadata
   */
  private createMessageWithMetadata(
    role: 'user' | 'assistant' | 'system',
    content: string,
    htmlContent: string | undefined,
    id: string,
    metadata: Record<string, unknown>
  ): Message {
    const message = this.createMessage(role, content, htmlContent, id);
    message.metadata = { ...message.metadata, ...metadata };
    return message;
  }

  /**
   * Get default title when none is found
   */
  private getDefaultTitle(): string {
    return 'Claude Conversation';
  }
}
