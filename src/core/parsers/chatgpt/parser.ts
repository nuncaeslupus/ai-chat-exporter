/**
 * ChatGPT-specific conversation parser
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
import { CHATGPT_SELECTORS, isChatGPTUrl } from './selectors';

/**
 * Parser for ChatGPT conversations
 */
export class ChatGPTParser extends BaseParser {
  readonly platformInfo: PlatformInfo = {
    id: 'chatgpt',
    name: 'ChatGPT',
    urlPatterns: [
      /^https?:\/\/(www\.)?chat\.openai\.com/,
      /^https?:\/\/(www\.)?chatgpt\.com/,
    ],
  };

  readonly selectors = CHATGPT_SELECTORS;

  /**
   * Check if this parser can handle the current page
   */
  canParse(): boolean {
    const url = this.getUrl();
    return isChatGPTUrl(url);
  }

  /**
   * Get the conversation title from the page
   */
  getTitle(): string {
    // First try the page title - it contains the conversation title
    const pageTitle = this.document.querySelector('title')?.textContent?.trim();
    if (pageTitle && pageTitle !== 'ChatGPT' && !pageTitle.includes('OpenAI')) {
      return pageTitle;
    }

    // Try sidebar selectors as fallback
    const selectors = [
      this.selectors.conversationTitle,
      this.selectors.custom.conversationTitleFallback,
    ];

    for (const selector of selectors) {
      const element = this.document.querySelector(selector);
      const text = element?.textContent?.trim();
      if (text && text !== 'ChatGPT') {
        return text;
      }
    }

    // Try to extract from URL
    const url = this.getUrl();
    const match = url.match(/\/c\/([a-f0-9-]+)/);
    if (match) {
      const conversationLink = this.document.querySelector(`a[href*="${match[0]}"]`);
      const title = conversationLink
        ?.querySelector(this.selectors.custom.conversationTitleText)
        ?.textContent?.trim();
      if (title) {
        return title;
      }
    }

    return this.getDefaultTitle();
  }

  /**
   * Get the model name if detectable
   */
  getModel(): string | null {
    const modelElement = this.document.querySelector(this.selectors.modelIndicator);
    if (!modelElement) {
      return null;
    }

    // ChatGPT stores model in data-message-model-slug attribute
    const modelSlug = modelElement.getAttribute(this.selectors.custom.modelSlugAttr);
    return modelSlug || null;
  }

  /**
   * Find the best injection point for UI buttons
   */
  getButtonInjectionPoint(): HTMLElement | null {
    // Try each selector in the buttonArea (comma-separated)
    const selectors = this.selectors.custom.buttonArea.split(',').map((s) => s.trim());
    for (const selector of selectors) {
      const element = this.document.querySelector(selector);
      if (element instanceof HTMLElement) {
        return element;
      }
    }

    return null;
  }

  /**
   * Extract Q&A pairs from the ChatGPT DOM
   */
  protected extractQAPairs(config: ParserConfig): QAPair[] {
    const pairs: QAPair[] = [];
    const userMessages = this.extractUserMessages(config);
    const assistantMessages = this.extractAssistantMessages(config);

    // Pair up user and assistant messages
    const maxPairs = Math.min(userMessages.length, assistantMessages.length);
    for (let i = 0; i < maxPairs; i++) {
      const userMsg = userMessages[i];
      const assistantMsg = assistantMessages[i];
      // These are guaranteed to exist because i < maxPairs
      if (userMsg && assistantMsg) {
        const pair = this.createQAPair(i, userMsg, assistantMsg);
        pairs.push(pair);
      }
    }

    // Handle orphan user messages (no assistant response yet)
    // We skip these for now as they're incomplete

    return pairs;
  }

  /**
   * Extract all user messages from the DOM
   */
  private extractUserMessages(config: ParserConfig): Message[] {
    const messages: Message[] = [];

    // Get all user turns
    const userTurns = this.document.querySelectorAll(this.selectors.custom.userTurn);

    userTurns.forEach((turn) => {
      // Try to find a message element within the turn
      const messageElement = turn.querySelector(this.selectors.userMessage);

      if (messageElement) {
        const message = this.extractUserMessage(messageElement, config);
        if (message) {
          messages.push(message);
        }
      } else {
        // Fallback: treat the whole turn as a message
        const message = this.extractUserMessage(turn, config);
        if (message) {
          messages.push(message);
        }
      }
    });

    return messages;
  }

