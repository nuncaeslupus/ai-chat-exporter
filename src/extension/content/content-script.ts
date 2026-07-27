/**
 * Content script - main entry point for page injection
 * Runs on AI chatbot pages to inject export functionality
 */

import { detectParser } from '../../core/parsers';
import { getExporter } from '../../core/exporters';
import { FilenameService } from '../../core/services/filename-service';
import { ClaudeApiService } from '../../core/services/claude-api-service';
import { StorageService } from '../../shared/storage';
import type { Conversation, ExportFormat } from '../../core/types';
import { marked } from 'marked';
import hljs from 'highlight.js';

/**
 * Main content script controller
 */
class ContentScript {
  private conversation: Conversation | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    // Always re-parse for ChatGPT since it's a dynamic SPA
    // Don't use the initialized flag to skip

    // Find matching parser for current page
    const parser = detectParser();
    if (!parser) {
      console.log('[AI Chat Exporter] No parser found for current page');
      this.notifyPageReadyState(false);
      return;
    }

    if (!this.initialized) {
      console.log(
        `[AI Chat Exporter] Detected platform: ${parser.platformInfo.name}`,
      );
    }

    // Parse the conversation
    const parseResult = parser.parse();
    if (!parseResult.success || !parseResult.conversation) {
      console.error('[AI Chat Exporter] Failed to parse conversation:', parseResult.error);
      this.notifyPageReadyState(false);
      return;
    }

    this.conversation = parseResult.conversation;

