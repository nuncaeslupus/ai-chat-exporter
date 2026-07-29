/**
 * Content script - main entry point for page injection
 * Runs on AI chatbot pages to inject export functionality
 */

import { detectParser } from '../../core/parsers';
import { getExporter } from '../../core/exporters';
import { FilenameService } from '../../core/services/filename-service';
import { ClaudeApiService, type EnrichmentResult } from '../../core/services/claude-api-service';
import { SelectionService } from '../../core/services/selection-service';
import { StorageService } from '../../shared/storage';
import type { Conversation, ExportFormat } from '../../core/types';
import { sanitizeHtml } from '../../core/utils/sanitize-html';
import {
  isExportConversationMessage,
  isPrintConversationMessage,
  isGetConversationMessage,
} from '../../shared/messages';

/**
 * Apply the popup's per-pair selection (by `pair.index`, the only identifier
 * stable across a re-parse — `pair.id` is regenerated every call) to a freshly
 * parsed conversation. `undefined` means the popup sent no selection (e.g. an
 * older popup, or a direct/test caller) — leave the parser's own `selected`
 * defaults untouched.
 */
function applySelection(conversation: Conversation, selectedIndices?: number[]): Conversation {
  if (!selectedIndices) {
    return conversation;
  }
  const selected = new Set(selectedIndices);
  return {
    ...conversation,
    pairs: conversation.pairs.map((pair) => ({ ...pair, selected: selected.has(pair.index) })),
  };
}

/**
 * Main content script controller
 */
class ContentScript {
  private conversation: Conversation | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    // Always re-parse for ChatGPT since it's a dynamic SPA
    // Don't use the initialized flag to skip
    const conversation = this.parseConversation();
    if (!conversation) {
      this.notifyPageReadyState(false);
      return;
    }

