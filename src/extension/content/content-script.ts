/**
 * Content script - main entry point for page injection
 * Runs on AI chatbot pages to inject export functionality
 */

import { detectParser } from '../../core/parsers';
import { getExporter } from '../../core/exporters';
import { FilenameService } from '../../core/services/filename-service';
import { ClaudeApiService, type EnrichmentResult } from '../../core/services/claude-api-service';
import { WARNING_KEYS, ERROR_KEYS } from '../../shared/constants';
import { SelectionService } from '../../core/services/selection-service';
import { StorageService } from '../../shared/storage';
import type { Conversation, ExportFormat } from '../../core/types';
import { sanitizeHtml } from '../../core/utils/sanitize-html';
import { buildSkeleton, type DriftReport } from '../../core/drift';
import {
  isExportConversationMessage,
  isPrintConversationMessage,
  isGetConversationMessage,
  isGetDriftSkeletonMessage,
} from '../../shared/messages';
import {
  DEEP_RESEARCH_FRAME_ORIGIN_RE,
  isDeepResearchFrameMessage,
} from '../../shared/deep-research-relay';
import {
  CHATGPT_SELECTORS,
  EMBEDDED_FRAME_REPORT_ATTR,
  EMBEDDED_FRAME_REPORT_HTML_ATTR,
} from '../../core/parsers/chatgpt/selectors';

/** How often to check whether the print document has finished loading. */
const PRINT_POLL_INTERVAL_MS = 100;