    console.log('[AI Chat Exporter] Successfully initialized');
    console.log(`[AI Chat Exporter] Found ${this.conversation.pairs.length} conversation pairs`);
    this.initialized = true;
    this.notifyPageReadyState(true);
  }

  /**
   * Notify background script about page readiness state
   */
  private notifyPageReadyState(ready: boolean): void {
    chrome.runtime.sendMessage({
      type: 'page_ready_state',
      ready: ready,
    }).catch((error) => {
      // Ignore errors if background script is not available
      console.log('[AI Chat Exporter] Could not notify background script:', error);
    });
  }

  async handleExport(format: ExportFormat): Promise<void> {
    // Re-parse conversation to get latest content (ChatGPT is dynamic SPA)
    await this.initialize();

    if (!this.conversation) {
      console.error('[AI Chat Exporter] No conversation available');
      return;
    }

    console.log(`[AI Chat Exporter] Attempting to export ${this.conversation.pairs.length} pairs to ${format}`);

    try {
      // Check if we have any pairs to export
      if (this.conversation.pairs.length === 0) {
        console.warn('[AI Chat Exporter] No conversation pairs found');
        return;
      }

      // Enrich Claude conversations with API data (artifacts content)
      if (this.conversation.platform === 'claude') {
        this.conversation = await this.enrichClaudeConversation(this.conversation);
      }

      // Use all pairs for export
      const pairsToExport = this.conversation.pairs;

      // Debug: Check if artifacts have content before export
      console.log('[AI Chat Exporter] Pairs to export:', pairsToExport.length);
      pairsToExport.forEach((pair, i) => {
        const artifacts = pair.answer.metadata?.artifacts || [];
        console.log(`[AI Chat Exporter] Pair ${i}: ${artifacts.length} artifacts`);
        artifacts.forEach((a, j) => {
          console.log(`[AI Chat Exporter] Pair ${i}, Artifact ${j}: "${a.title}", hasContent:`, !!a.content, 'length:', a.content?.length || 0);
        });
      });

      // Get exporter for format
      const exporter = getExporter(format);
      if (!exporter) {
        throw new Error(`No exporter found for format: ${format}`);
      }

      // Get export options from preferences
      const prefs = await StorageService.getUserPreferences();

      // Export conversation (use all pairs)
      const result = await exporter.export(
        this.conversation,
        pairsToExport,
        {
          format,
          filename: '',
          includeMetadata: prefs.includeMetadata,
          includeTimestamps: false,
        }
      );

      if (!result.success || !result.blob) {
        throw new Error(result.error || 'Export failed');
      }

      // Generate filename
      const variables = FilenameService.getVariablesFromConversation(this.conversation);
      const baseFilename = FilenameService.generateFilename(prefs.filenameTemplate, variables);
      const filename = FilenameService.addExtension(baseFilename, exporter.extension);

      // Download file
      this.downloadFile(result.blob, filename);

      // Save last used format
      await StorageService.setLastExportFormat(format);

      console.log(`[AI Chat Exporter] Successfully exported to ${format.toUpperCase()}`);
    } catch (error) {
      console.error('[AI Chat Exporter] Export failed:', error);
    }
  }

  /**
   * Enrich Claude conversation with artifact content from API
   */
  private async enrichClaudeConversation(conversation: Conversation): Promise<Conversation> {
    try {
      console.log('[AI Chat Exporter] Enriching Claude conversation with API data...');

      const ids = ClaudeApiService.extractIdsFromPage(conversation.url, document);

      if (!ids) {
        console.log('[AI Chat Exporter] Could not extract IDs for API enrichment');
        return conversation;
      }

      const apiData = await ClaudeApiService.fetchConversationData(ids);

      if (!apiData) {
        console.log('[AI Chat Exporter] API data not available');
        return conversation;
      }

      const enriched = ClaudeApiService.enrichConversationWithArtifacts(conversation, apiData);
      console.log('[AI Chat Exporter] Claude conversation enriched successfully');

      return enriched;
    } catch (error) {
      console.warn('[AI Chat Exporter] Failed to enrich Claude conversation:', error);
      // Return original conversation if enrichment fails
      return conversation;
    }
  }

  private downloadFile(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async handlePrint(format: ExportFormat): Promise<void> {
    // Re-parse conversation to get latest content
    await this.initialize();

    if (!this.conversation) {
      console.error('[AI Chat Exporter] No conversation available');
      return;
    }

    console.log(`[AI Chat Exporter] Attempting to print ${this.conversation.pairs.length} pairs as ${format}`);

    try {
      // Check if we have any pairs to print
      if (this.conversation.pairs.length === 0) {
        console.warn('[AI Chat Exporter] No conversation pairs found');
        return;
      }

      // Enrich Claude conversations with API data (artifacts content)
      if (this.conversation.platform === 'claude') {
        this.conversation = await this.enrichClaudeConversation(this.conversation);
      }

      const pairsToExport = this.conversation.pairs;

      // Get exporter for format
      const exporter = getExporter(format);
      if (!exporter) {
        throw new Error(`No exporter found for format: ${format}`);
      }

      // Get export options from preferences
      const prefs = await StorageService.getUserPreferences();

      // Export conversation
      const result = await exporter.export(
        this.conversation,
        pairsToExport,
        {
          format,
          filename: '',
          includeMetadata: prefs.includeMetadata,
          includeTimestamps: false,
        }
      );

      if (!result.success || !result.blob) {
        throw new Error(result.error || 'Print generation failed');
      }

      // For MD format, convert to clean GitHub-style HTML for printing
      if (format === 'md') {
        const reader = new FileReader();
        reader.onload = async () => {
          const markdown = reader.result as string;
          const cleanHtml = await this.renderMarkdownToCleanHtml(markdown, this.conversation!.title);
          const htmlBlob = new Blob([cleanHtml], { type: 'text/html' });
          this.printBlob(htmlBlob, 'html', 'text/html');
        };
        reader.readAsText(result.blob);
      } else {
        // Open in new window and trigger print
        this.printBlob(result.blob, format, result.mimeType || exporter.mimeType);
      }

      console.log(`[AI Chat Exporter] Successfully opened ${format.toUpperCase()} for printing`);
    } catch (error) {
      console.error('[AI Chat Exporter] Print failed:', error);
    }
  }

  private printBlob(blob: Blob, format: ExportFormat, _mimeType: string): void {
    const url = URL.createObjectURL(blob);

    // For HTML and PDF, we can open directly
    if (format === 'html' || format === 'pdf') {
      const printWindow = window.open(url, '_blank');
      if (printWindow) {
        // Wait for content to load, then trigger print
        printWindow.addEventListener('load', () => {
          setTimeout(() => {
            printWindow.print();
            // Clean up the URL after printing
            printWindow.addEventListener('afterprint', () => {
              URL.revokeObjectURL(url);
            });
          }, 500);
        });
      }
    } else {
      // For text formats (MD, TXT, JSON), wrap in simple HTML for printing
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        const printHtml = this.wrapInPrintHtml(content, format);
        const printBlob = new Blob([printHtml], { type: 'text/html' });
        const printUrl = URL.createObjectURL(printBlob);

        const printWindow = window.open(printUrl, '_blank');
        if (printWindow) {
          printWindow.addEventListener('load', () => {
            setTimeout(() => {
              printWindow.print();
              printWindow.addEventListener('afterprint', () => {
                URL.revokeObjectURL(printUrl);
              });
            }, 500);
          });
        }
      };
      reader.readAsText(blob);
    }
  }

  private wrapInPrintHtml(content: string, format: ExportFormat): string {
    const escapedContent = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Print ${format.toUpperCase()}</title>
  <style>
    body {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.6;
      margin: 2cm;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    @media print {
      body {
        margin: 0;
      }
    }
  </style>
</head>
<body>${escapedContent}</body>
</html>`;
  }

  /**
   * Render markdown to clean, GitHub-style HTML for printing
   * Uses marked.js library for proper markdown parsing
   */
  private async renderMarkdownToCleanHtml(markdown: string, title: string): Promise<string> {
    // Configure marked for GitHub Flavored Markdown with syntax highlighting
    marked.setOptions({ gfm: true, breaks: false });
    marked.use({
      renderer: {
        code({ text, lang }) {
          const language = lang && hljs.getLanguage(lang) ? lang : null;
          const highlighted = language
            ? hljs.highlight(text, { language }).value
            : hljs.highlightAuto(text).value;
          return `<pre><code class="hljs language-${language ?? 'plaintext'}">${highlighted}</code></pre>`;
        },
      },
    });

    // Parse markdown to HTML
    const htmlContent = await marked.parse(markdown);

    const escapeHtml = (text: string) => {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    /* GitHub Markdown CSS - Based on github-markdown-css */
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 45px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.5;
      color: #1f2328;
      background-color: #ffffff;
    }

    .markdown-body {
      max-width: 980px;
      margin: 0 auto;
    }

    .markdown-body > *:first-child {
      margin-top: 0 !important;
    }

    .markdown-body > *:last-child {
      margin-bottom: 0 !important;
    }

    .markdown-body h1, .markdown-body h2, .markdown-body h3,
    .markdown-body h4, .markdown-body h5, .markdown-body h6 {
      margin-top: 24px;
      margin-bottom: 16px;
      font-weight: 600;
      line-height: 1.25;
    }

    .markdown-body h1 {
      font-size: 2em;
      border-bottom: 1px solid #d0d7de;
      padding-bottom: .3em;
    }

    .markdown-body h2 {
      font-size: 1.5em;
      border-bottom: 1px solid #d0d7de;
      padding-bottom: .3em;
    }

    .markdown-body h3 { font-size: 1.25em; }
    .markdown-body h4 { font-size: 1em; }
    .markdown-body h5 { font-size: .875em; }
    .markdown-body h6 { font-size: .85em; color: #656d76; }

    .markdown-body p {
      margin-top: 0;
      margin-bottom: 16px;
    }

    .markdown-body blockquote {
      margin: 0;
      padding: 0 1em;
      color: #656d76;
      border-left: .25em solid #d0d7de;
    }

    .markdown-body ul, .markdown-body ol {
      margin-top: 0;
      margin-bottom: 16px;
      padding-left: 2em;
    }

    .markdown-body li {
      margin-bottom: .25em;
    }

    .markdown-body li + li {
      margin-top: .25em;
    }

    .markdown-body code {
      padding: .2em .4em;
      margin: 0;
      font-size: 85%;
      white-space: break-spaces;
      background-color: rgba(175,184,193,0.2);
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
    }

    .markdown-body pre {
      margin-top: 0;
      margin-bottom: 16px;
      padding: 16px;
      overflow: auto;
      font-size: 85%;
      line-height: 1.45;
      background-color: #f6f8fa;
      border-radius: 6px;
    }

    .markdown-body pre code {
      display: inline;
      padding: 0;
      margin: 0;
      overflow: visible;
      line-height: inherit;
      word-wrap: normal;
      background-color: transparent;
      border: 0;
    }

    .markdown-body table {
      border-spacing: 0;
      border-collapse: collapse;
      display: block;
      width: max-content;
      max-width: 100%;
      overflow: auto;
      margin-top: 0;
      margin-bottom: 16px;
    }

    .markdown-body table tr {
      background-color: #ffffff;
      border-top: 1px solid hsla(210,18%,87%,1);
    }

    .markdown-body table tr:nth-child(2n) {
      background-color: #f6f8fa;
    }

    .markdown-body table th {
      padding: 6px 13px;
      border: 1px solid #d0d7de;
      font-weight: 600;
    }

    .markdown-body table td {
      padding: 6px 13px;
      border: 1px solid #d0d7de;
    }

    .markdown-body hr {
      height: .25em;
      padding: 0;
      margin: 24px 0;
      background-color: #d0d7de;
      border: 0;
    }

    .markdown-body a {
      color: #0969da;
      text-decoration: none;
    }

    .markdown-body a:hover {
      text-decoration: underline;
    }

    .markdown-body strong {
      font-weight: 600;
    }

    .markdown-body em {
      font-style: italic;
    }

    .markdown-body img {
      max-width: 100%;
      box-sizing: content-box;
      background-color: #ffffff;
    }

    @media print {
      body {
        padding: 0;
      }

      .markdown-body {
        max-width: 100%;
      }

      @page {
        margin: 2cm;
      }
    }
  </style>
</head>
<body>
  <div class="markdown-body">
${htmlContent}
  </div>
</body>
</html>`;
  }

  getConversation(): Conversation | null {
    return this.conversation;
  }
}

// Initialize content script
const contentScript = new ContentScript();

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    contentScript.initialize();
  });
} else {
  contentScript.initialize();
}

// Set up message listener for communication with popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'get_conversation') {
        // Re-parse conversation to get latest content
        await contentScript.initialize();
        const conversation = contentScript.getConversation();
        sendResponse({
          success: true,
          data: conversation,
        });
      } else if (message.type === 'export_conversation') {
        await contentScript.handleExport(message.format);
        sendResponse({
          success: true,
        });
      } else if (message.type === 'print_conversation') {
        await contentScript.handlePrint(message.format);
        sendResponse({
          success: true,
        });
      } else {
        sendResponse({
          success: false,
          error: `Unknown message type: ${message.type}`,
        });
      }
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  })();

  // Return true to indicate we'll send a response asynchronously
  return true;
});
