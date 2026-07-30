/**
 * PDF exporter using jsPDF with structured content rendering
 */

import type { jsPDF } from 'jspdf';
import type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  Conversation,
  QAPair,
  PDFExportOptions,
  StructuredContentBlock,
  StructuredConversation,
  InlineContent,
  ListBlock,
  TableBlock,
  ImageBlock,
  Artifact,
  WebSearchResult,
} from '../types';
import { DEFAULT_PDF_OPTIONS } from '../types';
import { BaseExporter } from './base-exporter';
import { isProseArtifact } from './artifact-content';
import { escapeHtmlText, loadMarkdownRenderer } from './code-highlight';
import { EMBEDDED_FONTS } from './pdf-fonts.generated';
import { ConversationStructureService, HtmlContentParser } from '../services';
import { getMessageWithValues } from '../../shared/i18n';
import { sanitizeTextForPDF } from '../utils/pdf-characters';
import { loadImagesParallel, type LoadedImage } from '../utils/image-loader';
import {
  COLOR,
  FONT_FAMILY,
  FONT_SIZE_PT,
  PAGINATION,
  PDF_FONT_SIZE_PT,
  SPACING,
  bodyHeadingLevel,
  brandColorFor,
  buildHeadingLevelMap,
  fontScaleFactor,
  hexToRgbTuple,
  scaleFontSizes,
} from './style-tokens';
import type { HeadingLevelMap } from './style-tokens';

/**
 * jsPDF types `splitTextToSize` as returning `any`; it returns the wrapped lines.
 */
function splitLines(doc: jsPDF, text: string, width: number): string[] {
  return doc.splitTextToSize(text, width) as string[];
}

/**
 * Breathing room, in lines, that renderBlocks demands before starting any
 * block. Anything that must stay with the block below it (a role label) has to
 * reserve at least this much too, or renderBlocks page-breaks straight after it
 * and strands it — which is exactly what used to happen to the role label.
 */
const BLOCK_MIN_LINES = 3;

/**
 * Padding (mm) around the question's turn-fill rect (R-2b), so the fill reads
 * as a card around the label + content rather than hugging the glyphs.
 */
const QUESTION_FILL_PADDING_MM = { top: 2, bottom: 2, side: 3 };

/**
 * Exports conversations to PDF format
 */
export class PdfExporter extends BaseExporter {
  readonly format: ExportFormat = 'pdf';
  readonly extension = 'pdf';
  readonly mimeType = 'application/pdf';

  private imageCache = new Map<string, LoadedImage | null>();

  /**
   * The size tables for this export, already multiplied by the chosen step.
   * Set once per export (a fresh exporter is built per export, like
   * `imageCache`) so the ~30 draw sites below never see an unscaled size —
   * there is no call site that can forget to apply it.
   */
  private sizes = scaleFontSizes(FONT_SIZE_PT);
  private pdfSizes = scaleFontSizes(PDF_FONT_SIZE_PT);

  /**
   * Normalised source-heading-level -> document-heading-level map (D-32), set
   * once per export from the conversation's actual heading levels -- same
   * per-instance-state pattern as `sizes`/`pdfSizes` above (a fresh exporter is
   * built per export), so the many nested render* methods below can read it
   * without threading it through every call's already-long parameter list.
   */
  private headingLevelMap: HeadingLevelMap = new Map();

  /**
   * The families this document actually draws with — the embedded faces once
   * `registerFonts` succeeds, the built-ins if it could not. Read rather than
   * `FONT_FAMILY.*.pdf` directly, so a registration failure degrades to a
   * working PDF in a plainer font instead of an export that dies at the first
   * `setFont`.
   */
  private fonts: { body: string; code: string } = {
    body: FONT_FAMILY.body.pdf,
    code: FONT_FAMILY.code.pdf,
  };

  /**
   * Markdown -> sanitized HTML, for prose artifacts. Null when `marked` could
   * not be loaded, in which case a prose artifact falls back to a code block
   * (same fallback as html-exporter).
   */
  private markdown: ((md: string) => string | null) | null = null;