/** Give up waiting for the print document and print anyway after this long. */
const PRINT_LOAD_TIMEOUT_MS = 10_000;

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
  /** Drift from the most recent parse. Content-free; see `src/core/drift`. */
  private drift: DriftReport | undefined;
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
    this.drift = parseResult.drift;
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
      // A locale key, not prose: the popup resolves it with getMessage() so
      // a DOM-drift parse failure is reported as a failure, not silently
      // as `{success: true}` (the caller's catch turns this throw into
      // `{success: false, error}`).
      throw new Error(ERROR_KEYS.NO_CONVERSATION);
    }

    conversation = applySelection(conversation, selectedIndices);

    console.log(
      `[AI Chat Exporter] Attempting to export ${conversation.pairs.length} pairs to ${format}`
    );
    let warning: string | undefined;

    try {
      // Check if we have any pairs to export
      if (conversation.pairs.length === 0) {
        throw new Error(ERROR_KEYS.NOTHING_TO_EXPORT);
      }

      // Enrich Claude conversations with API data (artifacts content)
      if (conversation.platform === 'claude') {
        const enrichment = await this.enrichClaudeConversation(conversation);
        conversation = enrichment.conversation;
        warning = enrichment.warning;
      }

      // Only the pairs the user left selected in the popup go into the export.
      const pairsToExport = SelectionService.getSelectedPairs(conversation.pairs);
      if (pairsToExport.length === 0) {
        // The popup's selection matched nothing on this fresh re-parse (pairs
        // shifted, or the page changed) — an empty file is a failure, not a
        // degraded success.
        throw new Error(ERROR_KEYS.NOTHING_TO_EXPORT);
      }

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
        showMetaInfo: prefs.showMetaInfo,
        fontScale: prefs.fontScale,
      });

      if (!result.success || !result.blob) {
        throw new Error(result.error || 'Export failed');
      }
      // A format-level warning (e.g. PDF's fonts can't render this script)
      // takes priority over an enrichment one — it describes the file that's
      // actually about to land on disk.
      warning = result.warning ?? warning;

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
   * succeeds, but it is missing artifact contents (and Claude's real
   * per-message timestamps) and the user has to be told — a console log alone
   * leaves them with a silently degraded file. `warning` is a locale key, not
   * prose — the popup resolves it with `getMessage()` and decides whether
   * Retry can help from the key itself (see `RETRYABLE_WARNING_KEYS`).
   */
  private async enrichClaudeConversation(conversation: Conversation): Promise<EnrichmentResult> {
    try {
      console.log('[AI Chat Exporter] Enriching Claude conversation with API data...');

      const ids = await ClaudeApiService.extractIdsFromPage(conversation.url, document);

      if (!ids) {
        // The page itself is missing what enrichment needs (e.g. no
        // organization id) — retrying the same export won't change that.
        console.log('[AI Chat Exporter] Could not extract IDs for API enrichment');
        return { conversation, warning: WARNING_KEYS.IDS_MISSING };
      }

      const apiData = await ClaudeApiService.fetchConversationData(ids);

      if (!apiData) {
        // The API call itself failed — plausibly a one-off network issue.
        console.log('[AI Chat Exporter] API data not available');
        return { conversation, warning: WARNING_KEYS.FETCH_FAILED };
      }

      const enriched = ClaudeApiService.enrichConversation(conversation, apiData);
      console.log('[AI Chat Exporter] Claude conversation enriched successfully');

      return enriched;
    } catch (error) {
      console.warn('[AI Chat Exporter] Failed to enrich Claude conversation:', error);
      // Export the un-enriched conversation, but say so.
      return { conversation, warning: WARNING_KEYS.FETCH_FAILED };
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
      throw new Error(ERROR_KEYS.PRINT_POPUP_BLOCKED);
    }
    printWindow.document.write('<p>Preparing document for printing…</p>');

    // Re-parse conversation to get latest content. Operate on a local
    // snapshot, not `this.conversation` — a concurrent export/print call
    // must never see or clobber this call's data (lo-08b0).
    let conversation = this.parseConversation();

    if (!conversation) {
      console.error('[AI Chat Exporter] No conversation available');
      printWindow.close();
      throw new Error(ERROR_KEYS.NO_CONVERSATION);
    }

    conversation = applySelection(conversation, selectedIndices);

    console.log(
      `[AI Chat Exporter] Attempting to print ${conversation.pairs.length} pairs as ${format}`
    );
    let warning: string | undefined;

    try {
      // Check if we have any pairs to print
      if (conversation.pairs.length === 0) {
        throw new Error(ERROR_KEYS.NOTHING_TO_EXPORT);
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
      if (pairsToExport.length === 0) {
        // Same guard as handleExport: a selection that matches nothing left
        // on this re-parse must fail, not print an empty document.
        throw new Error(ERROR_KEYS.NOTHING_TO_EXPORT);
      }

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
        showMetaInfo: prefs.showMetaInfo,
        fontScale: prefs.fontScale,
      });

      if (!result.success || !result.blob) {
        throw new Error(result.error || 'Print generation failed');
      }
      // A format-level warning (e.g. PDF's fonts can't render this script)
      // takes priority over an enrichment one — it describes the file that's
      // actually about to be printed.
      warning = result.warning ?? warning;

      // For MD format, convert to clean GitHub-style HTML for printing.
      // Awaited (not a fire-and-forget FileReader callback) so a failure here
      // — a bad blob, or `renderMarkdownToCleanHtml`'s dynamic import/render
      // throwing — propagates to the catch below instead of becoming an
      // unhandled rejection after `{success: true}` has already been sent.
      if (format === 'md') {
        const markdown = await result.blob.text();
        const cleanHtml = await this.renderMarkdownToCleanHtml(markdown, finalConversation.title);
        await this.printBlob(printWindow, new Blob([cleanHtml], { type: 'text/html' }), 'html');
      } else {
        // Fill the already-open window and trigger print
        await this.printBlob(printWindow, result.blob, format);
      }

      console.log(`[AI Chat Exporter] Successfully opened ${format.toUpperCase()} for printing`);
      return warning;
    } catch (error) {
      console.error('[AI Chat Exporter] Print failed:', error);
      printWindow.close();
      throw error;
    }
  }

  private async printBlob(printWindow: Window, blob: Blob, format: ExportFormat): Promise<void> {
    // HTML and PDF are already printable documents; text formats (MD, TXT,
    // JSON) get wrapped in a minimal one first.
    if (format === 'html' || format === 'pdf') {
      this.navigateAndPrint(printWindow, blob);
      return;
    }
    const text = await blob.text();
    const printHtml = this.wrapInPrintHtml(text, format);
    this.navigateAndPrint(printWindow, new Blob([printHtml], { type: 'text/html' }));
  }

  /**
   * Point the pre-opened window at `blob` and raise the print dialog once the
   * document is actually on screen.
   *
   * Polls instead of listening for `load`: navigating a window replaces its
   * inner Window object, so a listener registered on `printWindow` *before*
   * `location.href` is assigned is thrown away with the old Window and never
   * fires. (Verified in Chrome: the blob document loads and `readyState`
   * reaches 'complete', but the listener does not run — which is why the
   * print dialog never appeared.) Reading `printWindow.document` through the
   * WindowProxy on each tick always resolves to the current document.
   */
  private navigateAndPrint(printWindow: Window, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    printWindow.location.href = url;

    const deadline = Date.now() + PRINT_LOAD_TIMEOUT_MS;
    const poll = setInterval(() => {
      let loaded = false;
      try {
        loaded =
          printWindow.location.href === url && printWindow.document.readyState === 'complete';
      } catch {
        // A cross-origin document would make these reads throw; fall through
        // to the deadline rather than throwing on every tick forever.
      }
      // ponytail: print on timeout too — a slow document still beats no
      // dialog, which is what the old fixed 500ms delay effectively assumed.
      if (!loaded && Date.now() < deadline) {
        return;
      }
      clearInterval(poll);
      if (!printWindow.closed) {
        printWindow.print();
      }
      URL.revokeObjectURL(url);
    }, PRINT_POLL_INTERVAL_MS);
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
    const [{ marked }, { default: hljs }, { requireDoubleTildeStrikethrough }] = await Promise.all([
      import('marked'),
      import('highlight.js'),
      import('../../core/utils/markdown-options'),
    ]);

    // Configure marked for GitHub Flavored Markdown with syntax highlighting
    marked.setOptions({ gfm: true, breaks: false });
    requireDoubleTildeStrikethrough(marked);
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

  getDrift(): DriftReport | undefined {
    return this.drift;
  }
}

