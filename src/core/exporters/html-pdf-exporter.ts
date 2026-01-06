/**
 * Enhanced PDF exporter using HTML rendering
 * Generates styled HTML and converts to PDF using html2canvas + jsPDF
 */

import type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  Conversation,
  QAPair,
  PDFExportOptions,
} from '../types';
import { DEFAULT_PDF_OPTIONS } from '../types';
import { BaseExporter } from './base-exporter';
import html2canvas from 'html2canvas';

/**
 * Exports conversations to PDF format with full HTML rendering
 */
export class HtmlPdfExporter extends BaseExporter {
  readonly format: ExportFormat = 'pdf';
  readonly extension = 'pdf';
  readonly mimeType = 'application/pdf';

  /**
   * Export selected Q&A pairs to PDF
   */
  async export(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      // Create HTML container
      const container = this.createHtmlContainer(conversation, selectedPairs, options);
      document.body.appendChild(container);

      // Generate PDF from HTML
      const blob = await this.htmlToPdf(container, options.pdfOptions);

      // Clean up
      document.body.removeChild(container);

      return this.createSuccessResult(blob, options.filename);
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Failed to export to PDF'
      );
    }
  }

  /**
   * Create styled HTML container for the conversation
   */
  private createHtmlContainer(
    conversation: Conversation,
    pairs: QAPair[],
    options: ExportOptions
  ): HTMLElement {
    const container = document.createElement('div');
    container.id = 'pdf-export-container';
    container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 800px;
      background: white;
      padding: 40px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1f2937;
      line-height: 1.6;
      z-index: 999999;
      opacity: 0;
      pointer-events: none;
    `;

    // Add title
    const title = document.createElement('h1');
    title.textContent = conversation.title;
    title.style.cssText = `
      font-size: 28px;
      font-weight: 700;
      margin: 0 0 20px 0;
      color: #111827;
    `;
    container.appendChild(title);

    // Add metadata
    if (options.includeMetadata) {
      const metadata = document.createElement('div');
      metadata.style.cssText = `
        font-size: 14px;
        color: #6b7280;
        margin-bottom: 30px;
        padding-bottom: 20px;
        border-bottom: 2px solid #e5e7eb;
      `;

      const platformSpan = document.createElement('div');
      platformSpan.innerHTML = `<strong>Platform:</strong> ${this.formatPlatformName(conversation.platform)}`;
      platformSpan.style.marginBottom = '4px';
      metadata.appendChild(platformSpan);

      if (conversation.model) {
        const modelSpan = document.createElement('div');
        modelSpan.innerHTML = `<strong>Model:</strong> ${conversation.model}`;
        modelSpan.style.marginBottom = '4px';
        metadata.appendChild(modelSpan);
      }

      if (conversation.createdAt) {
        const dateSpan = document.createElement('div');
        dateSpan.innerHTML = `<strong>Exported:</strong> ${this.formatTimestamp(conversation.createdAt)}`;
        metadata.appendChild(dateSpan);
      }

      container.appendChild(metadata);
    }

    // Add Q&A pairs
    pairs.forEach((pair) => {
      const pairContainer = document.createElement('div');
      pairContainer.style.cssText = `
        margin-bottom: 40px;
      `;

      // User message
      const userDiv = this.createMessageDiv('User', pair.question.htmlContent || pair.question.content, '#10a37f');
      pairContainer.appendChild(userDiv);

      // Assistant message
      const assistantDiv = this.createMessageDiv('Assistant', pair.answer.htmlContent || pair.answer.content, '#5f6368');
      pairContainer.appendChild(assistantDiv);

      container.appendChild(pairContainer);
    });

    return container;
  }

  /**
   * Create a message div with proper styling
   */
  private createMessageDiv(role: string, content: string, accentColor: string): HTMLElement {
    const messageDiv = document.createElement('div');
    messageDiv.style.cssText = `
      margin-bottom: 16px;
    `;

    const roleLabel = document.createElement('div');
    roleLabel.textContent = role;
    roleLabel.style.cssText = `
      font-weight: 600;
      font-size: 14px;
      color: ${accentColor};
      margin-bottom: 8px;
    `;
    messageDiv.appendChild(roleLabel);

    const contentDiv = document.createElement('div');
    contentDiv.style.cssText = `
      font-size: 13px;
      line-height: 1.6;
      color: #374151;
      white-space: pre-wrap;
      word-break: break-word;
    `;

    // Handle HTML content
    if (content.includes('<')) {
      contentDiv.innerHTML = content;

      // Style code blocks
      contentDiv.querySelectorAll('pre').forEach((pre) => {
        (pre as HTMLElement).style.cssText = `
          background: #f3f4f6;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 12px;
          overflow-x: auto;
          font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
          font-size: 12px;
          margin: 8px 0;
        `;
      });

      // Style inline code
      contentDiv.querySelectorAll('code').forEach((code) => {
        if (!code.parentElement || code.parentElement.tagName !== 'PRE') {
          (code as HTMLElement).style.cssText = `
            background: #f3f4f6;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
            font-size: 12px;
          `;
        }
      });

      // Style headings
      contentDiv.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading) => {
        (heading as HTMLElement).style.cssText = `
          font-weight: 600;
          margin: 16px 0 8px 0;
          color: #111827;
        `;
      });

      // Style lists
      contentDiv.querySelectorAll('ul, ol').forEach((list) => {
        (list as HTMLElement).style.cssText = `
          margin: 8px 0;
          padding-left: 24px;
        `;
      });
    } else {
      contentDiv.textContent = content;
    }

    messageDiv.appendChild(contentDiv);
    return messageDiv;
  }

  /**
   * Convert HTML element to PDF using html2canvas and jsPDF
   */
  private async htmlToPdf(
    element: HTMLElement,
    pdfOptions: PDFExportOptions = DEFAULT_PDF_OPTIONS
  ): Promise<Blob> {
    try {
      // Wait a bit for rendering to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Render HTML to canvas
      const canvas = await html2canvas(element, {
        scale: 2, // Higher quality
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: 880, // Slightly larger than container
        windowHeight: element.scrollHeight + 100,
      });

      // Verify canvas has valid data
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        throw new Error('Failed to render HTML to canvas');
      }

      // Dynamic import for jsPDF
      const jspdfModule = await import('jspdf');
      const jsPDF = jspdfModule.jsPDF;

      // Convert canvas to image data
      const imgData = canvas.toDataURL('image/jpeg', pdfOptions.imageQuality);

      // Verify image data is valid
      if (!imgData || !imgData.startsWith('data:image')) {
        throw new Error('Failed to convert canvas to image');
      }

      const pdf = new jsPDF({
        orientation: pdfOptions.orientation,
        unit: 'mm',
        format: pdfOptions.pageSize,
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margins = pdfOptions.margins;

      const imgWidth = pageWidth - margins.left - margins.right;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = margins.top;

      // Add first page
      pdf.addImage(imgData, 'JPEG', margins.left, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pageHeight - margins.top - margins.bottom;

      // Add additional pages if needed
      while (heightLeft > 0) {
        position = heightLeft - imgHeight + margins.top;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', margins.left, position, imgWidth, imgHeight, undefined, 'FAST');
        heightLeft -= pageHeight - margins.top - margins.bottom;
      }

      // Add page numbers
      if (pdfOptions.includePageNumbers) {
        const pageCount = pdf.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
          pdf.setPage(i);
          pdf.setFontSize(10);
          pdf.setTextColor(150);
          pdf.text(
            `Page ${i} of ${pageCount}`,
            pageWidth / 2,
            pageHeight - margins.bottom / 2,
            { align: 'center' }
          );
        }
      }

      return pdf.output('blob');
    } catch (error) {
      console.error('[PDF Export] Error during HTML to PDF conversion:', error);
      throw new Error(`PDF generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