  /**
   * Extract a single user message
   */
  private extractUserMessage(element: Element, config: ParserConfig): Message | null {
    // Get message ID from attribute
    const messageId = element.getAttribute(this.selectors.custom.messageIdAttr) || this.generateId();

    // Extract images first so an image-only turn still occupies its slot
    const images = this.extractImages(element);

    // Find content element
    const contentElement = element.querySelector(this.selectors.custom.userMessageContent);

    let content: string | undefined;
    let htmlContent: string | undefined;

    if (!contentElement) {
      // Try to get content directly from the element
      content = element.textContent?.trim();
    } else {
      ({ content, htmlContent } = this.extractContent(contentElement, config.preserveHtml));
    }

    if (!content && images.length === 0) {
      return null;
    }

    const message = this.createMessage(
      'user',
      content || `[Uploaded images: ${images.map((img) => img.alt ?? 'image').join(', ')}]`,
      htmlContent,
      messageId
    );

    if (images.length > 0) {
      message.metadata = { ...message.metadata, images };
    }

    return message;
  }

  /**
   * Extract all assistant messages from the DOM
   */
  private extractAssistantMessages(config: ParserConfig): Message[] {
    const messages: Message[] = [];

    // Get all assistant turns (includes text, canvas, and image-gen turns)
    const assistantTurns = this.document.querySelectorAll(this.selectors.custom.assistantTurn);

    assistantTurns.forEach((turn) => {
      // Find ALL message elements within the turn (for deep research, there can be multiple)
      const messageElements = turn.querySelectorAll(this.selectors.assistantMessage);

      if (messageElements.length > 0) {
        // Normal text response(s) - may have multiple for deep research
        // Combine all messages from this turn into a single message
        const combinedMessage = this.extractCombinedMessage(turn, messageElements, config);
        if (combinedMessage) {
          messages.push(combinedMessage);
        }
      } else {
        // Special turn type (canvas or image-gen) - treat the whole turn as a message
        const message = this.extractAssistantMessage(turn, config);
        if (message) {
          messages.push(message);
        }
      }
    });

    return messages;
  }

  /**
   * Extract and combine multiple message elements from a single turn (for deep research, canvas, etc.)
   */
  private extractCombinedMessage(
    turn: Element,
    messageElements: NodeListOf<Element>,
    config: ParserConfig
  ): Message | null {
    const messageIdAttr = this.selectors.custom.messageIdAttr;
    const messageId = turn.getAttribute(messageIdAttr) ||
                     messageElements[0]?.getAttribute(messageIdAttr) ||
                     this.generateId();

    const contentParts: string[] = [];
    const htmlParts: string[] = [];
    const allImages: Array<{ src: string; alt?: string }> = [];

    // Check if this turn contains canvas content (should be extracted first)
    const canvasContent = this.extractCanvasContent(turn);
    if (canvasContent) {
      contentParts.push(canvasContent.text);
      htmlParts.push(canvasContent.html);
    }

    // Extract content from each message element
    messageElements.forEach((element) => {
      const contentElement = element.querySelector(this.selectors.custom.assistantMessageContent);

      if (contentElement) {
        const { content, htmlContent } = this.extractContent(contentElement, config.preserveHtml);
        if (content) {
          contentParts.push(content);
        }
        if (htmlContent) {
          htmlParts.push(htmlContent);
        }
      }

      // Extract images from this element
      const images = this.extractImages(element);
      allImages.push(...images);
    });

    if (contentParts.length === 0) {
      return null;
    }

    // Combine all content with line breaks
    const combinedContent = contentParts.join('\n\n');
    const combinedHtml = htmlParts.length > 0 ? htmlParts.join('\n') : undefined;

    // Extract deep research metadata from the turn
    const researchInfo = this.extractDeepResearchInfo(turn);

    // Extract code artifacts
    const artifacts = this.extractArtifacts(turn);

    // Extract web search citations
    const webSearches = this.extractWebSearches(turn);

    const message = this.createMessage('assistant', combinedContent, combinedHtml, messageId);

    // Add images to metadata
    if (allImages.length > 0) {
      message.metadata = { ...message.metadata, images: allImages };
    }

    // Add research info to metadata
    if (researchInfo) {
      message.metadata = { ...message.metadata, research: researchInfo };
    }

    // Add artifacts to metadata
    if (artifacts.length > 0) {
      message.metadata = { ...message.metadata, artifacts };
    }

    // Add web searches to metadata
    if (webSearches.length > 0) {
      message.metadata = { ...message.metadata, webSearches };
    }

    return message;
  }