/**
 * Handle a `postMessage` from a Deep Research / connector-widget sandboxed
 * iframe (see `deep-research-frame.ts`, which runs inside that frame).
 *
 * Validates the sender's origin against the sandbox host pattern before
 * trusting anything in `event.data` -- any script on the page (or a
 * malicious/compromised subdomain) can post an arbitrary `message` event, and
 * without this check that content would land in the export as if it were the
 * real report. Matches the message to the right `<iframe>` element by
 * `event.source === frame.contentWindow`, which works even though the frame
 * is cross-origin -- `contentWindow` is exposed regardless of origin -- and
 * needs no shared identifier (turn id, frame id) between the two scripts.
 */
function handleDeepResearchFrameMessage(event: MessageEvent): void {
  if (!DEEP_RESEARCH_FRAME_ORIGIN_RE.test(event.origin)) {
    return;
  }
  if (!isDeepResearchFrameMessage(event.data)) {
    return;
  }

  const frames = document.querySelectorAll<HTMLIFrameElement>(
    CHATGPT_SELECTORS.custom.embeddedWidgetFrame
  );
  for (const frame of frames) {
    if (frame.contentWindow === event.source) {
      // The frame relays exactly one of the two (see DeepResearchFrameMessage)
      // -- HTML preferred when present, so the parser can route it through the
      // same structure-parsing path an ordinary message's HTML already takes.
      if (event.data.html) {
        frame.setAttribute(EMBEDDED_FRAME_REPORT_HTML_ATTR, event.data.html);
      } else if (event.data.text) {
        frame.setAttribute(EMBEDDED_FRAME_REPORT_ATTR, event.data.text);
      }
      return;
    }
  }
}

window.addEventListener('message', handleDeepResearchFrameMessage);

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
        const drift = contentScript.getDrift();
        sendResponse({
          success: true,
          // The popup only reads title/meta/pair text and never sends this
          // conversation back (export/print re-parse the page for their own
          // snapshot) -- htmlContent is the largest field per message and
          // pure dead weight across the messaging boundary here.
          data: conversation && {
            ...conversation,
            pairs: conversation.pairs.map((pair) => ({
              ...pair,
              question: { ...pair.question, htmlContent: undefined },
              answer: { ...pair.answer, htmlContent: undefined },
            })),
          },
          ...(drift && { drift }),
        });
      } else if (isGetDriftSkeletonMessage(message)) {
        // Built here and only here: the popup has no access to the page DOM,
        // and building it lazily means a user who never opens the report view
        // never has one in memory.
        const parser = detectParser();
        const container = parser
          ? document.querySelector(parser.selectors.conversationContainer)
          : null;
        // Falling back to <body> is deliberate: when canParse() is false, the
        // container selector is exactly what we know least about.
        const root = container ?? document.body;
        sendResponse({
          success: true,
          skeleton: buildSkeleton(root),
          origin: window.location.origin,
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
