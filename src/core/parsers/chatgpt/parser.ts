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
import {
  CHATGPT_SELECTORS,
  EMBEDDED_FRAME_REPORT_ATTR,
  EMBEDDED_FRAME_REPORT_HTML_ATTR,
  isChatGPTUrl,
} from './selectors';
import { sanitizeHtml } from '../../utils/sanitize-html';

/**
 * Parser for ChatGPT conversations
 */
export class ChatGPTParser extends BaseParser {
  readonly platformInfo: PlatformInfo = {
    id: 'chatgpt',
    name: 'ChatGPT',
    urlPatterns: [/^https?:\/\/(www\.)?chat\.openai\.com/, /^https?:\/\/(www\.)?chatgpt\.com/],
  };

  readonly selectors = CHATGPT_SELECTORS;

  protected override get chromeStrings(): readonly string[] {
    return ['ChatGPT said:', 'You said:'];
  }

  protected override get requiredSelectorKeys(): readonly string[] {
    // custom.userTurn (not conversationTurn) is the one that's load-bearing:
    // it's half of the turn query in extractQAPairs and the sole role
    // discriminator there, so a rename that breaks only userTurn previously
    // went unguarded while conversationTurn -- read by no extraction code --
    // was required instead.
    return [...super.requiredSelectorKeys, 'custom.userTurn', 'custom.assistantTurn'];
  }

  /**
   * `textContent.length` of each pair's source turn element, index-aligned
   * with the pairs `extractQAPairs` emits. Feeds `turnTextLengthsFor` so the
   * `content-shortfall` drift rule can actually fire (it is otherwise
   * permanently suppressed -- see base-parser.ts).
   */
  private turnLengths: number[] = [];

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
    const match = /\/c\/([a-f0-9-]+)/.exec(url);
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
   * Extract Q&A pairs from the ChatGPT DOM.
   *
   * Pairs structurally: turns are walked in document order (one combined,
   * unfiltered query over both `userTurn` and `assistantTurn`), and each
   * user turn is paired with the assistant turn that immediately follows
   * it. A turn whose content fails to extract still occupies its slot in
   * that walk -- it degrades to an empty half plus a warning (see
   * `collectWarnings`) rather than being dropped, which is what previously
   * let a later answer silently shift onto the wrong question (lo-d0f0).
   */
  protected extractQAPairs(config: ParserConfig): QAPair[] {
    const pairs: QAPair[] = [];
    this.turnLengths = [];
    const turns = this.document.querySelectorAll(
      `${this.selectors.custom.userTurn}, ${this.selectors.custom.assistantTurn}`
    );

    let pendingQuestion: Message | null = null;
    let hasPendingQuestion = false;

    turns.forEach((turn) => {
      if (turn.matches(this.selectors.custom.userTurn)) {
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
          this.turnLengths.push(-1);
        }
        pendingQuestion = this.extractUserMessageFromTurn(turn, config);
        hasPendingQuestion = true;
        return;
      }

      // Assistant turn.
      const answer = this.extractAssistantMessageFromTurn(turn, config);
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
      this.turnLengths.push(turn.textContent?.length ?? -1);
      pendingQuestion = null;
      hasPendingQuestion = false;
    });