  /**
   * Extract a single assistant message
   */
  private extractAssistantMessage(element: Element, config: ParserConfig): Message | null {
    // Get message ID from attribute
    const messageId = element.getAttribute(this.selectors.custom.messageIdAttr) || this.generateId();

    // Check if this is a canvas turn
    const canvasContent = this.extractCanvasContent(element);
    if (canvasContent) {
      const message = this.createMessage('assistant', canvasContent.text, canvasContent.html, messageId);
      return message;
    }

    // Check if this is an image generation turn
    const generatedImage = this.extractGeneratedImage(element);
    if (generatedImage) {
      const imageTitle = this.extractImageTitle(element);
      const content = imageTitle ? `[Image: ${imageTitle}]` : '[Generated Image]';
      const message = this.createMessage('assistant', content, undefined, messageId);
      message.metadata = { ...message.metadata, images: [generatedImage] };
      return message;
    }

    // Find content element (markdown content)
    const contentElement = element.querySelector(this.selectors.custom.assistantMessageContent);

    if (!contentElement) {
      // Try to get content directly from the element
      const text = element.textContent?.trim();
      if (!text) {
        return null;
      }
      return this.createMessage('assistant', text, undefined, messageId);
    }

    let { content, htmlContent } = this.extractContent(contentElement, config.preserveHtml);

    // Extract images from the assistant's turn
    const images = this.extractImages(element);

    // Extract deep research metadata
    const researchInfo = this.extractDeepResearchInfo(element);

    // Extract code artifacts
    const artifacts = this.extractArtifacts(element);

    // Extract web search citations
    const webSearches = this.extractWebSearches(element);

    if (!content) {
      return null;
    }

    const message = this.createMessage('assistant', content, htmlContent, messageId);

    // Add images to metadata
    if (images.length > 0) {
      message.metadata = { ...message.metadata, images };
    }

    // Add research info to metadata
    if (researchInfo) {
      message.metadata = { ...message.metadata, research: researchInfo };
    }

    // Add artifacts to metadata
    if (artifacts.length > 0) {
      message.metadata = { ...message.metadata, artifacts };
    }

    // Add web searches to metadata
    if (webSearches.length > 0) {
      message.metadata = { ...message.metadata, webSearches };
    }

    return message;
  }

  /**
   * Extract images from a message element
   */
  private extractImages(element: Element): Array<{ src: string; alt?: string; width?: number; height?: number }> {
    const images: Array<{ src: string; alt?: string; width?: number; height?: number }> = [];

    // Find all img tags within the message
    const imgElements = element.querySelectorAll('img');

    // A conversation-content <img> legitimately means one of: a user upload,
    // a generated image (handled separately by extractGeneratedImage), or an
    // image inline in the assistant's markdown. Everything else is UI chrome
    // that happens to contain an <img> -- an artifact's decorative code-panel
    // preview (lo-4b7f) or a web-citation pill's third-party favicon
    // (lo-37b2, see docs/dev/parser-gotchas.md #6). Exclusion is simpler than
    // an allow-list here: both non-content cases already have a stable
    // structural selector, while legitimate images have no unifying wrapper
    // to allow-list on.
    const excludedImageContainerSelector = [
      this.selectors.custom.codeArtifactContainer,
      this.selectors.custom.citationPill,
      'button',
    ].join(', ');

    imgElements.forEach((img) => {
      const src = img.getAttribute('src');
      const alt = img.getAttribute('alt');

      // Skip UI icons, tiny images, and non-content container images
      if (src && !src.includes('sprites-core') && !src.includes('icon') && !img.closest(excludedImageContainerSelector)) {
        const imageData: { src: string; alt?: string; width?: number; height?: number } = { src };
        if (alt) {
          imageData.alt = alt;
        }

        // Try to get dimensions from attributes first
        const widthAttr = img.getAttribute('width');
        const heightAttr = img.getAttribute('height');

        if (widthAttr) {
          imageData.width = parseInt(widthAttr, 10);
        }
        if (heightAttr) {
          imageData.height = parseInt(heightAttr, 10);
        }

        // If no attributes, get computed dimensions (actual rendered size).
        // clientWidth/clientHeight already force a layout read; only reach for
        // getComputedStyle() -- a second forced style recalc -- when those come
        // back empty (e.g. a hidden or zero-box image), instead of every image.
        if (!imageData.width || !imageData.height) {
          let computedWidth = img.clientWidth;
          let computedHeight = img.clientHeight;
          if (!computedWidth || !computedHeight) {
            const computed = window.getComputedStyle(img);
            computedWidth ||= parseInt(computed.width, 10);
            computedHeight ||= parseInt(computed.height, 10);
          }

          if (computedWidth && !isNaN(computedWidth)) {
            imageData.width = computedWidth;
          }
          if (computedHeight && !isNaN(computedHeight)) {
            imageData.height = computedHeight;
          }
        }

        images.push(imageData);
      }
    });

    return images;
  }

