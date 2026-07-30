/**
 * HTML Exporter
 * Generates standalone HTML with ChatGPT-like styling from structured conversation content
 */

import type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  Conversation,
  QAPair,
  StructuredContentBlock,
  StructuredConversation,
  StructuredQAPair,
  InlineContent,
  ListBlock,
  ListItem,
  TableBlock,
  Artifact,
  WebSearchResult,
} from '../types';
import { BaseExporter } from './base-exporter';
import { highlightCode, loadHighlighter, type Highlighter } from './code-highlight';
import { ConversationStructureService } from '../services';
import { getMessage, getUILanguage } from '../../shared/i18n';
import {
  CODE_TOKEN_COLOR,
  COLOR,
  FONT_FAMILY,
  FONT_SIZE_PT,
  HTML_FONT_SIZE_PT,
  PAGINATION,
  SPACING,
  bodyHeadingLevel,
  mmToPx,
  ptToPx,
  scaleFontSizes,
} from './style-tokens';

export class HtmlExporter extends BaseExporter {
  readonly format: ExportFormat = 'html';
  readonly extension = 'html';
  readonly mimeType = 'text/html';

  /**
   * The size tables for this export, already multiplied by the chosen step.
   * Set once per export (a fresh exporter is built per export), so no rule in
   * `generateCSS()` can be emitted at an unscaled size.
   */
  private sizes = scaleFontSizes(FONT_SIZE_PT);
  private htmlSizes = scaleFontSizes(HTML_FONT_SIZE_PT);

  /**
   * Loaded once per export in `export()`, so hljs joins the lazily-loaded
   * exporter chunk and the rest of the render stays synchronous. Null when it
   * could not be loaded — code then renders uncoloured rather than not at all.
   */
  private highlighter: Highlighter | null = null;

  /**
   * The document used to parse hljs output into tokens. `globalThis.document`
   * exists in the content script and under jsdom; guarded so a DOM-less runtime
   * degrades to plain code instead of throwing.
   */
  private get document(): Document | undefined {
    return typeof globalThis.document === 'undefined' ? undefined : globalThis.document;
  }