  /**
   * Export selected Q&A pairs to PDF
   */
  async export(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      this.sizes = scaleFontSizes(FONT_SIZE_PT, options.fontScale);
      this.pdfSizes = scaleFontSizes(PDF_FONT_SIZE_PT, options.fontScale);
      // pdf has no code highlighting today (unlike html/docx), so the fenced-code
      // renderer only needs to keep the markup inert — `renderCodeBlock` renders
      // plain monospace text regardless.
      this.markdown = await loadMarkdownRenderer(null, escapeHtmlText);

      // Convert to structured format (only the selected pairs)
      const structured = ConversationStructureService.toStructured({
        ...conversation,
        pairs: selectedPairs,
      });
      this.headingLevelMap = buildHeadingLevelMap(
        ConversationStructureService.collectHeadingLevels(structured)
      );

      // Extract and load all images before rendering
      const imageUrls = this.extractImageUrls(structured);
      if (imageUrls.length > 0) {
        // Load at 300px max width to match display size (~200px) with some quality margin
        this.imageCache = await loadImagesParallel(imageUrls, 300, 3);
      }

      // Dynamic import for jsPDF
      const jspdfModule = await import('jspdf');
      const jsPDF = jspdfModule.jsPDF;

      const pdfOptions = options.pdfOptions ?? DEFAULT_PDF_OPTIONS;
      const doc = new jsPDF({
        orientation: pdfOptions.orientation,
        unit: 'mm',
        format: pdfOptions.pageSize,
      });
      this.registerFonts(doc);

      this.renderContent(doc, structured, options, pdfOptions);

      const blob = doc.output('blob');
      return this.createSuccessResult(blob, options.filename);
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Failed to export to PDF'
      );
    }
  }

  /**
   * Register the embedded TrueType faces with this document (R-2b).
   *
   * Must run before any `setFont`, and per document — jsPDF's virtual file
   * system is per instance. If registration fails the export continues on the
   * built-in fonts rather than dying: a missing glyph is better than no file.
   *
   * The font module is imported HERE and nowhere else. It is ~200 KB of base64,
   * and pdf-exporter is itself loaded on demand, so it rides the pdf chunk. An
   * import from the barrel or a shared module would pull it into the eager
   * content-script bundle, which is injected into every page load.
   */
  private registerFonts(doc: jsPDF): void {
    try {
      for (const font of EMBEDDED_FONTS) {
        doc.addFileToVFS(font.vfsName, font.base64);
        doc.addFont(font.vfsName, font.family, font.style);
      }
      this.fonts = { body: FONT_FAMILY.body.pdf, code: FONT_FAMILY.code.pdf };
    } catch (error) {
      // Fall back to the built-in families as a PAIR. Leaving `fonts` pointing
      // at the embedded names after a failed registration would have every
      // later setFont ask jsPDF for a face it never received.
      console.warn('[PDF Exporter] Falling back to built-in fonts:', error);
      this.fonts = { body: 'helvetica', code: 'courier' };
    }
  }

  /**
   * Extract all image URLs from the structured conversation
   */
  private extractImageUrls(conversation: StructuredConversation): string[] {
    const urls: string[] = [];

    for (const pair of conversation.pairs) {
      // Extract from question blocks
      this.extractImageUrlsFromBlocks(pair.question.blocks, urls);
      // Extract from answer blocks
      this.extractImageUrlsFromBlocks(pair.answer.blocks, urls);
    }

    return urls;
  }

  /**
   * Recursively extract image URLs from content blocks
   */
  private extractImageUrlsFromBlocks(blocks: StructuredContentBlock[], urls: string[]): void {
    for (const block of blocks) {
      if (block.type === 'image') {
        urls.push(block.url);
      } else if (block.type === 'blockquote') {
        this.extractImageUrlsFromBlocks(block.content, urls);
      }
    }
  }

  /**
   * Render content to the PDF document with improved formatting
   */
  private renderContent(
    doc: jsPDF,
    conversation: StructuredConversation,
    options: ExportOptions,
    pdfOptions: PDFExportOptions
  ): void {
    const margins = pdfOptions.margins;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - margins.left - margins.right;

    let y = margins.top;
    /*
     * pdf's layout is hand-rolled, so the line advance is a constant rather
     * than something derived from the font size — which means scaling the
     * sizes alone would shrink the glyphs and leave the leading (and the page
     * count) exactly where it was. It is the same factor, so the ratio of text
     * to leading is unchanged at every step.
     */
    const lineHeight = 6 * fontScaleFactor(options.fontScale);

    // Title
    doc.setFontSize(this.pdfSizes.title);
    doc.setFont(this.fonts.body, 'bold');
    doc.setTextColor(...hexToRgbTuple(COLOR.textPrimary));
    doc.text(sanitizeTextForPDF(conversation.title), margins.left, y);
    y += lineHeight * 2.5;

    // Metadata
    if (options.showMetaInfo) {
      doc.setFontSize(this.sizes.meta);
      doc.setFont(this.fonts.body, 'normal');
      doc.setTextColor(...hexToRgbTuple(COLOR.textMuted));

      doc.text(
        `${this.getMetadataLabel('platform')}: ${this.formatPlatformName(conversation.platform)}`,
        margins.left,
        y
      );
      y += lineHeight;

      if (conversation.model) {
        doc.text(`${this.getMetadataLabel('model')}: ${conversation.model}`, margins.left, y);
        y += lineHeight;
      }

      const dateRange = this.formatDateRange(conversation.pairs);
      if (dateRange) {
        doc.text(
          sanitizeTextForPDF(`${this.getMetadataLabel('dateRange')}: ${dateRange}`),
          margins.left,
          y
        );
        y += lineHeight;
      }

      if (conversation.createdAt) {
        doc.text(
          `${this.getMetadataLabel('exported')}: ${this.formatTimestamp(conversation.createdAt)}`,
          margins.left,
          y
        );
        y += lineHeight;
      }

      doc.text(`${this.getMetadataLabel('url')}: ${conversation.url}`, margins.left, y);
      y += lineHeight;

      // Draw separator line
      y += lineHeight * 0.5;
      doc.setDrawColor(...hexToRgbTuple(COLOR.border));
      doc.setLineWidth(0.5);
      doc.line(margins.left, y, pageWidth - margins.right, y);
      y += lineHeight * 1.5;
    }

    // Q&A pairs
    doc.setFontSize(this.sizes.body);

    // Get assistant name and color based on platform
    const assistantInfo = this.getAssistantInfo(conversation.platform);

    const daySeparator = this.daySeparator(options.showMetaInfo);
    const pageCentre = pageWidth / 2;
    const renderDaySeparator = (date: Date | undefined, currentY: number): number => {
      const separator = daySeparator(date);
      if (!separator) return currentY;

      doc.setFontSize(this.sizes.meta);
      doc.setFont(this.fonts.body, 'normal');
      doc.setTextColor(...hexToRgbTuple(COLOR.textMuted));
      doc.text(sanitizeTextForPDF(separator), pageCentre, currentY + lineHeight, {
        align: 'center',
      });
      doc.setFontSize(this.sizes.body);
      return currentY + lineHeight * 2;
    };

    for (const pair of conversation.pairs) {
      // Check if we need a new page
      y = this.ensureSpace(doc, y, lineHeight * 10, margins, pageHeight);

      y = renderDaySeparator(pair.question.timestamp, y);

      // User message (blue). isQuestion=true: the design fills the
      // QUESTION's box (R-6 moved the turn fill off the answer, onto the
      // question, so the background says who is asking).
      y = this.renderMessage(
        doc,
        `${this.getRoleName('user')}${this.formatTimestampSuffix(pair.question.timestamp, options.showMetaInfo)}`,
        pair.question.blocks,
        y,
        margins,
        contentWidth,
        lineHeight,
        pageHeight,
        hexToRgbTuple(COLOR.link),
        true
      );

      // Add spacing between user and assistant
      y += lineHeight * 0.5;

      y = renderDaySeparator(pair.answer.timestamp, y);

      // Assistant message (platform-specific color and name)
      y = this.renderMessage(
        doc,
        `${assistantInfo.name}${this.formatTimestampSuffix(pair.answer.timestamp, options.showMetaInfo)}`,
        pair.answer.blocks,
        y,
        margins,
        contentWidth,
        lineHeight,
        pageHeight,
        assistantInfo.color
      );

      // Render artifacts if present
      if (pair.answer.metadata?.artifacts && Array.isArray(pair.answer.metadata.artifacts)) {
        const artifactsWithContent = pair.answer.metadata.artifacts.filter((a) => a.content);
        if (artifactsWithContent.length > 0) {
          y += lineHeight * 0.5;
          y = this.renderArtifacts(
            doc,
            artifactsWithContent,
            y,
            margins,
            contentWidth,
            lineHeight,
            pageHeight
          );
        }
      }

      // Render web search results if present
      if (pair.answer.metadata?.webSearches && Array.isArray(pair.answer.metadata.webSearches)) {
        const webSearches = pair.answer.metadata.webSearches;
        if (webSearches.length > 0) {
          y += lineHeight * 0.5;
          y = this.renderWebSearches(
            doc,
            webSearches,
            y,
            margins,
            contentWidth,
            lineHeight,
            pageHeight
          );
        }
      }

      // Add spacing between pairs
      y += lineHeight * 1.5;
    }

    // Page numbers
    if (pdfOptions.includePageNumbers) {
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(this.pdfSizes.small);
        doc.setTextColor(...hexToRgbTuple(COLOR.textFaint));
        // Attribution left, page number right — the design's footer. The
        // attribution is deliberately not localized: it is the product name.
        doc.text('Exported with AI Chat Exporter', margins.left, pageHeight - margins.bottom / 2);
        doc.text(
          getMessageWithValues('pageNumberFormat', String(i), String(pageCount)),
          pageWidth - margins.right,
          pageHeight - margins.bottom / 2,
          { align: 'right' }
        );
      }
    }
  }

  /**
   * Start a new page when `needed` mm of content will not fit below `y`.
   *
   * pdf's layout is hand-rolled, so every "keep together" rule here is a
   * measurement taken before drawing rather than a property Word/CSS applies
   * for us. This is the single place that measurement lives.
   */
  private ensureSpace(
    doc: jsPDF,
    y: number,
    needed: number,
    margins: { top: number; bottom: number },
    pageHeight: number
  ): number {
    if (y + needed > pageHeight - margins.bottom) {
      doc.addPage();
      return margins.top;
    }
    return y;
  }

  /**
   * Render a single message (user or assistant).
   *
   * `isQuestion` fills the message's box with the design's turn fill (R-6
   * moved it from the answer to the question — the background says who is
   * asking). pdf's layout is hand-rolled top-to-bottom and jsPDF has no
   * z-order, so a rect drawn after the label/body would cover them: the box
   * height is needed BEFORE drawing anything. `measure()` runs
   * `renderMessageBody` — the exact function that is about to draw for real —
   * with its drawing calls stubbed, so the fill uses the same y math as the
   * real render rather than a second, parallel height calculation.
   */
  private renderMessage(
    doc: jsPDF,
    role: string,
    blocks: StructuredContentBlock[],
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number,
    roleColor: [number, number, number],
    isQuestion = false
  ): number {
    // Keep-with-next: the label plus the first lines of its message must fit,
    // or the label strands at the foot of the page with its content overleaf.
    // Decided once, for real — a dry-run measurement below reuses this same
    // startY, so deciding it twice would risk a spurious second page break.
    const y = this.ensureSpace(
      doc,
      startY,
      lineHeight * (1.2 + Math.max(PAGINATION.keepWithNextLines, BLOCK_MIN_LINES)),
      margins,
      pageHeight
    );

    if (isQuestion) {
      const measuredEndY = this.measure(doc, () =>
        this.renderMessageBody(
          doc,
          role,
          blocks,
          y,
          margins,
          contentWidth,
          lineHeight,
          pageHeight,
          roleColor
        )
      );

      // A question long enough to page-break mid-render measures an endY
      // behind its own startY (the dry run "restarted" at margins.top on the
      // simulated next page) — fall back to filling down to this page's
      // bottom rather than drawing a negative-height rect.
      const bottomLimit = pageHeight - margins.bottom;
      const fillBottom = measuredEndY < y ? bottomLimit : Math.min(measuredEndY, bottomLimit);

      doc.setFillColor(...hexToRgbTuple(COLOR.surfaceTurn));
      doc.rect(
        margins.left - QUESTION_FILL_PADDING_MM.side,
        y - QUESTION_FILL_PADDING_MM.top,
        contentWidth + QUESTION_FILL_PADDING_MM.side * 2,
        fillBottom - y + QUESTION_FILL_PADDING_MM.top + QUESTION_FILL_PADDING_MM.bottom,
        'F'
      );
    }

    return this.renderMessageBody(
      doc,
      role,
      blocks,
      y,
      margins,
      contentWidth,
      lineHeight,
      pageHeight,
      roleColor
    );
  }

  /**
   * The label + rule + blocks that make up one message. Split out of
   * `renderMessage` so it can be run twice: once as a dry-run measurement
   * (drawing calls stubbed, see `measure()`), once for real.
   */
  private renderMessageBody(
    doc: jsPDF,
    role: string,
    blocks: StructuredContentBlock[],
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number,
    roleColor: [number, number, number]
  ): number {
    let y = startY;

    // Role label — a label, not a heading (R-1), so its size comes from the
    // shared token table rather than pdf's body-heading ramp.
    doc.setFont(this.fonts.body, 'bold');
    doc.setFontSize(this.sizes.roleLabel);
    doc.setTextColor(...roleColor);
    const label = `${role}:`;
    doc.text(label, margins.left, y);

    // The R2 treatment: a short rule beneath the label in the platform's colour.
    // This is the only place a brand colour appears in the body, and it is what
    // orders the page when a conversation runs to many turns.
    const ruleWidth = doc.getTextWidth(label);
    doc.setDrawColor(...roleColor);
    doc.setLineWidth(0.4);
    doc.line(margins.left, y + 1.1, margins.left + ruleWidth, y + 1.1);

    y += lineHeight * 1.2;

    // Render blocks
    y = this.renderBlocks(doc, blocks, y, margins, contentWidth, lineHeight, pageHeight);

    return y;
  }

  /**
   * Run `fn` with the document's drawing primitives (anything that leaves
   * visible ink or turns a page) replaced by no-ops, so a render function
   * that returns the advanced `y` doubles as a dry-run height measurement.
   * State-setting calls (setFont, setFontSize, ...) are left alone — they
   * don't draw, and the real render right after needs correct wrap metrics.
   *
   * This is the mechanism the question turn-fill (R-2b) uses to size its
   * rect before drawing it: no second, parallel measurement path, just the
   * real renderer run once silently and once for real.
   */
  private measure(doc: jsPDF, fn: () => number): number {
    const stub = (() => doc) as unknown as jsPDF['text'] &
      jsPDF['line'] &
      jsPDF['rect'] &
      jsPDF['roundedRect'] &
      jsPDF['addImage'] &
      jsPDF['addPage'];
    const original = {
      text: doc.text.bind(doc),
      line: doc.line.bind(doc),
      rect: doc.rect.bind(doc),
      roundedRect: doc.roundedRect.bind(doc),
      addImage: doc.addImage.bind(doc),
      addPage: doc.addPage.bind(doc),
    };
    Object.assign(doc, {
      text: stub,
      line: stub,
      rect: stub,
      roundedRect: stub,
      addImage: stub,
      addPage: stub,
    });
    try {
      return fn();
    } finally {
      Object.assign(doc, original);
    }
  }

  /**
   * Render structured content blocks
   */
  private renderBlocks(
    doc: jsPDF,
    blocks: StructuredContentBlock[],
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number
  ): number {
    let y = startY;

    for (const block of blocks) {
      // Check if we need a new page
      y = this.ensureSpace(doc, y, lineHeight * BLOCK_MIN_LINES, margins, pageHeight);

      switch (block.type) {
        case 'paragraph':
          y = this.renderParagraph(
            doc,
            block.content,
            y,
            margins,
            contentWidth,
            lineHeight,
            pageHeight
          );
          break;

        case 'heading':
          y = this.renderHeading(doc, block, y, margins, contentWidth, lineHeight, pageHeight);
          break;

        case 'code':
          y = this.renderCodeBlock(
            doc,
            block.code,
            block.language,
            y,
            margins,
            contentWidth,
            lineHeight,
            pageHeight
          );
          break;

        case 'list':
          y = this.renderList(doc, block, y, margins, contentWidth, lineHeight, pageHeight, 0);
          break;

        case 'blockquote':
          y = this.renderBlockquote(
            doc,
            block.content,
            y,
            margins,
            contentWidth,
            lineHeight,
            pageHeight
          );
          break;

        case 'hr':
          y = this.renderHorizontalRule(doc, y, margins, contentWidth, lineHeight, pageHeight);
          break;

        case 'table':
          y = this.renderTable(doc, block, y, margins, contentWidth, lineHeight, pageHeight);
          break;

        case 'image':
          y = this.renderImage(doc, block, y, margins, contentWidth, lineHeight, pageHeight);
          break;

        // A PDF can't play the clip; emit the same labelled placeholder an
        // unloadable image gets, with the URL so it stays reachable.
        case 'media':
          y = this.renderText(
            doc,
            `[${this.mediaLabel(block)}] ${block.url}`,
            y,
            margins,
            contentWidth,
            lineHeight,
            pageHeight,
            true
          );
          break;
      }
    }

    return y;
  }

  /**
   * Render artifacts section
   */
  private renderArtifacts(
    doc: jsPDF,
    artifacts: Artifact[],
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number
  ): number {
    let y = startY;

    // "Artifacts" label
    doc.setFont(this.fonts.body, 'bold');
    doc.setFontSize(this.pdfSizes.sectionLabel);
    doc.setTextColor(...hexToRgbTuple(COLOR.textBody));
    doc.text('Artifacts:', margins.left, y);
    y += lineHeight * 1.2;

    // Render each artifact
    for (const artifact of artifacts) {
      // Check if we need a new page
      y = this.ensureSpace(doc, y, lineHeight * 5, margins, pageHeight);

      // Artifact title
      doc.setFont(this.fonts.body, 'bold');
      doc.setFontSize(this.pdfSizes.artifactTitle);
      doc.setTextColor(...hexToRgbTuple(COLOR.textPrimary));
      const titleLines = splitLines(doc, sanitizeTextForPDF(artifact.title), contentWidth);
      for (const line of titleLines) {
        doc.text(line, margins.left, y);
        y += lineHeight;
      }

      // Artifact type
      if (artifact.typeLabel) {
        doc.setFont(this.fonts.body, 'italic');
        doc.setFontSize(this.sizes.meta);
        doc.setTextColor(...hexToRgbTuple(COLOR.textMuted));
        doc.text(`Type: ${sanitizeTextForPDF(artifact.typeLabel)}`, margins.left, y);
        y += lineHeight;
      }

      y += lineHeight * 0.3;

      // Artifact content: prose (type: 'document') renders through the same
      // markdown -> HTML -> structured-block pipeline message content uses;
      // code artifacts (including one whose language happens to be
      // 'markdown') stay a plain code block, same as before.
      const proseHtml =
        isProseArtifact(artifact) && this.markdown && artifact.content
          ? this.markdown(artifact.content)
          : null;

      if (proseHtml !== null) {
        y = this.renderBlocks(
          doc,
          HtmlContentParser.parse(proseHtml),
          y,
          margins,
          contentWidth,
          lineHeight,
          pageHeight
        );
      } else {
        // Artifact content (code block)
        doc.setFont(this.fonts.code, 'normal');
        doc.setFontSize(this.sizes.code);
        doc.setTextColor(...hexToRgbTuple(COLOR.textStrong));

        const contentLines = (artifact.content || '').split('\n');
        for (const line of contentLines) {
          if (y > pageHeight - margins.bottom) {
            doc.addPage();
            y = margins.top;
          }
          const wrappedLines = splitLines(doc, sanitizeTextForPDF(line || ' '), contentWidth);
          for (const wrappedLine of wrappedLines) {
            doc.text(wrappedLine, margins.left + 5, y);
            y += lineHeight * 0.8;
          }
        }
      }

      // Reset font
      doc.setFont(this.fonts.body, 'normal');
      doc.setFontSize(this.sizes.body);

      y += lineHeight;
    }

    return y;
  }

  /**
   * Render web search results
   */
  private renderWebSearches(
    doc: jsPDF,
    webSearches: WebSearchResult[],
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number
  ): number {
    let y = startY;

    // "Web Search Results" label
    doc.setFont(this.fonts.body, 'bold');
    doc.setFontSize(this.pdfSizes.sectionLabel);
    doc.setTextColor(...hexToRgbTuple(COLOR.textBody));
    doc.text('Web Search Results:', margins.left, y);
    y += lineHeight * 1.2;

    // Render each search
    for (const search of webSearches) {
      // Check if we need a new page
      y = this.ensureSpace(doc, y, lineHeight * 5, margins, pageHeight);

      // Search query
      doc.setFont(this.fonts.body, 'bold');
      doc.setFontSize(this.pdfSizes.artifactTitle);
      doc.setTextColor(...hexToRgbTuple(COLOR.textPrimary));
      doc.text(sanitizeTextForPDF(search.query || 'References'), margins.left, y);
      y += lineHeight;

      // Result count
      if (search.resultCount) {
        doc.setFont(this.fonts.body, 'italic');
        doc.setFontSize(this.sizes.meta);
        doc.setTextColor(...hexToRgbTuple(COLOR.textMuted));
        doc.text(`${search.resultCount} results found`, margins.left, y);
        y += lineHeight;
      }

      y += lineHeight * 0.3;

      // Render results
      if (search.results && Array.isArray(search.results)) {
        doc.setFont(this.fonts.body, 'normal');
        doc.setFontSize(this.pdfSizes.small);

        for (const result of search.results) {
          y = this.ensureSpace(doc, y, lineHeight * 3, margins, pageHeight);

          // Result title (as link)
          doc.setTextColor(...hexToRgbTuple(COLOR.link));
          const titleLines = splitLines(doc, sanitizeTextForPDF(result.title), contentWidth - 10);
          for (const line of titleLines) {
            doc.text('• ' + line, margins.left + 5, y);
            y += lineHeight * 0.9;
          }

          // Result URL. ponytail: printed on its own line in place of the
          // domain it contains — a PDF has no clickable citation, so the full
          // URL is the only way back to the source; the domain would just
          // repeat its prefix.
          const url = sanitizeTextForPDF(result.url ?? '');
          if (url) {
            doc.setFont(this.fonts.body, 'italic');
            doc.setTextColor(...hexToRgbTuple(COLOR.textMuted));
            for (const line of splitLines(doc, url, contentWidth - 12)) {
              doc.text(`  ${line}`, margins.left + 7, y);
              y += lineHeight * 0.9;
            }
            doc.setFont(this.fonts.body, 'normal');
          }

          y += lineHeight * 0.3;
        }
      }

      y += lineHeight * 0.5;
    }

    return y;
  }

  /**
   * Render a paragraph with inline formatting
   */
  private renderParagraph(
    doc: jsPDF,
    content: InlineContent[],
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number
  ): number {
    let y = startY;
    const text = this.inlineToPlainText(content);

    if (text.trim()) {
      y = this.renderText(doc, text, y, margins, contentWidth, lineHeight, pageHeight, false);
      y += lineHeight * 0.3; // Small spacing after paragraph
    }

    return y;
  }

  /**
   * Render a heading
   */
  private renderHeading(
    doc: jsPDF,
    block: { level: number; content: InlineContent[] },
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number
  ): number {
    let y = startY;
    const text = this.inlineToPlainText(block.content);

    if (text.trim()) {
      // Add spacing before heading
      y += lineHeight * 0.5;

      // Font size is pdf's only heading-level surface — index the shared scale
      // by document level so a body heading can never outrank the role label.
      const fontSize =
        this.pdfSizes.headingByLevel[bodyHeadingLevel(block.level, this.headingLevelMap) - 1] ??
        this.pdfSizes.sectionLabel;
      doc.setFontSize(fontSize);
      doc.setFont(this.fonts.body, 'bold');
      doc.setTextColor(...hexToRgbTuple(COLOR.textStrong));

      const lines = splitLines(doc, sanitizeTextForPDF(text), contentWidth);
      for (const line of lines) {
        if (y > pageHeight - margins.bottom) {
          doc.addPage();
          y = margins.top;
        }
        doc.text(line, margins.left, y);
        y += lineHeight * 1.1;
      }

      // Reset font
      doc.setFontSize(this.sizes.body);
      doc.setFont(this.fonts.body, 'normal');

      y += lineHeight * 0.3; // Spacing after heading
    }

    return y;
  }

  /**
   * Render a list
   */
  private renderList(
    doc: jsPDF,
    block: ListBlock,
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number,
    depth: number
  ): number {
    let y = startY;
    const indent = SPACING.listIndentStepMm * (depth + 1); // 5mm per nesting level

    doc.setFont(this.fonts.body, 'normal');
    doc.setFontSize(this.sizes.body);
    doc.setTextColor(...hexToRgbTuple(COLOR.textBody));

    for (let i = 0; i < block.items.length; i++) {
      const item = block.items[i];
      if (!item) continue;

      const prefix = block.ordered ? `${i + 1}.` : '•';
      const text = this.inlineToPlainText(item.content).trim(); // Strip emojis and trim

      if (text.trim()) {
        // Check if we need a new page
        y = this.ensureSpace(doc, y, lineHeight * 2, margins, pageHeight);

        const bulletX = margins.left + indent;
        const textX = bulletX + 8; // Space for bullet + gap
        const textWidth = contentWidth - indent - 8;

        // Split ONLY the text (not the prefix) to avoid breaking the bullet
        const lines = splitLines(doc, text, textWidth);

        // Render all lines
        for (const [j, line] of lines.entries()) {
          if (y > pageHeight - margins.bottom) {
            doc.addPage();
            y = margins.top;
          }

          if (j === 0) {
            // First line: render bullet and text
            doc.text(prefix, bulletX, y);
          }
          // Continuation lines: indent to align with first line text
          doc.text(line, textX, y);
          y += lineHeight;
        }
      }

      // Render nested list if present
      if (item?.nested) {
        y = this.renderList(
          doc,
          item.nested,
          y,
          margins,
          contentWidth,
          lineHeight,
          pageHeight,
          depth + 1
        );
      }
    }

    y += lineHeight * 0.3; // Spacing after list

    return y;
  }

  /**
   * Render a blockquote
   */
  private renderBlockquote(
    doc: jsPDF,
    content: StructuredContentBlock[],
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number
  ): number {
    let y = startY;

    // Add spacing before blockquote
    y += lineHeight * 0.3;

    // Draw left border for blockquote
    const quoteStartY = y;
    const quoteMargin = { ...margins, left: margins.left + SPACING.listIndentStepMm };
    const quoteWidth = contentWidth - SPACING.listIndentStepMm;

    // Set style for blockquote
    doc.setTextColor(...hexToRgbTuple(COLOR.textMuted));
    doc.setFont(this.fonts.body, 'italic');

    // Render content
    y = this.renderBlocks(doc, content, y, quoteMargin, quoteWidth, lineHeight, pageHeight);

    // Draw left border
    doc.setDrawColor(...hexToRgbTuple(COLOR.blockquoteBorder));
    doc.setLineWidth(1);
    doc.line(margins.left + 2, quoteStartY - 2, margins.left + 2, y);

    // Reset style
    doc.setTextColor(...hexToRgbTuple(COLOR.textBody));
    doc.setFont(this.fonts.body, 'normal');

    y += lineHeight * 0.3; // Spacing after blockquote

    return y;
  }

  /**
   * Draw a horizontal rule at `y`, spanning `contentWidth` from `margins.left`.
   * The single place a rule is actually drawn — `renderHorizontalRule` (a
   * block-level `hr`, with its own spacing) and `renderTable`'s row/header
   * rules (flush against a measured row height, with none) both call this
   * rather than each re-issuing the same three jsPDF calls.
   */
  private drawRule(
    doc: jsPDF,
    y: number,
    margins: { left: number },
    contentWidth: number,
    color: string,
    widthMm: number
  ): void {
    doc.setDrawColor(...hexToRgbTuple(color));
    doc.setLineWidth(widthMm);
    doc.line(margins.left, y, margins.left + contentWidth, y);
  }

  /**
   * Render a horizontal rule
   */
  private renderHorizontalRule(
    doc: jsPDF,
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number
  ): number {
    let y = startY;

    y += lineHeight * 0.5;

    if (y > pageHeight - margins.bottom) {
      doc.addPage();
      y = margins.top;
    }

    this.drawRule(doc, y, margins, contentWidth, COLOR.border, 0.3);

    y += lineHeight * 0.5;

    return y;
  }

  /**
   * Render an image block
   */
  private renderImage(
    doc: jsPDF,
    block: ImageBlock,
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number
  ): number {
    let y = startY;

    // Same shape as txt/docx: keep the URL even when alt text exists, so a
    // failed image still points at the picture. renderText wraps it.
    const placeholder = `[Image: ${block.alt || 'image'}] ${block.url}`;

    // Try to get the loaded image from cache
    const loadedImage = this.imageCache.get(block.url);

    if (!loadedImage) {
      // Image failed to load, show placeholder text
      y += lineHeight * 0.3;
      y = this.renderText(doc, placeholder, y, margins, contentWidth, lineHeight, pageHeight, true);
      return y;
    }

    // Calculate image dimensions to fit within content width
    // Use original pixel size, converting to mm (assuming 96 DPI: 1 inch = 25.4mm, 96px = 1 inch)
    // So: pixels * 25.4 / 96 = mm
    const maxImageWidth = Math.min(60, contentWidth); // Max 60mm (~227px at 96 DPI), similar to MD's 200px limit
    const maxImageHeight = 150; // Max height in mm

    let imgWidth = (loadedImage.width * 25.4) / 96; // Convert pixels to mm
    let imgHeight = (loadedImage.height * 25.4) / 96;

    // Only scale down if larger than max, otherwise use original size
    if (imgWidth > maxImageWidth) {
      const scale = maxImageWidth / imgWidth;
      imgWidth = maxImageWidth;
      imgHeight = imgHeight * scale;
    }

    // Also check height constraint
    if (imgHeight > maxImageHeight) {
      const scale = maxImageHeight / imgHeight;
      imgHeight = maxImageHeight;
      imgWidth = imgWidth * scale;
    }

    // Check if we need a new page
    if (y + imgHeight + lineHeight * 2 > pageHeight - margins.bottom) {
      doc.addPage();
      y = margins.top;
    }

    y += lineHeight * 0.5; // Spacing before image

    try {
      // Add the image to the PDF
      doc.addImage(loadedImage.dataUrl, loadedImage.format, margins.left, y, imgWidth, imgHeight);

      y += imgHeight + lineHeight * 0.3; // Move past the image

      // Add alt text below image if available
      if (block.alt) {
        doc.setFontSize(this.sizes.meta);
        doc.setFont(this.fonts.body, 'italic');
        doc.setTextColor(...hexToRgbTuple(COLOR.textMuted));
        const altText = sanitizeTextForPDF(block.alt);
        const altLines = splitLines(doc, altText, contentWidth);
        for (const line of altLines) {
          if (y > pageHeight - margins.bottom) {
            doc.addPage();
            y = margins.top;
          }
          doc.text(line, margins.left, y);
          y += lineHeight * 0.8;
        }
        // Reset font
        doc.setFontSize(this.sizes.body);
        doc.setFont(this.fonts.body, 'normal');
        doc.setTextColor(...hexToRgbTuple(COLOR.textBody));
      }

      y += lineHeight * 0.3; // Spacing after image
    } catch (error) {
      console.error('Failed to add image to PDF:', error);
      // Fall back to showing placeholder text
      y = this.renderText(doc, placeholder, y, margins, contentWidth, lineHeight, pageHeight, true);
    }

    return y;
  }

  /**
   * A column is numeric when every non-empty body cell in it is a bare
   * number (design: "numeric columns right-aligned"). A column with no data
   * cells at all is not numeric by definition — nothing to align.
   *
   * ponytail: "tabular figures" (equal-width digits, so a right-aligned
   * column of numbers lines up) is assumed to be the default digit style of
   * the embedded body font rather than requested through a jsPDF font
   * feature — jsPDF draws whatever glyphs the embedded TrueType provides and
   * exposes no OpenType feature toggle, and Source Sans 3, like most
   * UI/body-text sans faces, ships tabular (not proportional) figures by
   * default.
   */
  private detectNumericColumns(table: TableBlock, numCols: number): boolean[] {
    const isNumeric = new Array<boolean>(numCols).fill(true);
    const sawData = new Array<boolean>(numCols).fill(false);

    for (const row of table.rows) {
      if (!row) continue;
      for (let i = 0; i < numCols; i++) {
        const cell = row[i];
        if (!cell) continue;
        const text = this.inlineToPlainText(cell).trim();
        if (!text) continue;
        sawData[i] = true;
        if (!/^-?[\d,]+(\.\d+)?%?$/.test(text)) isNumeric[i] = false;
      }
    }

    return isNumeric.map((v, i) => v && Boolean(sawData[i]));
  }

  /**
   * Render a table
   */
  private renderTable(
    doc: jsPDF,
    table: TableBlock,
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number
  ): number {
    let y = startY;
    y += lineHeight * 0.5; // Spacing before table

    // Calculate column widths (equal width for simplicity)
    const numCols = table.headers.length || table.rows[0]?.length || 1;
    const colWidth = contentWidth / numCols;
    const cellPadding = 2;
    const minRowHeight = lineHeight * 1.5;
    const numericCols = this.detectNumericColumns(table, numCols);

    // Helper function to calculate row height based on content
    const calculateRowHeight = (cells: InlineContent[][]): number => {
      let maxLines = 1;
      for (const cell of cells) {
        if (!cell) continue;
        const cellText = this.inlineToPlainText(cell);
        const lines = splitLines(doc, cellText, colWidth - cellPadding * 2);
        maxLines = Math.max(maxLines, lines.length);
      }
      return Math.max(minRowHeight, maxLines * lineHeight + cellPadding);
    };

    // Draw one row's cell text, right-aligned in numeric columns.
    const drawCells = (cells: InlineContent[][], rowY: number): void => {
      cells.forEach((cell, i) => {
        if (!cell) return;
        const cellText = this.inlineToPlainText(cell);
        const textY = rowY + cellPadding + lineHeight / 2;
        if (numericCols[i]) {
          doc.text(cellText, margins.left + (i + 1) * colWidth - cellPadding, textY, {
            maxWidth: colWidth - cellPadding * 2,
            align: 'right',
          });
        } else {
          doc.text(cellText, margins.left + i * colWidth + cellPadding, textY, {
            maxWidth: colWidth - cellPadding * 2,
          });
        }
      });
    };

    // Render headers
    if (table.headers && table.headers.length > 0) {
      const headerHeight = calculateRowHeight(table.headers);

      // Keep the header with its first body row: a header alone at the foot of
      // a page labels nothing. Rows themselves already never split mid-row.
      const firstRow = table.rows?.[0];
      const firstRowHeight = firstRow ? calculateRowHeight(firstRow) : 0;
      y = this.ensureSpace(doc, y, headerHeight + firstRowHeight, margins, pageHeight);

      // Horizontal rules only (R-6): a full grid and an alternating row fill
      // both competed with the design's other surfaces, so a pdf table now
      // matches html/R-6 — one rule per row and nothing else.
      doc.setFont(this.fonts.body, 'bold');
      doc.setFontSize(this.pdfSizes.small);
      doc.setTextColor(...hexToRgbTuple(COLOR.textBody));
      drawCells(table.headers, y);

      y += headerHeight;
      this.drawRule(doc, y, margins, contentWidth, COLOR.textMuted, 0.4);
    }

    // Render rows
    doc.setFont(this.fonts.body, 'normal');
    table.rows.forEach((row) => {
      if (!row) return;

      const rowHeight = calculateRowHeight(row);

      // Check if we need a new page
      if (y + rowHeight > pageHeight - margins.bottom) {
        doc.addPage();
        y = margins.top;
      }

      drawCells(row, y);
      y += rowHeight;
      this.drawRule(doc, y, margins, contentWidth, COLOR.border, 0.2);
    });

    y += lineHeight * 0.5; // Spacing after table

    return y;
  }

  /**
   * Convert inline content to plain text (for PDF rendering)
   * Sanitizes characters that jsPDF can't render
   */
  private inlineToPlainText(content: InlineContent[]): string {
    // ponytail: jsPDF text here is single flattened plain text per block (no
    // per-run styling exists anywhere in this renderer, not even bold/italic),
    // so a real link annotation would need a new run-aware wrapping engine.
    // Falls back to the same "text (url)" convention docx-exporter.ts already
    // uses for the identical constraint, keeping the fallback consistent
    // across formats instead of inventing a third one.
    const text = content
      .map((item) =>
        item.type === 'link' && item.url && item.url !== item.text
          ? `${item.text} (${item.url})`
          : item.text
      )
      .join('');
    return sanitizeTextForPDF(text);
  }

  /**
   * Get assistant name and color based on platform
   */
  private getAssistantInfo(platform: string): { name: string; color: [number, number, number] } {
    const name = this.getRoleName('assistant', platform);
    const color = hexToRgbTuple(brandColorFor(COLOR.brand, platform));

    return { name, color };
  }

  /**
   * Render a code block with background
   */
  private renderCodeBlock(
    doc: jsPDF,
    code: string,
    language: string,
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number
  ): number {
    let y = startY;

    // Add some spacing before code block
    y += lineHeight * 0.3;

    // Split code into lines and measure the wrapped body BEFORE drawing
    // anything: the language tab has to stay attached to its code block
    // across a page break (R-2b), so both are sized together, not the tab
    // alone.
    const codeLines = code.split('\n');
    const codeContentWidth = contentWidth - 8; // Padding inside code block

    let totalCodeHeight = 0;
    const wrappedLines: string[] = [];

    doc.setFont(this.fonts.code, 'normal');
    doc.setFontSize(this.sizes.code);

    for (const line of codeLines) {
      const sanitized = sanitizeTextForPDF(line || ' ');
      const wrapped = splitLines(doc, sanitized, codeContentWidth);
      wrappedLines.push(...wrapped);
      totalCodeHeight += wrapped.length * lineHeight * 0.9;
    }

    // R-2b: the language renders in a tab ABOVE the block, not inline —
    // a small chip that reads as UI chrome rather than a line of body text.
    const tabLabel = language ? sanitizeTextForPDF(language.toUpperCase()) : '';
    const tabHeight = tabLabel ? lineHeight * 0.9 : 0;

    // Check if we need a new page (tab + code block together)
    if (y + tabHeight + totalCodeHeight + 6 > pageHeight - margins.bottom) {
      doc.addPage();
      y = margins.top;
    }

    if (tabLabel) {
      const tabPaddingX = 2;
      doc.setFontSize(this.sizes.codeLabel);
      doc.setFont(this.fonts.body, 'bold');
      const tabWidth = doc.getTextWidth(tabLabel) + tabPaddingX * 2;

      doc.setFillColor(...hexToRgbTuple(COLOR.surfaceMuted));
      doc.roundedRect(margins.left, y, tabWidth, tabHeight, 1, 1, 'F');

      doc.setTextColor(...hexToRgbTuple(COLOR.textMuted));
      doc.text(tabLabel, margins.left + tabPaddingX, y + tabHeight - 2);

      y += tabHeight;
    }

    // Draw background rectangle
    doc.setFillColor(...hexToRgbTuple(COLOR.surfaceMuted));
    doc.setDrawColor(...hexToRgbTuple(COLOR.border));
    doc.setLineWidth(0.2);
    doc.roundedRect(margins.left, y - 2, contentWidth, totalCodeHeight + 6, 2, 2, 'FD');

    // Render code lines
    y += 3;
    doc.setFont(this.fonts.code, 'normal');
    doc.setFontSize(this.sizes.code);
    doc.setTextColor(...hexToRgbTuple(COLOR.textStrong)); // Dark text for code

    for (const line of wrappedLines) {
      if (y > pageHeight - margins.bottom) {
        doc.addPage();
        y = margins.top;
      }
      doc.text(line, margins.left + 4, y);
      y += lineHeight * 0.9;
    }

    y += 3; // Bottom padding
    y += lineHeight * 0.3; // Spacing after code block

    // Reset font
    doc.setFont(this.fonts.body, 'normal');
    doc.setFontSize(this.sizes.body);

    return y;
  }

  /**
   * Render regular text
   */
  private renderText(
    doc: jsPDF,
    text: string,
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number,
    isItalic = false
  ): number {
    let y = startY;

    doc.setFont(this.fonts.body, isItalic ? 'italic' : 'normal');
    doc.setFontSize(this.sizes.body);
    doc.setTextColor(...hexToRgbTuple(COLOR.textBody));

    const sanitized = sanitizeTextForPDF(text);
    const lines = splitLines(doc, sanitized, contentWidth);

    // Orphan/widow control. Lines used to be placed one at a time, so a
    // paragraph could leave a single line at the foot of a page or carry a
    // single line over. Decide the split point up front instead: how many
    // lines fit below `y`, then pull the break back (or move the whole
    // paragraph) until both sides clear the PAGINATION minimums.
    const limit = pageHeight - margins.bottom;
    let keepHere = Math.max(0, Math.floor((limit - y) / lineHeight) + 1);
    if (keepHere < lines.length) {
      if (lines.length - keepHere < PAGINATION.widows) {
        keepHere = lines.length - PAGINATION.widows;
      }
      if (keepHere < PAGINATION.orphans) {
        keepHere = 0; // the whole paragraph moves to the next page
      }
    }

    for (const [i, line] of lines.entries()) {
      if (i === keepHere || y > limit) {
        doc.addPage();
        y = margins.top;
      }
      doc.text(line, margins.left, y);
      y += lineHeight;
    }

    return y;
  }
}