  /**
   * Extract canvas/document content
   */
  private extractCanvasContent(element: Element): { text: string; html: string } | null {
    // Look for canvas/document container
    const canvasElement = element.querySelector(this.selectors.custom.canvasContainer);
    if (!canvasElement) {
      return null;
    }

    // Find the ProseMirror content
    const proseMirrorContent = canvasElement.querySelector(this.selectors.custom.canvasContent);
    if (!proseMirrorContent) {
      return null;
    }

    const text = proseMirrorContent.textContent?.trim() || '';
    const html = proseMirrorContent.innerHTML || '';

    return text ? { text: `[Canvas Content]\n${text}`, html: `<div class="canvas-content">${html}</div>` } : null;
  }

  /**
   * Extract generated image from image-gen turn
   */
  private extractGeneratedImage(element: Element): { src: string; alt?: string; width?: number; height?: number } | null {
    // Look for image generation container
    const imageGenContainer = element.querySelector(this.selectors.custom.generatedImageContainer);
    if (!imageGenContainer) {
      return null;
    }

    // Find the actual image
    const img = imageGenContainer.querySelector('img');
    if (!img) {
      return null;
    }

    const src = img.getAttribute('src');
    if (!src) {
      return null;
    }

    const result: { src: string; alt?: string; width?: number; height?: number } = {
      src,
      alt: img.getAttribute('alt') || 'Generated image',
    };

    // Try to get dimensions from attributes first
    const widthAttr = img.getAttribute('width');
    const heightAttr = img.getAttribute('height');

    if (widthAttr) {
      result.width = parseInt(widthAttr, 10);
    }
    if (heightAttr) {
      result.height = parseInt(heightAttr, 10);
    }

    // If no attributes, get computed dimensions (actual rendered size).
    // clientWidth/clientHeight already force a layout read; only reach for
    // getComputedStyle() -- a second forced style recalc -- when those come
    // back empty (e.g. a hidden or zero-box image), instead of every image.
    if (!result.width || !result.height) {
      let computedWidth = img.clientWidth;
      let computedHeight = img.clientHeight;
      if (!computedWidth || !computedHeight) {
        const computed = window.getComputedStyle(img);
        computedWidth ||= parseInt(computed.width, 10);
        computedHeight ||= parseInt(computed.height, 10);
      }

      if (computedWidth && !isNaN(computedWidth)) {
        result.width = computedWidth;
      }
      if (computedHeight && !isNaN(computedHeight)) {
        result.height = computedHeight;
      }
    }

    return result;
  }

  /**
   * Extract the title of a generated image turn
   */
  private extractImageTitle(element: Element): string | null {
    // Look for the image title in the turn header
    // The structure is typically: "Imagen creada • Vacaciones románticas en Tailandia"
    const headerText = element
      .querySelector(this.selectors.custom.generatedImageTitle)
      ?.textContent?.trim();

    if (headerText) {
      // Extract text after the bullet point if present
      const parts = headerText.split('•');
      if (parts.length > 1) {
        return parts[1]?.trim() || null;
      }
      // Or just return the whole text if no bullet
      return headerText;
    }

    return null;
  }

  /**
   * Extract deep research information
   */
  private extractDeepResearchInfo(element: Element): { duration: string; sources: number; searches: number } | null {
    // Look for research completion indicator
    const researchButton = element.querySelector(this.selectors.custom.deepResearchButton);
    if (!researchButton) {
      return null;
    }

    const text = researchButton.textContent?.trim() || '';

    // Parse research info (e.g., "Research completed in 6m· 18 fuentes· 60 búsquedas")
    const durationMatch = text.match(/(\d+[msh])/);
    const sourcesMatch = text.match(/(\d+)\s*(?:fuentes|sources)/i);
    const searchesMatch = text.match(/(\d+)\s*(?:búsquedas|searches)/i);

    if (durationMatch || sourcesMatch || searchesMatch) {
      return {
        duration: durationMatch?.[1] ?? '',
        sources: sourcesMatch ? parseInt(sourcesMatch[1] ?? '0', 10) : 0,
        searches: searchesMatch ? parseInt(searchesMatch[1] ?? '0', 10) : 0,
      };
    }

    return null;
  }

