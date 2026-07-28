/**
 * PDF exporter using jsPDF with structured content rendering
 */

import type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  Conversation,
  QAPair,
  PDFExportOptions,
  StructuredContentBlock,
  InlineContent,
  ListBlock,
  TableBlock,
  ImageBlock,
} from '../types';
import { DEFAULT_PDF_OPTIONS } from '../types';
import { BaseExporter } from './base-exporter';
import { ConversationStructureService } from '../services';
import { getMessageWithValues } from '../../shared/i18n';
import { sanitizeTextForPDF } from '../utils/pdf-characters';
import { loadImagesParallel, type LoadedImage } from '../utils/image-loader';
import {
  COLOR,
  FONT_FAMILY,
  FONT_SIZE_PT,
  PDF_FONT_SIZE_PT,
  SPACING,
  hexToRgbTuple,
} from './style-tokens';

/**
 * Exports conversations to PDF format
 */
export class PdfExporter extends BaseExporter {
  readonly format: ExportFormat = 'pdf';
  readonly extension = 'pdf';
  readonly mimeType = 'application/pdf';

  private imageCache: Map<string, LoadedImage | null> = new Map();

  /**
   * Export selected Q&A pairs to PDF
   */
  async export(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      // Convert to structured format (only the selected pairs)
      const structured = ConversationStructureService.toStructured({
        ...conversation,
        pairs: selectedPairs,
      });

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
   * Extract all image URLs from the structured conversation
   */
  private extractImageUrls(conversation: any): string[] {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
    conversation: any, // StructuredConversation
    options: ExportOptions,
    pdfOptions: PDFExportOptions
  ): void {
    const margins = pdfOptions.margins;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - margins.left - margins.right;

    let y = margins.top;
    const lineHeight = 6;

    // Title
    doc.setFontSize(PDF_FONT_SIZE_PT.title);
    doc.setFont(FONT_FAMILY.body.pdf, 'bold');
    doc.setTextColor(...hexToRgbTuple(COLOR.textPrimary));
    doc.text(sanitizeTextForPDF(conversation.title), margins.left, y);
    y += lineHeight * 2.5;

    // Metadata
    if (options.includeMetadata) {
      doc.setFontSize(FONT_SIZE_PT.meta);
      doc.setFont(FONT_FAMILY.body.pdf, 'normal');
      doc.setTextColor(...hexToRgbTuple(COLOR.textMuted));

      doc.text(`${this.getMetadataLabel('platform')}: ${this.formatPlatformName(conversation.platform)}`, margins.left, y);
      y += lineHeight;

      if (conversation.model) {
        doc.text(`${this.getMetadataLabel('model')}: ${conversation.model}`, margins.left, y);
        y += lineHeight;
      }

      if (conversation.createdAt) {
        doc.text(`${this.getMetadataLabel('exported')}: ${this.formatTimestamp(conversation.createdAt)}`, margins.left, y);
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
    doc.setFontSize(FONT_SIZE_PT.body);

    // Get assistant name and color based on platform
    const assistantInfo = this.getAssistantInfo(conversation.platform);

    for (const pair of conversation.pairs) {
      // Check if we need a new page
      if (y > pageHeight - margins.bottom - lineHeight * 10) {
        doc.addPage();
        y = margins.top;
      }

      // User message (blue)
      y = this.renderMessage(
        doc,
        `${this.getRoleName('user')}${this.formatTimestampSuffix(pair.question.timestamp, options.includeTimestamps)}`,
        pair.question.blocks,
        y,
        margins,
        contentWidth,
        lineHeight,
        pageHeight,
        hexToRgbTuple(COLOR.link)
      );

      // Add spacing between user and assistant
      y += lineHeight * 0.5;

      // Assistant message (platform-specific color and name)
      y = this.renderMessage(
        doc,
        `${assistantInfo.name}${this.formatTimestampSuffix(pair.answer.timestamp, options.includeTimestamps)}`,
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
        const artifactsWithContent = pair.answer.metadata.artifacts.filter((a: any) => a.content);
        if (artifactsWithContent.length > 0) {
          y += lineHeight * 0.5;
          y = this.renderArtifacts(doc, artifactsWithContent, y, margins, contentWidth, lineHeight, pageHeight);
        }
      }

      // Render web search results if present
      if (pair.answer.metadata?.webSearches && Array.isArray(pair.answer.metadata.webSearches)) {
        const webSearches = pair.answer.metadata.webSearches;
        if (webSearches.length > 0) {
          y += lineHeight * 0.5;
          y = this.renderWebSearches(doc, webSearches, y, margins, contentWidth, lineHeight, pageHeight);
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
        doc.setFontSize(PDF_FONT_SIZE_PT.small);
        doc.setTextColor(...hexToRgbTuple(COLOR.textFaint));
        doc.text(
          getMessageWithValues('pageNumberFormat', String(i), String(pageCount)),
          pageWidth / 2,
          pageHeight - margins.bottom / 2,
          { align: 'center' }
        );
      }
    }
  }

  /**
   * Render a single message (user or assistant)
   */
  private renderMessage(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
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

    // Role label
    doc.setFont(FONT_FAMILY.body.pdf, 'bold');
    doc.setFontSize(PDF_FONT_SIZE_PT.roleLabel);
    doc.setTextColor(...roleColor);
    doc.text(`${role}:`, margins.left, y);
    y += lineHeight * 1.2;

    // Render blocks
    y = this.renderBlocks(doc, blocks, y, margins, contentWidth, lineHeight, pageHeight);

    return y;
  }

  /**
   * Render structured content blocks
   */
  private renderBlocks(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
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
      if (y > pageHeight - margins.bottom - lineHeight * 3) {
        doc.addPage();
        y = margins.top;
      }

      switch (block.type) {
        case 'paragraph':
          y = this.renderParagraph(doc, block.content, y, margins, contentWidth, lineHeight, pageHeight);
          break;

        case 'heading':
          y = this.renderHeading(doc, block, y, margins, contentWidth, lineHeight, pageHeight);
          break;

        case 'code':
          y = this.renderCodeBlock(doc, block.code, block.language, y, margins, contentWidth, lineHeight, pageHeight);
          break;

        case 'list':
          y = this.renderList(doc, block, y, margins, contentWidth, lineHeight, pageHeight, 0);
          break;

        case 'blockquote':
          y = this.renderBlockquote(doc, block.content, y, margins, contentWidth, lineHeight, pageHeight);
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
      }
    }

    return y;
  }

  /**
   * Render artifacts section
   */
  private renderArtifacts(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
    artifacts: any[],
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number
  ): number {
    let y = startY;

    // "Artifacts" label
    doc.setFont(FONT_FAMILY.body.pdf, 'bold');
    doc.setFontSize(PDF_FONT_SIZE_PT.sectionLabel);
    doc.setTextColor(...hexToRgbTuple(COLOR.textBody));
    doc.text('Artifacts:', margins.left, y);
    y += lineHeight * 1.2;

    // Render each artifact
    for (const artifact of artifacts) {
      // Check if we need a new page
      if (y > pageHeight - margins.bottom - lineHeight * 5) {
        doc.addPage();
        y = margins.top;
      }

      // Artifact title
      doc.setFont(FONT_FAMILY.body.pdf, 'bold');
      doc.setFontSize(PDF_FONT_SIZE_PT.artifactTitle);
      doc.setTextColor(...hexToRgbTuple(COLOR.textPrimary));
      const titleLines = doc.splitTextToSize(sanitizeTextForPDF(artifact.title), contentWidth);
      for (const line of titleLines) {
        doc.text(line, margins.left, y);
        y += lineHeight;
      }

      // Artifact type
      if (artifact.typeLabel) {
        doc.setFont(FONT_FAMILY.body.pdf, 'italic');
        doc.setFontSize(FONT_SIZE_PT.meta);
        doc.setTextColor(...hexToRgbTuple(COLOR.textMuted));
        doc.text(`Type: ${sanitizeTextForPDF(artifact.typeLabel)}`, margins.left, y);
        y += lineHeight;
      }

      y += lineHeight * 0.3;

      // Artifact content (code block)
      doc.setFont(FONT_FAMILY.code.pdf, 'normal');
      doc.setFontSize(FONT_SIZE_PT.code);
      doc.setTextColor(...hexToRgbTuple(COLOR.textStrong));

      const contentLines = (artifact.content || '').split('\n');
      for (const line of contentLines) {
        if (y > pageHeight - margins.bottom) {
          doc.addPage();
          y = margins.top;
        }
        const wrappedLines = doc.splitTextToSize(sanitizeTextForPDF(line || ' '), contentWidth);
        for (const wrappedLine of wrappedLines) {
          doc.text(wrappedLine, margins.left + 5, y);
          y += lineHeight * 0.8;
        }
      }

      // Reset font
      doc.setFont(FONT_FAMILY.body.pdf, 'normal');
      doc.setFontSize(FONT_SIZE_PT.body);

      y += lineHeight;
    }

    return y;
  }

  /**
   * Render web search results
   */
  private renderWebSearches(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
    webSearches: any[],
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number
  ): number {
    let y = startY;

    // "Web Search Results" label
    doc.setFont(FONT_FAMILY.body.pdf, 'bold');
    doc.setFontSize(PDF_FONT_SIZE_PT.sectionLabel);
    doc.setTextColor(...hexToRgbTuple(COLOR.textBody));
    doc.text('Web Search Results:', margins.left, y);
    y += lineHeight * 1.2;

    // Render each search
    for (const search of webSearches) {
      // Check if we need a new page
      if (y > pageHeight - margins.bottom - lineHeight * 5) {
        doc.addPage();
        y = margins.top;
      }

      // Search query
      doc.setFont(FONT_FAMILY.body.pdf, 'bold');
      doc.setFontSize(PDF_FONT_SIZE_PT.artifactTitle);
      doc.setTextColor(...hexToRgbTuple(COLOR.textPrimary));
      doc.text(sanitizeTextForPDF(search.query || 'References'), margins.left, y);
      y += lineHeight;

      // Result count
      if (search.resultCount) {
        doc.setFont(FONT_FAMILY.body.pdf, 'italic');
        doc.setFontSize(FONT_SIZE_PT.meta);
        doc.setTextColor(...hexToRgbTuple(COLOR.textMuted));
        doc.text(`${search.resultCount} results found`, margins.left, y);
        y += lineHeight;
      }

      y += lineHeight * 0.3;

      // Render results
      if (search.results && Array.isArray(search.results)) {
        doc.setFont(FONT_FAMILY.body.pdf, 'normal');
        doc.setFontSize(PDF_FONT_SIZE_PT.small);

        for (const result of search.results) {
          if (y > pageHeight - margins.bottom - lineHeight * 3) {
            doc.addPage();
            y = margins.top;
          }

          // Result title (as link)
          doc.setTextColor(...hexToRgbTuple(COLOR.link));
          const titleLines = doc.splitTextToSize(sanitizeTextForPDF(result.title), contentWidth - 10);
          for (const line of titleLines) {
            doc.text('• ' + line, margins.left + 5, y);
            y += lineHeight * 0.9;
          }

          // Result domain
          if (result.domain) {
            doc.setFont(FONT_FAMILY.body.pdf, 'italic');
            doc.setTextColor(...hexToRgbTuple(COLOR.textMuted));
            doc.text(`  ${sanitizeTextForPDF(result.domain)}`, margins.left + 7, y);
            y += lineHeight * 0.9;
            doc.setFont(FONT_FAMILY.body.pdf, 'normal');
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
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

      // Set font size based on heading level
      const fontSize = PDF_FONT_SIZE_PT.headingByLevel[
        Math.min(block.level - 1, PDF_FONT_SIZE_PT.headingByLevel.length - 1)
      ];
      doc.setFontSize(fontSize);
      doc.setFont(FONT_FAMILY.body.pdf, 'bold');
      doc.setTextColor(...hexToRgbTuple(COLOR.textStrong));

      const lines = doc.splitTextToSize(sanitizeTextForPDF(text), contentWidth);
      for (const line of lines) {
        if (y > pageHeight - margins.bottom) {
          doc.addPage();
          y = margins.top;
        }
        doc.text(line, margins.left, y);
        y += lineHeight * 1.1;
      }

      // Reset font
      doc.setFontSize(FONT_SIZE_PT.body);
      doc.setFont(FONT_FAMILY.body.pdf, 'normal');

      y += lineHeight * 0.3; // Spacing after heading
    }

    return y;
  }

  /**
   * Render a list
   */
  private renderList(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
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

    doc.setFont(FONT_FAMILY.body.pdf, 'normal');
    doc.setFontSize(FONT_SIZE_PT.body);
    doc.setTextColor(...hexToRgbTuple(COLOR.textBody));

    for (let i = 0; i < block.items.length; i++) {
      const item = block.items[i];
      if (!item) continue;

      const prefix = block.ordered ? `${i + 1}.` : '•';
      const text = this.inlineToPlainText(item.content).trim(); // Strip emojis and trim

      if (text.trim()) {
        // Check if we need a new page
        if (y > pageHeight - margins.bottom - lineHeight * 2) {
          doc.addPage();
          y = margins.top;
        }

        const bulletX = margins.left + indent;
        const textX = bulletX + 8; // Space for bullet + gap
        const textWidth = contentWidth - indent - 8;

        // Split ONLY the text (not the prefix) to avoid breaking the bullet
        const lines = doc.splitTextToSize(text, textWidth);

        // Render all lines
        for (let j = 0; j < lines.length; j++) {
          if (y > pageHeight - margins.bottom) {
            doc.addPage();
            y = margins.top;
          }

          if (j === 0) {
            // First line: render bullet and text
            doc.text(prefix, bulletX, y);
            doc.text(lines[j], textX, y);
          } else {
            // Continuation lines: indent to align with first line text
            doc.text(lines[j], textX, y);
          }
          y += lineHeight;
        }
      }

      // Render nested list if present
      if (item && item.nested) {
        y = this.renderList(doc, item.nested, y, margins, contentWidth, lineHeight, pageHeight, depth + 1);
      }
    }

    y += lineHeight * 0.3; // Spacing after list

    return y;
  }

  /**
   * Render a blockquote
   */
  private renderBlockquote(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
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
    doc.setFont(FONT_FAMILY.body.pdf, 'italic');

    // Render content
    y = this.renderBlocks(doc, content, y, quoteMargin, quoteWidth, lineHeight, pageHeight);

    // Draw left border
    doc.setDrawColor(...hexToRgbTuple(COLOR.blockquoteBorder));
    doc.setLineWidth(1);
    doc.line(margins.left + 2, quoteStartY - 2, margins.left + 2, y);

    // Reset style
    doc.setTextColor(...hexToRgbTuple(COLOR.textBody));
    doc.setFont(FONT_FAMILY.body.pdf, 'normal');

    y += lineHeight * 0.3; // Spacing after blockquote

    return y;
  }

  /**
   * Render a horizontal rule
   */
  private renderHorizontalRule(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
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

    doc.setDrawColor(...hexToRgbTuple(COLOR.border));
    doc.setLineWidth(0.3);
    doc.line(margins.left, y, margins.left + contentWidth, y);

    y += lineHeight * 0.5;

    return y;
  }

  /**
   * Render an image block
   */
  private renderImage(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
    block: ImageBlock,
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number
  ): number {
    let y = startY;

    // Try to get the loaded image from cache
    const loadedImage = this.imageCache.get(block.url);

    if (!loadedImage) {
      // Image failed to load, show placeholder text
      y += lineHeight * 0.3;
      y = this.renderText(
        doc,
        `[Image: ${block.alt || block.url}]`,
        y,
        margins,
        contentWidth,
        lineHeight,
        pageHeight,
        true
      );
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
      doc.addImage(
        loadedImage.dataUrl,
        loadedImage.format,
        margins.left,
        y,
        imgWidth,
        imgHeight
      );

      y += imgHeight + lineHeight * 0.3; // Move past the image

      // Add alt text below image if available
      if (block.alt) {
        doc.setFontSize(FONT_SIZE_PT.meta);
        doc.setFont(FONT_FAMILY.body.pdf, 'italic');
        doc.setTextColor(...hexToRgbTuple(COLOR.textMuted));
        const altText = sanitizeTextForPDF(block.alt);
        const altLines = doc.splitTextToSize(altText, contentWidth);
        for (const line of altLines) {
          if (y > pageHeight - margins.bottom) {
            doc.addPage();
            y = margins.top;
          }
          doc.text(line, margins.left, y);
          y += lineHeight * 0.8;
        }
        // Reset font
        doc.setFontSize(FONT_SIZE_PT.body);
        doc.setFont(FONT_FAMILY.body.pdf, 'normal');
        doc.setTextColor(...hexToRgbTuple(COLOR.textBody));
      }

      y += lineHeight * 0.3; // Spacing after image
    } catch (error) {
      console.error('Failed to add image to PDF:', error);
      // Fall back to showing placeholder text
      y = this.renderText(
        doc,
        `[Image: ${block.alt || block.url}]`,
        y,
        margins,
        contentWidth,
        lineHeight,
        pageHeight,
        true
      );
    }

    return y;
  }

  /**
   * Render a table
   */
  private renderTable(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
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
    const numCols = table.headers.length || (table.rows[0]?.length || 1);
    const colWidth = contentWidth / numCols;
    const cellPadding = 2;
    const minRowHeight = lineHeight * 1.5;

    // Helper function to calculate row height based on content
    const calculateRowHeight = (cells: InlineContent[][]): number => {
      let maxLines = 1;
      for (const cell of cells) {
        if (!cell) continue;
        const cellText = this.inlineToPlainText(cell);
        const lines = doc.splitTextToSize(cellText, colWidth - cellPadding * 2);
        maxLines = Math.max(maxLines, lines.length);
      }
      return Math.max(minRowHeight, maxLines * lineHeight + cellPadding);
    };

    // Render headers
    if (table.headers && table.headers.length > 0) {
      const headerHeight = calculateRowHeight(table.headers);

      // Check if we need a new page
      if (y + headerHeight > pageHeight - margins.bottom) {
        doc.addPage();
        y = margins.top;
      }

      // Draw header background
      doc.setFillColor(...hexToRgbTuple(COLOR.surfaceSubtle));
      doc.rect(margins.left, y, contentWidth, headerHeight, 'F');

      // Draw header borders
      doc.setDrawColor(...hexToRgbTuple(COLOR.border));
      doc.setLineWidth(0.1);
      for (let i = 0; i <= numCols; i++) {
        const x = margins.left + i * colWidth;
        doc.line(x, y, x, y + headerHeight);
      }
      doc.line(margins.left, y, margins.left + contentWidth, y);
      doc.line(margins.left, y + headerHeight, margins.left + contentWidth, y + headerHeight);

      // Draw header text
      doc.setFont(FONT_FAMILY.body.pdf, 'bold');
      doc.setFontSize(PDF_FONT_SIZE_PT.small);
      doc.setTextColor(...hexToRgbTuple(COLOR.textBody));

      table.headers.forEach((header, i) => {
        const cellText = this.inlineToPlainText(header);
        const x = margins.left + i * colWidth + cellPadding;
        const textY = y + cellPadding + lineHeight / 2;
        doc.text(cellText, x, textY, { maxWidth: colWidth - cellPadding * 2 });
      });

      y += headerHeight;
    }

    // Render rows
    doc.setFont(FONT_FAMILY.body.pdf, 'normal');
    table.rows.forEach((row, rowIdx) => {
      if (!row) return;

      const rowHeight = calculateRowHeight(row);

      // Check if we need a new page
      if (y + rowHeight > pageHeight - margins.bottom) {
        doc.addPage();
        y = margins.top;
      }

      // Alternate row background
      if (rowIdx % 2 === 1) {
        doc.setFillColor(...hexToRgbTuple(COLOR.surfaceSubtle));
        doc.rect(margins.left, y, contentWidth, rowHeight, 'F');
      }

      // Draw row borders
      doc.setDrawColor(...hexToRgbTuple(COLOR.border));
      for (let i = 0; i <= numCols; i++) {
        const x = margins.left + i * colWidth;
        doc.line(x, y, x, y + rowHeight);
      }
      doc.line(margins.left, y + rowHeight, margins.left + contentWidth, y + rowHeight);

      // Draw cell text
      row.forEach((cell, colIdx) => {
        if (!cell) return;
        const cellText = this.inlineToPlainText(cell);
        const x = margins.left + colIdx * colWidth + cellPadding;
        const textY = y + cellPadding + lineHeight / 2;
        doc.text(cellText, x, textY, { maxWidth: colWidth - cellPadding * 2 });
      });

      y += rowHeight;
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
      .map(item =>
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
    const platformColors: Record<string, string> = {
      chatgpt: COLOR.brand.chatgpt,
      claude: COLOR.brand.claude,
      gemini: COLOR.brand.gemini,
    };

    const name = this.getRoleName('assistant', platform);
    const color = hexToRgbTuple(platformColors[platform] ?? COLOR.brand.default);

    return { name, color };
  }

  /**
   * Render a code block with background
   */
  private renderCodeBlock(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
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

    // Language label
    if (language) {
      doc.setFontSize(FONT_SIZE_PT.codeLabel);
      doc.setFont(FONT_FAMILY.body.pdf, 'bold');
      doc.setTextColor(...hexToRgbTuple(COLOR.textMuted));
      doc.text(sanitizeTextForPDF(language.toUpperCase()), margins.left, y);
      y += lineHeight * 0.8;
    }

    // Split code into lines
    const codeLines = code.split('\n');
    const codeContentWidth = contentWidth - 8; // Padding inside code block

    // Calculate total height needed for code block
    let totalCodeHeight = 0;
    const wrappedLines: string[] = [];

    doc.setFont(FONT_FAMILY.code.pdf, 'normal');
    doc.setFontSize(FONT_SIZE_PT.code);

    for (const line of codeLines) {
      const sanitized = sanitizeTextForPDF(line || ' ');
      const wrapped = doc.splitTextToSize(sanitized, codeContentWidth);
      wrappedLines.push(...wrapped);
      totalCodeHeight += wrapped.length * lineHeight * 0.9;
    }

    // Check if we need a new page
    if (y + totalCodeHeight + 6 > pageHeight - margins.bottom) {
      doc.addPage();
      y = margins.top;
    }

    // Draw background rectangle
    doc.setFillColor(...hexToRgbTuple(COLOR.surfaceMuted));
    doc.setDrawColor(...hexToRgbTuple(COLOR.border));
    doc.setLineWidth(0.2);
    doc.roundedRect(margins.left, y - 2, contentWidth, totalCodeHeight + 6, 2, 2, 'FD');

    // Render code lines
    y += 3;
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
    doc.setFont(FONT_FAMILY.body.pdf, 'normal');
    doc.setFontSize(FONT_SIZE_PT.body);

    return y;
  }

  /**
   * Render regular text
   */
  private renderText(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
    text: string,
    startY: number,
    margins: { top: number; right: number; bottom: number; left: number },
    contentWidth: number,
    lineHeight: number,
    pageHeight: number,
    isItalic: boolean = false
  ): number {
    let y = startY;

    doc.setFont(FONT_FAMILY.body.pdf, isItalic ? 'italic' : 'normal');
    doc.setFontSize(FONT_SIZE_PT.body);
    doc.setTextColor(...hexToRgbTuple(COLOR.textBody));

    const sanitized = sanitizeTextForPDF(text);
    const lines = doc.splitTextToSize(sanitized, contentWidth);
    for (const line of lines) {
      if (y > pageHeight - margins.bottom) {
        doc.addPage();
        y = margins.top;
      }
      doc.text(line, margins.left, y);
      y += lineHeight;
    }

    return y;
  }
}