  async export(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      this.sizes = scaleFontSizes(FONT_SIZE_PT, options.fontScale);
      this.htmlSizes = scaleFontSizes(HTML_FONT_SIZE_PT, options.fontScale);
      this.highlighter = await loadHighlighter();

      // Convert to structured format (only the selected pairs)
      const structured = ConversationStructureService.toStructured({
        ...conversation,
        pairs: selectedPairs,
      });

      // Generate HTML
      const html = this.generateHTML(structured, options);

      return this.createSuccessResult(html, options.filename);
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Failed to export to HTML'
      );
    }
  }

  private generateHTML(conversation: StructuredConversation, options: ExportOptions): string {
    const title = this.escapeHtml(conversation.title);
    const platform = this.escapeHtml(this.formatPlatformName(conversation.platform));
    const model = conversation.model ? this.escapeHtml(conversation.model) : '';
    const date = this.formatTimestamp(conversation.createdAt);
    const dateRange = this.escapeHtml(this.formatDateRange(conversation.pairs));
    const url = this.escapeHtml(conversation.url);

    return `<!DOCTYPE html>
<html lang="${this.escapeHtml(getUILanguage())}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    ${this.generateCSS()}
    ${this.generateCodeTokenStyles()}
</head>
<body>
    <div class="container">
        <header class="header">
            <h1 class="title">${title}</h1>
            ${options.includeMetadata ? this.generateMetadata(platform, model, dateRange, date, url) : ''}
        </header>

        <main class="conversation">
            ${this.generatePairs(conversation.pairs, conversation.platform, options)}
        </main>

        <footer class="footer">
            <p>${getMessage('exportedWithChatExporter')}</p>
        </footer>
    </div>
</body>
</html>`;
  }

  private generateMetadata(
    platform: string,
    model: string,
    dateRange: string,
    date: string,
    url: string
  ): string {
    return `
            <div class="metadata">
                <div class="metadata-item">
                    <span class="metadata-label">${this.getMetadataLabel('platform')}:</span>
                    <span class="metadata-value">${platform}</span>
                </div>
                ${
                  model
                    ? `
                <div class="metadata-item">
                    <span class="metadata-label">${this.getMetadataLabel('model')}:</span>
                    <span class="metadata-value">${model}</span>
                </div>`
                    : ''
                }
                ${
                  dateRange
                    ? `
                <div class="metadata-item">
                    <span class="metadata-label">${this.getMetadataLabel('dateRange')}:</span>
                    <span class="metadata-value">${dateRange}</span>
                </div>`
                    : ''
                }
                <div class="metadata-item">
                    <span class="metadata-label">${this.getMetadataLabel('exported')}:</span>
                    <span class="metadata-value">${date}</span>
                </div>
                <div class="metadata-item">
                    <span class="metadata-label">${this.getMetadataLabel('url')}:</span>
                    <span class="metadata-value"><a href="${url}" target="_blank">${url}</a></span>
                </div>
            </div>`;
  }

  private generatePairs(
    pairs: StructuredQAPair[],
    platform: string,
    options: ExportOptions
  ): string {
    const assistantName = this.getRoleName('assistant', platform);
    const daySeparator = this.daySeparator(options.includeTimestamps);

    return pairs
      .map(
        (pair) => `${this.renderDaySeparator(daySeparator(pair.question.timestamp))}
            <div class="qa-pair">
                <div class="message user-message">
                    <div class="message-header">
                        <p class="message-role">${this.getRoleName('user')}</p>${this.renderTimestampSpan(pair.question.timestamp, options.includeTimestamps)}
                    </div>
                    <div class="message-content">
                        ${this.renderBlocks(pair.question.blocks)}
                    </div>
                </div>
                ${this.renderDaySeparator(daySeparator(pair.answer.timestamp))}
                <div class="message assistant-message" data-platform="${platform}">
                    <div class="message-header">
                        <p class="message-role">${assistantName}</p>${this.renderTimestampSpan(pair.answer.timestamp, options.includeTimestamps)}
                    </div>
                    <div class="message-content">
                        ${this.renderBlocks(pair.answer.blocks)}
                        ${this.renderArtifacts(pair.answer.metadata?.artifacts)}
                        ${this.renderWebSearches(pair.answer.metadata?.webSearches)}
                    </div>
                </div>
            </div>`
      )
      .join('\n');
  }

  private renderDaySeparator(separator: string): string {
    return separator ? `<div class="day-separator">${this.escapeHtml(separator)}</div>` : '';
  }

  private renderTimestampSpan(date: Date | undefined, includeTimestamps: boolean): string {
    const suffix = this.formatTimestampSuffix(date, includeTimestamps).trim();
    return suffix ? `<span class="message-timestamp">${this.escapeHtml(suffix)}</span>` : '';
  }

  private renderArtifacts(artifacts?: Artifact[]): string {
    if (!artifacts || !Array.isArray(artifacts)) {
      return '';
    }

    const artifactsWithContent = artifacts.filter((a) => a.content);
    if (artifactsWithContent.length === 0) {
      return '';
    }

    return `
                        <div class="artifacts-section">
                            <h3>Artifacts</h3>
                            ${artifactsWithContent
                              .map(
                                (artifact) => `
                            <div class="artifact">
                                <h4>${this.escapeHtml(artifact.title)}</h4>
                                ${artifact.typeLabel ? `<p class="artifact-type"><em>Type: ${this.escapeHtml(artifact.typeLabel)}</em></p>` : ''}
                                <pre><code class="language-${this.escapeHtml(artifact.language || '')}">${this.escapeHtml(artifact.content || '')}</code></pre>
                            </div>`
                              )
                              .join('\n')}
                        </div>`;
  }

  private renderWebSearches(webSearches?: WebSearchResult[]): string {
    if (!webSearches || !Array.isArray(webSearches) || webSearches.length === 0) {
      return '';
    }

    return `
                        <div class="web-searches-section">
                            <h3>Web Search Results</h3>
                            ${webSearches
                              .map(
                                (search) => `
                            <div class="web-search">
                                <h4>${this.escapeHtml(search.query || 'References')}</h4>
                                ${search.resultCount ? `<p class="search-count"><em>${search.resultCount} results found</em></p>` : ''}
                                ${
                                  search.results && search.results.length > 0
                                    ? `
                                <ul class="search-results">
                                    ${search.results
                                      .map(
                                        (result) => `
                                    <li class="search-result">
                                        <div class="result-content">
                                            <a href="${this.escapeHtml(result.url)}" target="_blank" rel="noopener noreferrer" class="result-title">${this.escapeHtml(result.title)}</a>
                                            ${result.domain ? `<span class="result-domain">${this.escapeHtml(result.domain)}</span>` : ''}
                                        </div>
                                    </li>`
                                      )
                                      .join('\n')}
                                </ul>`
                                    : ''
                                }
                            </div>`
                              )
                              .join('\n')}
                        </div>`;
  }

  private renderBlocks(blocks: StructuredContentBlock[]): string {
    return blocks
      .map((block) => {
        switch (block.type) {
          case 'paragraph': {
            const content = this.renderInline(block.content).trim();
            return content ? `<p>${content}</p>` : '';
          }

          case 'heading': {
            const level = bodyHeadingLevel(block.level); // h1 is the title, h2 the role label
            const headingContent = this.renderInline(block.content).trim();
            return headingContent ? `<h${level}>${headingContent}</h${level}>` : '';
          }

          case 'code': {
            const language = this.escapeHtml(block.language);
            return `<pre><code class="language-${language}">${this.renderCodeTokens(block.code, block.language)}</code></pre>`;
          }

          case 'list':
            return this.renderList(block);

          case 'blockquote':
            return `<blockquote>${this.renderBlocks(block.content)}</blockquote>`;

          case 'hr':
            return '<hr>';

          case 'image': {
            const alt = this.escapeHtml(block.alt || 'image');
            const imgUrl = this.escapeHtml(block.url);
            const imgTitle = block.title ? ` title="${this.escapeHtml(block.title)}"` : '';
            const imgWidth = block.width ? ` width="${block.width}"` : '';
            const imgHeight = block.height ? ` height="${block.height}"` : '';
            const img = `<img src="${imgUrl}" alt="${alt}"${imgTitle}${imgWidth}${imgHeight}>`;
            // A linked thumbnail/citation: HTML is the only format that can put
            // the image back inside its anchor, so this is where linkUrl is read.
            if (!block.linkUrl) return img;
            const href = this.escapeHtml(block.linkUrl);
            return `<a href="${href}" target="_blank" rel="noopener noreferrer">${img}</a>`;
          }

          // HTML is the only format that can actually play the clip. The inner
          // link doubles as the fallback for a browser that can't.
          case 'media': {
            const mediaUrl = this.escapeHtml(block.url);
            const mediaLabel = this.escapeHtml(this.mediaLabel(block));
            const mediaType = block.mimeType ? ` type="${this.escapeHtml(block.mimeType)}"` : '';
            const tag = block.kind === 'video' ? 'video' : 'audio';
            return `<${tag} controls src="${mediaUrl}"${mediaType}><a href="${mediaUrl}">${mediaLabel}</a></${tag}>`;
          }

          case 'table':
            return this.renderTable(block);

          default:
            return '';
        }
      })
      .filter(Boolean)
      .join('\n');
  }

  private renderInline(content: InlineContent[]): string {
    return content
      .map((item) => {
        const text = this.escapeHtml(item.text);

        switch (item.type) {
          case 'text':
            return text;

          case 'bold':
            return `<strong>${text}</strong>`;

          case 'italic':
            return `<em>${text}</em>`;

          case 'code':
            return `<code class="inline-code">${text}</code>`;

          case 'link': {
            const linkUrl = this.escapeHtml(item.url || '#');
            return `<a href="${linkUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
          }

          case 'strikethrough':
            return `<del>${text}</del>`;

          // lo-320b: the delimited LaTeX source, tagged so it is identifiable as
          // math rather than prose that happens to contain "$". Deliberately NOT
          // MathML or a KaTeX span: converting LaTeX to either needs a TeX parser,
          // and KaTeX's stylesheet + fonts would have to be inlined to keep the
          // export self-contained (no remote subresource, pinned since PR #54).
          // The class is the hook for a reader who wants to run KaTeX auto-render
          // over the saved file themselves.
          case 'math':
            return `<span class="math math-${item.display === 'block' ? 'display' : 'inline'}">${text}</span>`;

          default:
            return text;
        }
      })
      .join('');
  }

  private renderList(block: ListBlock): string {
    const tag = block.ordered ? 'ol' : 'ul';
    const items = block.items.map((item) => this.renderListItem(item)).join('\n');
    return `<${tag}>${items}</${tag}>`;
  }

  private renderListItem(item: ListItem): string {
    const content = this.renderInline(item.content);
    const nested = item.nested ? this.renderList(item.nested) : '';
    return `<li>${content}${nested}</li>`;
  }

  private renderTable(block: TableBlock): string {
    let html = '<table>';

    // Render headers
    if (block.headers && block.headers.length > 0) {
      html += '<thead><tr>';
      for (const header of block.headers) {
        html += `<th>${this.renderInline(header)}</th>`;
      }
      html += '</tr></thead>';
    }

    // Render rows
    if (block.rows && block.rows.length > 0) {
      html += '<tbody>';
      for (const row of block.rows) {
        html += '<tr>';
        for (const cell of row) {
          html += `<td>${this.renderInline(cell)}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody>';
    }

    html += '</table>';
    return html;
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (char) => map[char] || char);
  }

  private generateCSS(): string {
    return `
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: ${FONT_FAMILY.body.css};
            font-size: ${ptToPx(this.sizes.body)}px;
            line-height: 1.6;
            color: ${COLOR.textStrong};
            background-color: ${COLOR.surfaceSubtle};
        }

        .container {
            max-width: 900px;
            margin: 0 auto;
            padding: 2rem 1rem;
        }

        .header {
            background: white;
            border-radius: 0.75rem;
            padding: 2rem;
            margin-bottom: 2rem;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
        }

        .title {
            font-size: ${ptToPx(this.htmlSizes.title)}px;
            font-weight: 700;
            color: ${COLOR.textPrimary};
            margin-bottom: 1rem;
        }

        .metadata {
            display: grid;
            gap: 0.5rem;
            font-size: ${ptToPx(this.sizes.meta)}px;
            color: ${COLOR.textMuted};
        }

        .metadata-item {
            display: flex;
            gap: 0.5rem;
        }

        .metadata-label {
            font-weight: 600;
            min-width: 80px;
        }

        .metadata-value {
            color: ${COLOR.textBody};
        }

        .metadata-value a {
            color: ${COLOR.link};
            text-decoration: none;
        }

        .metadata-value a:hover {
            text-decoration: underline;
        }

        .conversation {
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }

        .qa-pair {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .message {
            border-radius: 0.75rem;
            padding: 1.5rem;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
        }

        /*
         * The fill marks who is ASKING (R-6). It used to sit on the assistant,
         * so the background tracked who was *answering* — the reverse of what a
         * reader needs when skimming for their own questions.
         */
        .user-message {
            background: ${COLOR.surfaceTurn};
            border-left: 4px solid ${COLOR.link};
        }

        .assistant-message {
            background: transparent;
            border-left: 4px solid ${COLOR.brand.default};
        }

        .assistant-message[data-platform="chatgpt"] {
            border-left-color: ${COLOR.brand.chatgpt};
        }

        .assistant-message[data-platform="claude"] {
            border-left-color: ${COLOR.brand.claude};
        }

        .assistant-message[data-platform="gemini"] {
            border-left-color: ${COLOR.brand.gemini};
        }

        .message-header {
            margin-bottom: 1rem;
        }

        .message-role {
            display: inline-block;
            margin: 0;
            font-weight: 600;
            font-size: ${ptToPx(this.htmlSizes.roleLabel)}px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            /*
             * The brand rule (R-6) — the one place the platform's colour appears
             * in the body. currentColor picks up whichever brandTextOnLight the
             * role rules below set, so the rule can never drift from its label.
             */
            border-bottom: 2px solid currentColor;
            padding-bottom: 1px;
        }

        .user-message .message-role {
            color: ${COLOR.link};
        }

        .assistant-message .message-role {
            color: ${COLOR.brandTextOnLight.default};
        }

        .assistant-message[data-platform="chatgpt"] .message-role {
            color: ${COLOR.brandTextOnLight.chatgpt};
        }

        .assistant-message[data-platform="claude"] .message-role {
            color: ${COLOR.brandTextOnLight.claude};
        }

        .assistant-message[data-platform="gemini"] .message-role {
            color: ${COLOR.brandTextOnLight.gemini};
        }

        .day-separator {
            margin: 1.5rem 0;
            text-align: center;
            font-size: ${ptToPx(this.sizes.meta)}px;
            color: ${COLOR.textMuted};
        }

        .message-timestamp {
            margin-left: 0.5rem;
            font-size: ${ptToPx(this.htmlSizes.timestamp)}px;
            font-weight: 400;
            text-transform: none;
            letter-spacing: normal;
            color: ${COLOR.textFaint};
        }

        .message-content > *:first-child {
            margin-top: 0;
        }

        .message-content > *:last-child {
            margin-bottom: 0;
        }

        .message-content p {
            margin: 0.75rem 0;
        }

        .message-content h1,
        .message-content h2,
        .message-content h3,
        .message-content h4,
        .message-content h5,
        .message-content h6 {
            margin: 1.5rem 0 0.75rem 0;
            font-weight: 600;
            line-height: 1.3;
        }

        .message-content h1 { font-size: ${ptToPx(this.htmlSizes.headingByLevel[0])}px; }
        .message-content h2 { font-size: ${ptToPx(this.htmlSizes.headingByLevel[1])}px; }
        .message-content h3 { font-size: ${ptToPx(this.htmlSizes.headingByLevel[2])}px; }
        .message-content h4 { font-size: ${ptToPx(this.htmlSizes.headingByLevel[3])}px; }
        .message-content h5 { font-size: ${ptToPx(this.htmlSizes.headingByLevel[4])}px; }
        .message-content h6 { font-size: ${ptToPx(this.htmlSizes.headingByLevel[5])}px; }

        /*
         * A LIGHT code block (R-8). It was dark (#242A2C) with light text — a
         * dark slab dropped into an otherwise light document, and inherited from
         * the GitHub-Dark theme that shipped with the old client-side
         * highlighter. The five token colours are dark by design, so on the dark
         * block they measured 2.1-2.5:1 against it: worse than no highlighting.
         */
        .message-content pre {
            background: ${COLOR.surfaceMuted};
            color: ${COLOR.textBody};
            border-radius: 0.5rem;
            padding: 1rem;
            overflow-x: auto;
            margin: 1rem 0;
            font-size: ${ptToPx(this.sizes.code)}px;
            line-height: 1.5;
        }

        .message-content code {
            font-family: ${FONT_FAMILY.code.css};
        }

        .message-content .inline-code {
            background: rgba(0, 0, 0, 0.05);
            padding: 0.125rem 0.25rem;
            border-radius: 0.25rem;
            font-size: 0.875em;
        }

        .assistant-message .inline-code {
            background: rgba(0, 0, 0, 0.08);
        }

        /* Untypeset LaTeX source — see renderInline's 'math' case. Styled to
           read as a formula rather than prose; display math gets its own line. */
        .message-content .math {
            font-family: ${FONT_FAMILY.code.css};
        }

        .message-content .math-display {
            display: block;
            text-align: center;
            margin: 1rem 0;
        }

        .message-content ul,
        .message-content ol {
            margin: 0.75rem 0;
            padding-left: ${mmToPx(SPACING.listIndentStepMm)}px;
        }

        .message-content li {
            margin: 0.25rem 0;
        }

        .message-content li > ul,
        .message-content li > ol {
            margin: 0.5rem 0;
        }

        .message-content blockquote {
            border-left: 4px solid ${COLOR.blockquoteBorder};
            padding-left: 1rem;
            margin: 1rem 0;
            color: ${COLOR.textMutedOnSurfaceMuted};
            font-style: italic;
        }

        .message-content hr {
            border: none;
            border-top: 1px solid ${COLOR.border};
            margin: 1.5rem 0;
        }

        .message-content img {
            max-width: 200px;
            height: auto;
            border-radius: 0.5rem;
            margin: 1rem 0;
        }

        .message-content a {
            color: ${COLOR.link};
            text-decoration: none;
        }

        .message-content a:hover {
            text-decoration: underline;
        }

        /*
         * Horizontal rules only (R-6). A full grid and an alternating row fill
         * both competed with the turn fill; a table reads fine with one rule per
         * row and nothing else.
         */
        .message-content table {
            border-collapse: collapse;
            width: 100%;
            margin: 1rem 0;
        }

        .message-content th,
        .message-content td {
            border-bottom: 1px solid ${COLOR.border};
            padding: 0.5rem 0.75rem;
            text-align: left;
        }

        .message-content th {
            border-bottom: 1.5px solid ${COLOR.textMuted};
            font-weight: 600;
        }

        .message-content strong {
            font-weight: 600;
        }

        .message-content em {
            font-style: italic;
        }

        .message-content del {
            text-decoration: line-through;
            opacity: 0.7;
        }

        .artifacts-section {
            margin-top: 1.5rem;
            padding-top: 1.5rem;
            border-top: 2px solid ${COLOR.border};
        }

        .artifacts-section h3 {
            font-size: ${ptToPx(this.htmlSizes.headingByLevel[3])}px;
            font-weight: 600;
            margin-bottom: 1rem;
            color: ${COLOR.textBody};
        }

        .artifact {
            margin-bottom: 1.5rem;
            background: white;
            border: 1px solid ${COLOR.border};
            border-radius: 0.5rem;
            padding: 1rem;
        }

        .user-message .artifact {
            background: ${COLOR.surfaceSubtle};
        }

        .artifact h4 {
            font-size: ${ptToPx(this.htmlSizes.headingByLevel[4])}px;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: ${COLOR.textPrimary};
        }

        .artifact-type {
            font-size: ${ptToPx(this.sizes.meta)}px;
            color: ${COLOR.textMuted};
            margin-bottom: 0.75rem;
        }

        .artifact pre {
            margin: 0;
        }

        .web-searches-section {
            margin-top: 1.5rem;
            padding-top: 1.5rem;
            border-top: 2px solid ${COLOR.border};
        }

        .web-searches-section h3 {
            font-size: ${ptToPx(this.htmlSizes.headingByLevel[3])}px;
            font-weight: 600;
            margin-bottom: 1rem;
            color: ${COLOR.textBody};
        }

        .web-search {
            margin-bottom: 1.5rem;
        }

        .web-search h4 {
            font-size: ${ptToPx(this.htmlSizes.headingByLevel[4])}px;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: ${COLOR.textPrimary};
        }

        .search-count {
            font-size: ${ptToPx(this.sizes.meta)}px;
            color: ${COLOR.textMutedOnSurfaceMuted};
            margin-bottom: 0.75rem;
        }

        .search-results {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        .search-result {
            display: flex;
            align-items: flex-start;
            gap: 0.75rem;
            padding: 0.75rem;
            margin-bottom: 0.5rem;
            background: white;
            border: 1px solid ${COLOR.border};
            border-radius: 0.375rem;
            transition: background-color 0.2s;
        }

        .user-message .search-result {
            background: ${COLOR.surfaceSubtle};
        }

        .search-result:hover {
            background: ${COLOR.surfaceSubtle};
        }

        .user-message .search-result:hover {
            background: ${COLOR.surfaceMuted};
        }

        .result-content {
            flex: 1;
            min-width: 0;
        }

        .result-title {
            display: block;
            font-weight: 500;
            color: ${COLOR.link};
            text-decoration: none;
            word-break: break-word;
        }

        .result-title:hover {
            text-decoration: underline;
        }

        .result-domain {
            display: block;
            font-size: ${ptToPx(this.sizes.meta)}px;
            color: ${COLOR.textMuted};
            margin-top: 0.25rem;
        }

        .footer {
            margin-top: 3rem;
            padding: 1.5rem;
            text-align: center;
            font-size: ${ptToPx(this.sizes.meta)}px;
            color: ${COLOR.textMuted};
        }

        @media (max-width: 640px) {
            .container {
                padding: 1rem 0.5rem;
            }

            .header {
                padding: 1.5rem;
                border-radius: 0.5rem;
            }

            .title {
                font-size: 1.5rem;
            }

            .message {
                padding: 1rem;
                border-radius: 0.5rem;
            }

            .message-content pre {
                padding: 0.75rem;
                font-size: 0.8125rem;
            }
        }

        /*
         * Dark mode for the exported document.
         *
         * Scoped to \`screen\` on purpose. An export is a document as much as a
         * page: it gets printed and archived, and a paper copy is always white.
         * Without the media type, a reader on a dark OS would print light-grey
         * ink onto white paper — so the dark palette is screen-only and print
         * (and print-to-PDF) keeps the light one, no override needed below.
         *
         * The hexes are literal rather than \`COLOR\` tokens because style-tokens.ts
         * is the palette shared with the pdf and docx exporters, which have no
         * dark surface at all — a dark table there would be dead weight for two
         * of its three consumers. They are GitHub-Dark neutrals, matching the
         * syntax theme already inlined below (which needs no override: it is a
         * dark code block in both modes). Every pair here is held to WCAG AA by
         * tests/unit/accessibility/contrast.test.ts, same as the light palette.
         */
        @media screen and (prefers-color-scheme: dark) {
            body {
                color: #c9d1d9;
                background-color: #0d1117;
            }

            .header {
                background: #161b22;
            }

            .title {
                color: #e6edf3;
            }

            .metadata {
                color: #9198a1;
            }

            .metadata-value {
                color: #c9d1d9;
            }

            .metadata-value a {
                color: #58a6ff;
            }

            /*
             * Same inversion as light mode (R-6): the fill marks who is asking.
             * Dark mode previously tinted BOTH messages, which meant it carried
             * no who-is-asking signal at all.
             */
            .user-message {
                background: #1c2128;
                border-left-color: #58a6ff;
            }

            .assistant-message {
                background: transparent;
                border-left-color: #8b949e;
            }

            .user-message .message-role {
                color: #58a6ff;
            }

            .assistant-message .message-role {
                color: #9198a1;
            }

            .assistant-message[data-platform="chatgpt"] .message-role {
                color: #3fb9a0;
            }

            .assistant-message[data-platform="claude"] .message-role {
                color: #e08a63;
            }

            .assistant-message[data-platform="gemini"] .message-role {
                color: #79aaff;
            }

            .day-separator {
                color: #9198a1;
            }

            .message-timestamp {
                color: #7d8590;
            }

            /* The light rule tints with black, which is invisible on a dark card. */
            .message-content .inline-code {
                background: rgba(255, 255, 255, 0.08);
            }

            .assistant-message .inline-code {
                background: rgba(255, 255, 255, 0.11);
            }

            .message-content blockquote {
                color: #a2abb6;
                border-left-color: #4b535d;
            }

            .message-content hr {
                border-top-color: #30363d;
            }

            .message-content a {
                color: #58a6ff;
            }

            /*
             * Dark mode keeps step with R-6's light table: horizontal rules
             * only, no th fill and no alternating row fill. Overriding just the
             * colours here would have left the dark table with a grid and
             * stripes the light one no longer has.
             */
            .message-content th,
            .message-content td {
                border-bottom-color: #30363d;
            }

            .message-content th {
                border-bottom-color: #8b949e;
            }

            .artifacts-section {
                border-top-color: #30363d;
            }

            .artifacts-section h3 {
                color: #c9d1d9;
            }

            .web-searches-section {
                border-top-color: #30363d;
            }

            .web-searches-section h3 {
                color: #c9d1d9;
            }

            .artifact {
                background: #161b22;
                border-color: #30363d;
            }

            .user-message .artifact {
                background: #1c2128;
            }

            .artifact h4 {
                color: #e6edf3;
            }

            .artifact-type {
                color: #9198a1;
            }

            .web-search h4 {
                color: #e6edf3;
            }

            .search-count {
                color: #a2abb6;
            }

            .search-result {
                background: #161b22;
                border-color: #30363d;
            }

            .user-message .search-result {
                background: #1c2128;
            }

            .search-result:hover {
                background: #1c2128;
            }

            .user-message .search-result:hover {
                background: #22282f;
            }

            .result-title {
                color: #58a6ff;
            }

            .result-domain {
                color: #9198a1;
            }

            .footer {
                color: #9198a1;
            }
        }

        @media print {
            body {
                background: white;
            }

            .container {
                max-width: 100%;
            }

            .header {
                page-break-after: avoid;
                break-after: avoid;
                page-break-inside: avoid;
                break-inside: avoid;
            }

            .header,
            .message {
                box-shadow: none;
            }

            .qa-pair {
                page-break-inside: avoid;
                break-inside: avoid;
                page-break-before: auto;
                page-break-after: avoid;
            }

            .message {
                page-break-inside: avoid;
                break-inside: avoid;
                page-break-before: avoid;
                page-break-after: avoid;
            }

            .user-message {
                page-break-inside: avoid;
                break-inside: avoid;
                page-break-before: avoid;
                page-break-after: avoid;
            }

            .assistant-message {
                page-break-inside: avoid;
                break-inside: avoid;
                page-break-before: avoid;
                page-break-after: auto;
            }

            /* Prevent code blocks from breaking across pages */
            .message-content pre {
                page-break-inside: avoid;
                break-inside: avoid;
                overflow: hidden;
            }

            /* Prevent other block elements from breaking awkwardly */
            .message-content blockquote,
            .message-content table,
            .message-content ul,
            .message-content ol {
                page-break-inside: avoid;
                break-inside: avoid;
            }

            /* A paragraph that does straddle a page leaves/carries whole lines,
               never a single stranded one. */
            .message-content p,
            .message-content li,
            .message-content blockquote {
                orphans: ${PAGINATION.orphans};
                widows: ${PAGINATION.widows};
            }

            /* A heading stays with the content it introduces. */
            .message-content h1,
            .message-content h2,
            .message-content h3,
            .message-content h4,
            .message-content h5,
            .message-content h6 {
                page-break-after: avoid;
                break-after: avoid;
                page-break-inside: avoid;
                break-inside: avoid;
            }

            /* A table row is never split down the middle; a header repeats. */
            .message-content tr {
                page-break-inside: avoid;
                break-inside: avoid;
            }

            .message-content thead {
                display: table-header-group;
            }

            .footer {
                display: none;
            }
        }
    </style>`;
  }

  /**
   * The five-token code palette (R-8).
   *
   * This replaced ~60 lines of hand-rolled regex highlighting that shipped as an
   * inline <script> in every exported file. Three problems with that: it needed
   * JavaScript to run before code was coloured, it carried a GitHub Dark theme
   * unrelated to the document's own palette, and re-implementing a tokenizer in
   * a regex is a losing game. Highlighting happens at export time now, so the
   * markup is already coloured and the file is static.
   */
  /**
   * Highlighted code as escaped markup with five token classes.
   *
   * Every token's text is escaped exactly as before — the classes are the only
   * thing added, so a snippet containing `<script>` still displays as text.
   */
  private renderCodeTokens(code: string, language: string | undefined): string {
    return highlightCode(code, language, this.highlighter, this.document)
      .map((token) =>
        token.cls
          ? `<span class="tok-${token.cls}">${this.escapeHtml(token.text)}</span>`
          : this.escapeHtml(token.text)
      )
      .join('');
  }

  private generateCodeTokenStyles(): string {
    return `
    <style>
      .tok-keyword  { color: ${CODE_TOKEN_COLOR.keyword}; }
      .tok-function { color: ${CODE_TOKEN_COLOR.function}; }
      .tok-string   { color: ${CODE_TOKEN_COLOR.string}; }
      .tok-number   { color: ${CODE_TOKEN_COLOR.number}; }
      .tok-comment  { color: ${CODE_TOKEN_COLOR.comment}; font-style: italic; }
    </style>`;
  }
}