  /**
   * Extract code artifacts from assistant message
   */
  private extractArtifacts(element: Element): Artifact[] {
    const artifacts: Artifact[] = [];

    // Find all code artifact containers
    const codeBlocks = element.querySelectorAll(this.selectors.custom.codeArtifactContainer);

    codeBlocks.forEach((block) => {
      // Extract language from the header. Legacy markup carried a `div.h-9`
      // label; ChatGPT's CodeMirror 6 viewer (2026-07) dropped that div, but
      // the same language name still appears as plain text next to an icon in
      // the sticky header above the editor (e.g. "Python"). Strip buttons from
      // a clone first so their labels ("Copy", "Run") don't leak into it --
      // this is a real DOM source, not a guess from the code body.
      let language = block
        .querySelector(this.selectors.custom.codeArtifactLanguage)
        ?.textContent.trim()
        .toLowerCase();
      if (!language) {
        const header = block.querySelector(this.selectors.custom.codeArtifactStickyHeader);
        if (header) {
          const headerClone = header.cloneNode(true) as Element;
          headerClone.querySelectorAll('button').forEach((btn) => {
            btn.remove();
          });
          language = headerClone.textContent.trim().toLowerCase() || undefined;
        }
      }
      language = language ?? 'code';

      // Extract code content. Legacy markup carries a classed <code>;
      // CodeMirror's <code> has no class at all, so fall back to the <code>
      // inside the CodeMirror viewer specifically (never the outer wrapper,
      // which would also pick up header/button text).
      const codeElement =
        block.querySelector(this.selectors.custom.codeArtifactContent) ??
        block.querySelector(this.selectors.custom.codeArtifactCodeMirrorCode);
      if (!codeElement) {
        return;
      }

      // Check if there's a rendered image (SVG preview)
      const imgElement = codeElement.querySelector('img');
      let content = '';
      let type = 'code';

      if (imgElement) {
        // For SVG artifacts with rendered preview, extract both image and code
        const imgSrc = imgElement.getAttribute('src');
        if (imgSrc) {
          type = 'image';
        }
        // Get the text content (actual SVG code) excluding the img tag
        const clonedCode = codeElement.cloneNode(true) as Element;
        const clonedImg = clonedCode.querySelector('img');
        if (clonedImg) {
          clonedImg.remove();
        }
        content = clonedCode.textContent?.trim() || '';
      } else {
        // Regular code block
        content = codeElement.textContent?.trim() || '';
      }

      if (!content) {
        return;
      }

      // Create artifact
      const artifact: Artifact = {
        type: language === 'svg' ? 'image' : type,
        title: language.charAt(0).toUpperCase() + language.slice(1),
        language,
        content,
      };

      artifacts.push(artifact);
    });

    return artifacts;
  }

  /**
   * Extract web search citations from assistant message
   */
  private extractWebSearches(element: Element): WebSearchResult[] {
    // Find all citation pills
    const citationLinks = element.querySelectorAll(this.selectors.custom.citationLink);

    if (citationLinks.length === 0) {
      return [];
    }

    const results: Array<{
      title: string;
      url: string;
      favicon?: string;
      domain?: string;
    }> = [];

    citationLinks.forEach((link) => {
      const url = link.getAttribute('href');
      const title = link.textContent?.trim();

      if (url && title) {
        // Extract domain from URL
        let domain: string | undefined;
        try {
          const urlObj = new URL(url);
          domain = urlObj.hostname.replace(/^www\./, '');
        } catch {
          // Invalid URL, skip domain
        }

        // ponytail: favicons were fetched from Google's favicon service,
        // which leaks cited domains to a third party every time the export
        // is opened. Favicons are decorative, so we just drop them instead
        // of inlining as data URIs (which would still fetch at export time).
        const result: {
          title: string;
          url: string;
          favicon?: string;
          domain?: string;
        } = {
          title,
          url,
        };

        if (domain) {
          result.domain = domain;
        }

        results.push(result);
      }
    });

    if (results.length === 0) {
      return [];
    }

    // Return a single WebSearchResult with all citations
    return [{
      query: 'Web Search',
      resultCount: results.length,
      results,
    }];
  }

  /**
   * Get default title when none is found
   */
  private getDefaultTitle(): string {
    return 'ChatGPT Conversation';
  }
}