    // A trailing pending question (no assistant reply yet) is an in-progress
    // conversation -- skip it, same as before.

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
      if (!pair.answer.content) {
        warnings.push(`Turn ${turn}: the answer could not be read`);
      }
    }

    return warnings.length > 0 ? warnings : undefined;
  }

  /**
   * Extract the user message from a single user turn.
   */
  private extractUserMessageFromTurn(turn: Element, config: ParserConfig): Message | null {
    const messageElement = turn.querySelector(this.selectors.userMessage);
    return this.extractUserMessage(messageElement ?? turn, config);
  }

  /**
   * Extract the assistant message from a single assistant turn.
   */
  private extractAssistantMessageFromTurn(turn: Element, config: ParserConfig): Message | null {
    // Find ALL message elements within the turn (for deep research, there can be multiple)
    const messageElements = turn.querySelectorAll(this.selectors.assistantMessage);

    if (messageElements.length > 0) {
      // Normal text response(s) - may have multiple for deep research
      // Combine all messages from this turn into a single message
      return this.extractCombinedMessage(turn, messageElements, config);
    }

    // Special turn type (canvas or image-gen) - treat the whole turn as a message
    return this.extractAssistantMessage(turn, config);
  }

  /**
   * Extract a single user message
   */
  private extractUserMessage(element: Element, config: ParserConfig): Message | null {
    // Get message ID from attribute
    const messageId =
      element.getAttribute(this.selectors.custom.messageIdAttr) || this.generateId();

    // Extract images first so an image-only turn still occupies its slot
    const images = this.extractImages(element);

    // Find content element
    const contentElement = element.querySelector(this.selectors.custom.userMessageContent);

    let content: string | undefined;
    let htmlContent: string | undefined;

    if (!contentElement) {
      // Try to get content directly from the element. Via extractContent, not
      // raw textContent: the turn wrapper carries ChatGPT's screenreader label
      // ("You said:"), and that is not the user's message (lo-f132).
      content = this.extractContent(element, false).content;
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
   * Extract and combine multiple message elements from a single turn (for deep research, canvas, etc.)
   */
  private extractCombinedMessage(
    turn: Element,
    messageElements: NodeListOf<Element>,
    config: ParserConfig
  ): Message | null {
    const messageIdAttr = this.selectors.custom.messageIdAttr;
    const messageId =
      turn.getAttribute(messageIdAttr) ||
      messageElements[0]?.getAttribute(messageIdAttr) ||
      this.generateId();

    const contentParts: string[] = [];
    const htmlParts: string[] = [];
    const allImages: { src: string; alt?: string }[] = [];

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
    const messageId =
      element.getAttribute(this.selectors.custom.messageIdAttr) || this.generateId();

    // Check if this is a canvas turn
    const canvasContent = this.extractCanvasContent(element);
    if (canvasContent) {
      const message = this.createMessage(
        'assistant',
        canvasContent.text,
        canvasContent.html,
        messageId
      );
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
      // A widget answer (Deep Research) has no readable body at all, so
      // announce it; otherwise fall back to the turn's own text -- via
      // extractContent, not raw textContent, because the turn wrapper carries
      // ChatGPT's screenreader label ("ChatGPT said:") and shipping that as the
      // answer is how a Deep Research export came out 13 characters long.
      const widget = this.extractEmbeddedWidgetContent(element);
      const content = widget?.content ?? this.extractContent(element, false).content;
      if (!content) {
        return null;
      }
      const message = this.createMessage('assistant', content, widget?.htmlContent, messageId);

      // The relayed report content never carries the research-stats bar (it's
      // widget chrome, stripped before it reaches the parser) -- the real
      // duration/source/search counts still come from the outer page's own
      // research-completed button, exactly like the ordinary branch below.
      const researchInfo = this.extractDeepResearchInfo(element);
      if (researchInfo) {
        message.metadata = { ...message.metadata, research: researchInfo };
      }
      return message;
    }

    const { content, htmlContent } = this.extractContent(contentElement, config.preserveHtml);

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
  private extractImages(
    element: Element
  ): { src: string; alt?: string; width?: number; height?: number }[] {
    const images: { src: string; alt?: string; width?: number; height?: number }[] = [];

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
      if (
        src &&
        !src.includes('sprites-core') &&
        !src.includes('icon') &&
        !img.closest(excludedImageContainerSelector)
      ) {
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

    return text
      ? { text: `[Canvas Content]\n${text}`, html: `<div class="canvas-content">${html}</div>` }
      : null;
  }

  /**
   * Extract generated image from image-gen turn
   */
  private extractGeneratedImage(
    element: Element
  ): { src: string; alt?: string; width?: number; height?: number } | null {
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
   * Content for an answer ChatGPT renders in a sandboxed cross-origin frame
   * instead of in the page -- Deep Research, and any sibling connector
   * widget, since they all carry `title="internal://<widget>"`.
   *
   * The frame's own document is on `*.oaiusercontent.com`, cross-origin from
   * the page, so this parser cannot read a single character of it directly.
   * A content script running *inside* the frame (let in because
   * `allow-same-origin` keeps the frame's real origin) relays the rendered
   * text out over `postMessage`, and the page's content script stashes it on
   * this iframe element as `EMBEDDED_FRAME_REPORT_ATTR` (lo-9001) -- prefer
   * that when present.
   *
   * When it is not (the relay never ran, the frame never finished rendering,
   * the text came back empty), fall back to naming the widget: the src
   * carries no report id either (`?app=chatgpt&locale=…` only), so there is
   * no link worth emitting, and naming the widget beats the screenreader
   * label or nothing at all.
   *
   * ponytail: only the widget-only turn is covered. A turn mixing a widget
   * with real markdown would keep the markdown and drop this -- no capture
   * shows one; extend `extractCombinedMessage` the same way if one turns up.
   */
  private extractEmbeddedWidgetContent(
    element: Element
  ): { content: string; htmlContent?: string } | null {
    const frame = element.querySelector(this.selectors.custom.embeddedWidgetFrame);
    if (!frame) {
      return null;
    }

    const reportHtml = frame.getAttribute(EMBEDDED_FRAME_REPORT_HTML_ATTR)?.trim();
    if (reportHtml) {
      // Re-sanitize even though deep-research-frame.ts already sanitized before
      // relaying: this string is about to become live DOM in the page's own
      // content-script context, and that's a security-sensitive spot worth a
      // second, cheap pass rather than trusting the relay unconditionally.
      // Parsed rather than assigned to `innerHTML` so AMO's linter has nothing
      // to flag (#258); `DOMParser` is inert by construction.
      const parser = new (frame.ownerDocument.defaultView ?? window).DOMParser();
      const container = parser.parseFromString(sanitizeHtml(reportHtml), 'text/html').body;
      this.replaceDiagramsWithMarker(container);
      this.stripDigitOdometerRuns(container);
      this.stripResearchStatsHeader(container);
      this.dedupeAdjacentDuplicates(container);
      const { content, htmlContent } = this.extractContent(container, true);
      if (content) {
        return htmlContent ? { content, htmlContent } : { content };
      }
    }

    const reportText = frame.getAttribute(EMBEDDED_FRAME_REPORT_ATTR)?.trim();
    if (reportText) {
      return { content: this.stripDigitOdometerDumpFromText(reportText) };
    }

    const title = frame.getAttribute('title');
    const name = (title ?? '')
      .replace(/^internal:\/\//, '')
      .replace(/[-_]/g, ' ')
      .trim()
      .replace(/\b[a-z]/g, (c) => c.toUpperCase());

    return name
      ? { content: `[${name}: rendered in an embedded viewer ChatGPT does not expose to the page]` }
      : null;
  }

  /**
   * Container tags whose direct children are never candidates for
   * `dedupeAdjacentDuplicates`: a `<tr>`'s cells, a `<tbody>`'s rows, a
   * `<ul>`/`<ol>`/`<dl>`'s items routinely repeat the same text on purpose
   * (unit columns, "-" placeholders, repeated ranges like "~6-8 bar", or a
   * genuinely repeated list entry) -- that repetition is real content, not
   * chrome. Belt-and-braces with the heading-only restriction below: even
   * without this list, a `<td>`/`<th>`/`<li>` is never itself a heading tag,
   * so it could only ever be removed as the *earlier* half of a pair, and its
   * sibling is never a heading either -- but excluding these containers
   * outright also protects duplicate whole *rows* under `<tbody>`, which the
   * heading check alone would not catch.
   */
  private static readonly DEDUPE_SKIP_PARENTS = new Set([
    'tr',
    'tbody',
    'thead',
    'table',
    'ul',
    'ol',
    'dl',
  ]);

  /**
   * Drop an element that is exactly repeated by its immediately following
   * sibling, keeping the later one -- but only when the later one is a
   * heading (`h1`-`h6`). The relayed Deep Research report was observed with
   * its title rendered twice in a row -- widget chrome (a title bar, rendered
   * before the report body) showing the title as plain text, immediately
   * followed by the report's own heading with the same text. Restricting to
   * "the survivor is a heading" targets exactly that defect -- a duplicated
   * title, one specific piece of leading chrome -- rather than treating
   * "repeats its neighbor" as a general property of the whole document, which
   * used to be able to eat a `<td>`/`<li>` that legitimately repeats an
   * adjacent one (a unit column, a "-" placeholder, a genuinely repeated list
   * entry).
   */
  private dedupeAdjacentDuplicates(root: Element): void {
    const isHeading = (el: Element) => /^h[1-6]$/.test(el.tagName.toLowerCase());
    const containers = [root, ...Array.from(root.querySelectorAll('*'))].filter(
      (el) => !ChatGPTParser.DEDUPE_SKIP_PARENTS.has(el.tagName.toLowerCase())
    );
    for (const parent of containers) {
      let previous: Element | null = null;
      for (const child of Array.from(parent.children)) {
        const text = child.textContent?.trim() ?? '';
        if (text && previous && isHeading(child) && (previous.textContent?.trim() ?? '') === text) {
          previous.remove();
        }
        previous = child;
      }
    }
  }

  /**
   * Drop a run of 10+ consecutive sibling elements whose own text is exactly
   * one digit. ChatGPT renders the citation/search counters as an animated
   * "odometer" column -- all ten digits sit in the DOM, translated out of
   * view by CSS, so a text-based capture (real Chrome's `innerText` included
   * -- it reflects `display`/`visibility`/`opacity`, not `transform`) picks up
   * every one, with the actual counts nowhere in that text.
   *
   * ponytail: a structural guess (10+ consecutive single-digit siblings), not
   * a selector confirmed live -- no browser access to the real sandboxed
   * widget DOM. It matches the reported shape (ten stacked digits per
   * counter, two counters). The real duration/source/search counts are
   * unaffected either way: they come from the outer page's own
   * research-completed button (`extractDeepResearchInfo`), never from this
   * relayed content. Swap in a real selector once a live capture confirms the
   * exact markup.
   */
  private stripDigitOdometerRuns(root: Element): void {
    const DIGIT_RUN_THRESHOLD = 10;
    const containers = [root, ...Array.from(root.querySelectorAll('*'))];
    for (const parent of containers) {
      const children = Array.from(parent.children);
      let runStart = -1;
      for (let i = 0; i <= children.length; i++) {
        const child = children[i];
        const isDigit = !!child && /^\d$/.test(child.textContent?.trim() ?? '');
        if (isDigit) {
          runStart = runStart === -1 ? i : runStart;
          continue;
        }
        if (runStart !== -1 && i - runStart >= DIGIT_RUN_THRESHOLD) {
          for (let j = runStart; j < i; j++) {
            children[j]?.remove();
          }
        }
        runStart = -1;
      }
    }
  }

  /**
   * A line that is either the "Research completed in …" lead-in or nothing
   * but the trailing "N citations · N searches" (English) / "N fuentes · N
   * búsquedas" (Spanish) tail -- once `stripDigitOdometerRuns` has removed the
   * digit spans, that tail's own count is gone too, which is exactly the
   * "counts missing" shape the bug report describes.
   */
  private static readonly RESEARCH_STATS_LEAF_RE =
    /^research completed in\b.*$|^(?:[\d\s·.,]|citations?|searches?|sources?|fuentes?|búsquedas?)+$/i;

  /**
   * Drop the report's own "Research completed in Xm · N citations · N
   * searches" header line entirely, rather than leaving a truncated residue
   * (numbers already gone once the odometer digits are stripped) sitting in
   * the body as an orphaned paragraph. Safe to drop outright: the real
   * duration/source/search counts are already recovered from the outer
   * page's stable, non-animated research-completed button
   * (`extractDeepResearchInfo`), so this relayed copy is pure duplicate
   * chrome either way.
   *
   * Only matches leaf elements (no element children) so it can never eat an
   * ancestor that happens to also wrap unrelated report content.
   */
  private stripResearchStatsHeader(root: Element): void {
    const leaves = [root, ...Array.from(root.querySelectorAll('*'))].filter(
      (el) => el.children.length === 0
    );
    for (const leaf of leaves) {
      const text = leaf.textContent?.trim() ?? '';
      if (text && ChatGPTParser.RESEARCH_STATS_LEAF_RE.test(text)) {
        leaf.remove();
      }
    }
  }

  /**
   * Text-only fallback of `stripDigitOdometerRuns` + `stripResearchStatsHeader`,
   * for the plain-text relay tier (no DOM to walk there -- just a flattened
   * string). Real Chrome's `innerText` puts each rendered line on its own
   * line, which is the reported shape: one odometer digit per line, and the
   * research-stats lead-in/tail each on their own line too.
   */
  private stripDigitOdometerDumpFromText(text: string): string {
    const lines = text.split('\n');
    const kept: string[] = [];
    let run: string[] = [];
    const flushRun = (): void => {
      if (run.length < 10) {
        kept.push(...run);
      }
      run = [];
    };
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^\d$/.test(trimmed)) {
        run.push(line);
        continue;
      }
      flushRun();
      if (trimmed && ChatGPTParser.RESEARCH_STATS_LEAF_RE.test(trimmed)) {
        continue;
      }
      kept.push(line);
    }
    flushRun();
    return kept.join('\n');
  }

  /**
   * An icon (~16-24px) vs. a diagram (the Mermaid timeline was hundreds of px
   * wide) can only be told apart here by attributes, not layout -- jsdom has
   * no layout at all (`getBoundingClientRect` is always zero), and even in a
   * real browser the frame this HTML came from no longer exists by the time
   * this runs. Reads `width`/`height` first, falling back to `viewBox`'s
   * third/fourth numbers when those are absent.
   */
  private static readonly DIAGRAM_MIN_DIMENSION = 80;

  /**
   * Whether an `<svg>` is plausibly a diagram rather than a decorative icon
   * (a citation-pill glyph, a bullet, a disclosure arrow -- ChatGPT's
   * rendered content is full of these, and an earlier version of this feature
   * flagged every one as `[Diagram: ...]`, which was noisier than the bare
   * axis-label dump it replaced).
   *
   * Size is the primary signal (see `DIAGRAM_MIN_DIMENSION`). When no size
   * information exists at all -- no `width`/`height`, no `viewBox` -- there is
   * no positive evidence either way, so this prefers the old strip-silently
   * behavior (treat it as an icon) unless a `<title>`/`<desc>`/`aria-label`
   * explicitly names it a diagram/chart/graph/timeline/mermaid.
   */
  private isPlausibleDiagram(svg: Element): boolean {
    const parseDimension = (value: string | null): number | null => {
      if (!value) return null;
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    let width = parseDimension(svg.getAttribute('width'));
    let height = parseDimension(svg.getAttribute('height'));

    if (width === null || height === null) {
      const viewBox = svg
        .getAttribute('viewBox')
        ?.trim()
        .split(/[\s,]+/)
        .map(Number);
      if (viewBox?.length === 4 && viewBox.every((n) => Number.isFinite(n))) {
        width ??= viewBox[2] ?? null;
        height ??= viewBox[3] ?? null;
      }
    }

    if (width !== null && height !== null) {
      return (
        width >= ChatGPTParser.DIAGRAM_MIN_DIMENSION &&
        height >= ChatGPTParser.DIAGRAM_MIN_DIMENSION
      );
    }

    const label = (
      svg.querySelector('title, desc')?.textContent ??
      svg.getAttribute('aria-label') ??
      ''
    ).toLowerCase();
    return /diagram|chart|graph|timeline|mermaid/.test(label);
  }

  /**
   * Replace a diagram (rendered as inline SVG -- ChatGPT's Deep Research
   * report uses this for a Mermaid timeline) with a short honest marker
   * instead of letting it flatten to a bare dump of its text nodes (axis
   * dates, stray labels) further down the pipeline. A small decorative SVG
   * (icons, bullets) is left alone here and falls through to
   * `extractContent`'s existing cleanup, which strips it silently as
   * decorative chrome, same as before this change.
   */
  private replaceDiagramsWithMarker(root: Element): void {
    root.querySelectorAll('svg').forEach((svg) => {
      if (!this.isPlausibleDiagram(svg)) {
        return;
      }
      const marker = svg.ownerDocument.createElement('p');
      marker.textContent = '[Diagram: not shown -- not representable in this export]';
      svg.replaceWith(marker);
    });
  }

  /**
   * Extract deep research information
   */
  private extractDeepResearchInfo(
    element: Element
  ): { duration: string; sources: number; searches: number } | null {
    // Look for research completion indicator
    const researchButton = element.querySelector(this.selectors.custom.deepResearchButton);
    if (!researchButton) {
      return null;
    }

    const text = researchButton.textContent?.trim() || '';

    // Parse research info (e.g., "Research completed in 6m· 18 fuentes· 60 búsquedas")
    const durationMatch = /(\d+[msh])/.exec(text);
    const sourcesMatch = /(\d+)\s*(?:fuentes|sources)/i.exec(text);
    const searchesMatch = /(\d+)\s*(?:búsquedas|searches)/i.exec(text);

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
      // Assigned by both branches below; ESLint 10's `no-useless-assignment`
      // flags an initializer nothing can read.
      let content: string;
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

    const results: {
      title: string;
      url: string;
      favicon?: string;
      domain?: string;
    }[] = [];

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
    return [
      {
        query: 'Web Search',
        resultCount: results.length,
        results,
      },
    ];
  }

  /**
   * Get default title when none is found
   */
  private getDefaultTitle(): string {
    return 'ChatGPT Conversation';
  }
}