    this.conversation = conversation;
    this.notifyPageReadyState(true);
  }

  /**
   * Parse the conversation off the live page and return it directly, without
   * touching instance state (`this.conversation`).
   *
   * `handleExport`/`handlePrint` each call this to get their own local
   * snapshot rather than sharing `this.conversation` — a double-click on
   * Export, or Export firing while a Print is mid-flight, runs two of these
   * pipelines concurrently, and instance state shared between them would let
   * one overwrite the other's in-flight conversation (lo-08b0).
   */
  private parseConversation(): Conversation | null {
    const parser = detectParser();
    if (!parser) {
      console.log('[AI Chat Exporter] No parser found for current page');
      return null;
    }

    if (!this.initialized) {
      console.log(`[AI Chat Exporter] Detected platform: ${parser.platformInfo.name}`);
    }

    const parseResult = parser.parse();
    if (!parseResult.success || !parseResult.conversation) {
      console.error('[AI Chat Exporter] Failed to parse conversation:', parseResult.error);
      return null;
    }

    console.log('[AI Chat Exporter] Successfully initialized');
    console.log(
      `[AI Chat Exporter] Found ${parseResult.conversation.pairs.length} conversation pairs`
    );
    this.initialized = true;
    return parseResult.conversation;
  }

  /**
   * Notify background script about page readiness state
   */
  private notifyPageReadyState(ready: boolean): void {
    chrome.runtime
      .sendMessage({
        type: 'page_ready_state',
        ready: ready,
      })
      .catch((error) => {
        // Ignore errors if background script is not available
        console.log('[AI Chat Exporter] Could not notify background script:', error);
      });
  }

  /**
   * Export the conversation.
   *
   * Resolves with a user-facing warning when the export completed but is
   * degraded (see `enrichClaudeConversation`), or `undefined` when it is
   * complete. Failures throw.
   */
  async handleExport(
    format: ExportFormat,
    selectedIndices?: number[]
  ): Promise<string | undefined> {
    // Re-parse conversation to get latest content (ChatGPT is dynamic SPA).
    // Operate on a local snapshot, not `this.conversation` — a concurrent
    // export/print call must never see or clobber this call's data (lo-08b0).
    let conversation = this.parseConversation();

    if (!conversation) {
      console.error('[AI Chat Exporter] No conversation available');
      return undefined;
    }

    conversation = applySelection(conversation, selectedIndices);

    console.log(
      `[AI Chat Exporter] Attempting to export ${conversation.pairs.length} pairs to ${format}`
    );
    let warning: string | undefined;

    try {
      // Check if we have any pairs to export
      if (conversation.pairs.length === 0) {
        throw new Error('No conversation pairs found to export');
      }

      // Enrich Claude conversations with API data (artifacts content)
      if (conversation.platform === 'claude') {
        const enrichment = await this.enrichClaudeConversation(conversation);
        conversation = enrichment.conversation;
        warning = enrichment.warning;
      }

      // Only the pairs the user left selected in the popup go into the export.
      const pairsToExport = SelectionService.getSelectedPairs(conversation.pairs);

      // Get exporter for format
      const exporter = await getExporter(format);
      if (!exporter) {
        throw new Error(`No exporter found for format: ${format}`);
      }

      // Get export options from preferences
      const prefs = await StorageService.getUserPreferences();

      // Export conversation (use all pairs)
      const result = await exporter.export(conversation, pairsToExport, {
        format,
        filename: '',
        includeMetadata: prefs.includeMetadata,
        includeTimestamps: prefs.includeTimestamps,
        fontScale: prefs.fontScale,
      });

      if (!result.success || !result.blob) {
        throw new Error(result.error || 'Export failed');
      }

      // Generate filename — the same call the popup's preview makes, so the
      // name it showed is the name that lands on disk.
      const filename = FilenameService.buildFilename(
        prefs,
        FilenameService.getVariablesFromConversation(conversation),
        exporter.extension
      );

      // Download file
      this.downloadFile(result.blob, filename);

      // Save last used format
      await StorageService.setLastExportFormat(format);

      console.log(`[AI Chat Exporter] Successfully exported to ${format.toUpperCase()}`);
      return warning;
    } catch (error) {
      console.error('[AI Chat Exporter] Export failed:', error);
      throw error;
    }
  }

  /**
   * Enrich Claude conversation with artifact content from API.
   *
   * Every path that skips enrichment returns a `warning`: the export still
   * succeeds, but it is missing artifact contents and the user has to be told
   * — a console log alone leaves them with a silently degraded file.
   */
  private async enrichClaudeConversation(conversation: Conversation): Promise<EnrichmentResult> {
    const degraded =
      'Artifact contents were left out of this export because Claude’s conversation data ' +
      'could not be read. Make sure you are signed in to claude.ai, reload the page and try again.';

    try {
      console.log('[AI Chat Exporter] Enriching Claude conversation with API data...');

      const ids = ClaudeApiService.extractIdsFromPage(conversation.url, document);

      if (!ids) {
        console.log('[AI Chat Exporter] Could not extract IDs for API enrichment');
        return { conversation, warning: degraded };
      }

      const apiData = await ClaudeApiService.fetchConversationData(ids);

      if (!apiData) {
        console.log('[AI Chat Exporter] API data not available');
        return { conversation, warning: degraded };
      }

      const enriched = ClaudeApiService.enrichConversationWithArtifacts(conversation, apiData);
      console.log('[AI Chat Exporter] Claude conversation enriched successfully');

      return enriched;
    } catch (error) {
      console.warn('[AI Chat Exporter] Failed to enrich Claude conversation:', error);
      // Export the un-enriched conversation, but say so.
      return { conversation, warning: degraded };
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

  async handlePrint(format: ExportFormat, selectedIndices?: number[]): Promise<string | undefined> {
    // Open the print window synchronously, before any `await` — opening it
    // after the re-parse/API/export awaits below loses the user-gesture
    // context and gets popup-blocked.
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      throw new Error(
        'Could not open the print window. Your browser blocked the popup — allow popups for this site and try again.'
      );
    }
    printWindow.document.write('<p>Preparing document for printing…</p>');

    // Re-parse conversation to get latest content. Operate on a local
    // snapshot, not `this.conversation` — a concurrent export/print call
    // must never see or clobber this call's data (lo-08b0).
    let conversation = this.parseConversation();

    if (!conversation) {
      console.error('[AI Chat Exporter] No conversation available');
      printWindow.close();
      return undefined;
    }

    conversation = applySelection(conversation, selectedIndices);

    console.log(
      `[AI Chat Exporter] Attempting to print ${conversation.pairs.length} pairs as ${format}`
    );
    let warning: string | undefined;

    try {
      // Check if we have any pairs to print
      if (conversation.pairs.length === 0) {
        throw new Error('No conversation pairs found to print');
      }

      // Enrich Claude conversations with API data (artifacts content)
      if (conversation.platform === 'claude') {
        const enrichment = await this.enrichClaudeConversation(conversation);
        conversation = enrichment.conversation;
        warning = enrichment.warning;
      }

      // Freeze the final snapshot in a `const` so the closures below (which
      // outlive this function's execution) keep a stable, non-null reference.
      const finalConversation = conversation;
      const pairsToExport = SelectionService.getSelectedPairs(finalConversation.pairs);

      // Get exporter for format
      const exporter = await getExporter(format);
      if (!exporter) {
        throw new Error(`No exporter found for format: ${format}`);
      }

      // Get export options from preferences
      const prefs = await StorageService.getUserPreferences();

      // Export conversation
      const result = await exporter.export(finalConversation, pairsToExport, {
        format,
        filename: '',
        includeMetadata: prefs.includeMetadata,
        includeTimestamps: prefs.includeTimestamps,
        fontScale: prefs.fontScale,
      });

      if (!result.success || !result.blob) {
        throw new Error(result.error || 'Print generation failed');
      }

      // For MD format, convert to clean GitHub-style HTML for printing
      if (format === 'md') {
        const reader = new FileReader();
        reader.onload = async () => {
          const markdown = reader.result as string;
          const cleanHtml = await this.renderMarkdownToCleanHtml(markdown, finalConversation.title);
          const htmlBlob = new Blob([cleanHtml], { type: 'text/html' });
          this.printBlob(printWindow, htmlBlob, 'html');
        };
        reader.readAsText(result.blob);
      } else {
        // Fill the already-open window and trigger print
        this.printBlob(printWindow, result.blob, format);
      }

      console.log(`[AI Chat Exporter] Successfully opened ${format.toUpperCase()} for printing`);
      return warning;
    } catch (error) {
      console.error('[AI Chat Exporter] Print failed:', error);
      printWindow.close();
      throw error;
    }
  }

  private printBlob(printWindow: Window, blob: Blob, format: ExportFormat): void {
    // For HTML and PDF, we can print directly
    if (format === 'html' || format === 'pdf') {
      const url = URL.createObjectURL(blob);
      printWindow.addEventListener('load', () => {
        setTimeout(() => {
          printWindow.print();
          // Clean up the URL after printing
          printWindow.addEventListener('afterprint', () => {
            URL.revokeObjectURL(url);
          });
        }, 500);
      });
      printWindow.location.href = url;
    } else {
      // For text formats (MD, TXT, JSON), wrap in simple HTML for printing
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        const printHtml = this.wrapInPrintHtml(content, format);
        const printBlob = new Blob([printHtml], { type: 'text/html' });
        const printUrl = URL.createObjectURL(printBlob);

        printWindow.addEventListener('load', () => {
          setTimeout(() => {
            printWindow.print();
            printWindow.addEventListener('afterprint', () => {
              URL.revokeObjectURL(printUrl);
            });
          }, 500);
        });
        printWindow.location.href = printUrl;
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
    // Loaded on demand: this is the print-only path, and full highlight.js is
    // ~950 KB (194 languages) that every page load would otherwise pay for.
    const [{ marked }, { default: hljs }] = await Promise.all([
      import('marked'),
      import('highlight.js'),
    ]);

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
${sanitizeHtml(htmlContent)}
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
    void contentScript.initialize();
  });
} else {
  void contentScript.initialize();
}

// Set up message listener for communication with popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      if (isGetConversationMessage(message)) {
        // Re-parse conversation to get latest content
        await contentScript.initialize();
        const conversation = contentScript.getConversation();
        sendResponse({
          success: true,
          data: conversation,
        });
      } else if (isExportConversationMessage(message)) {
        const warning = await contentScript.handleExport(message.format, message.selectedIndices);
        sendResponse({
          success: true,
          ...(warning && { warning }),
        });
      } else if (isPrintConversationMessage(message)) {
        const warning = await contentScript.handlePrint(message.format, message.selectedIndices);
        sendResponse({
          success: true,
          ...(warning && { warning }),
        });
      } else {
        sendResponse({
          success: false,
          error: `Unknown message type: ${String((message as { type?: unknown }).type)}`,
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
