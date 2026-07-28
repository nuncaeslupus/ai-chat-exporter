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
  InlineContent,
  ListBlock,
  ListItem,
  TableBlock,
} from '../types';
import { BaseExporter } from './base-exporter';
import { ConversationStructureService } from '../services';
import { getMessage, getUILanguage } from '../../shared/i18n';

export class HtmlExporter extends BaseExporter {
  readonly format: ExportFormat = 'html';
  readonly extension = 'html';
  readonly mimeType = 'text/html';

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

      // Generate HTML
      const html = this.generateHTML(structured, options);

      return this.createSuccessResult(html, options.filename);
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Failed to export to HTML'
      );
    }
  }

  private generateHTML(conversation: any, options: ExportOptions): string {
    const title = this.escapeHtml(conversation.title);
    const platform = this.escapeHtml(this.formatPlatformName(conversation.platform));
    const model = conversation.model ? this.escapeHtml(conversation.model) : '';
    const date = this.formatTimestamp(conversation.createdAt);
    const url = this.escapeHtml(conversation.url);

    return `<!DOCTYPE html>
<html lang="${this.escapeHtml(getUILanguage())}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    ${this.generateCSS()}
    ${this.generateSyntaxHighlightingScript()}
</head>
<body>
    <div class="container">
        <header class="header">
            <h1 class="title">${title}</h1>
            ${options.includeMetadata ? this.generateMetadata(platform, model, date, url) : ''}
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

  private generateMetadata(platform: string, model: string, date: string, url: string): string {
    return `
            <div class="metadata">
                <div class="metadata-item">
                    <span class="metadata-label">${this.getMetadataLabel('platform')}:</span>
                    <span class="metadata-value">${platform}</span>
                </div>
                ${model ? `
                <div class="metadata-item">
                    <span class="metadata-label">${this.getMetadataLabel('model')}:</span>
                    <span class="metadata-value">${model}</span>
                </div>` : ''}
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

  private generatePairs(pairs: any[], platform: string, options: ExportOptions): string {
    const assistantName = this.getRoleName('assistant', platform);

    return pairs.map(pair => `
            <div class="qa-pair">
                <div class="message user-message">
                    <div class="message-header">
                        <span class="message-role">${this.getRoleName('user')}</span>${this.renderTimestampSpan(pair.question.timestamp, options.includeTimestamps)}
                    </div>
                    <div class="message-content">
                        ${this.renderBlocks(pair.question.blocks)}
                    </div>
                </div>

                <div class="message assistant-message" data-platform="${platform}">
                    <div class="message-header">
                        <span class="message-role">${assistantName}</span>${this.renderTimestampSpan(pair.answer.timestamp, options.includeTimestamps)}
                    </div>
                    <div class="message-content">
                        ${this.renderBlocks(pair.answer.blocks)}
                        ${this.renderArtifacts(pair.answer.metadata?.artifacts)}
                        ${this.renderWebSearches(pair.answer.metadata?.webSearches)}
                    </div>
                </div>
            </div>`).join('\n');
  }

  private renderTimestampSpan(date: Date | undefined, includeTimestamps: boolean): string {
    const suffix = this.formatTimestampSuffix(date, includeTimestamps).trim();
    return suffix ? `<span class="message-timestamp">${this.escapeHtml(suffix)}</span>` : '';
  }

  private renderArtifacts(artifacts?: any[]): string {
    if (!artifacts || !Array.isArray(artifacts)) {
      return '';
    }

    const artifactsWithContent = artifacts.filter(a => a.content);
    if (artifactsWithContent.length === 0) {
      return '';
    }

    return `
                        <div class="artifacts-section">
                            <h3>Artifacts</h3>
                            ${artifactsWithContent.map(artifact => `
                            <div class="artifact">
                                <h4>${this.escapeHtml(artifact.title)}</h4>
                                ${artifact.typeLabel ? `<p class="artifact-type"><em>Type: ${this.escapeHtml(artifact.typeLabel)}</em></p>` : ''}
                                <pre><code class="language-${this.escapeHtml(artifact.language || '')}">${this.escapeHtml(artifact.content || '')}</code></pre>
                            </div>`).join('\n')}
                        </div>`;
  }

  private renderWebSearches(webSearches?: any[]): string {
    if (!webSearches || !Array.isArray(webSearches) || webSearches.length === 0) {
      return '';
    }

    return `
                        <div class="web-searches-section">
                            <h3>Web Search Results</h3>
                            ${webSearches.map(search => `
                            <div class="web-search">
                                <h4>${this.escapeHtml(search.query || 'References')}</h4>
                                ${search.resultCount ? `<p class="search-count"><em>${search.resultCount} results found</em></p>` : ''}
                                ${search.results && search.results.length > 0 ? `
                                <ul class="search-results">
                                    ${search.results.map((result: any) => `
                                    <li class="search-result">
                                        <div class="result-content">
                                            <a href="${this.escapeHtml(result.url)}" target="_blank" rel="noopener noreferrer" class="result-title">${this.escapeHtml(result.title)}</a>
                                            ${result.domain ? `<span class="result-domain">${this.escapeHtml(result.domain)}</span>` : ''}
                                        </div>
                                    </li>`).join('\n')}
                                </ul>` : ''}
                            </div>`).join('\n')}
                        </div>`;
  }

  private renderBlocks(blocks: StructuredContentBlock[]): string {
    return blocks.map(block => {
      switch (block.type) {
        case 'paragraph':
          const content = this.renderInline(block.content).trim();
          return content ? `<p>${content}</p>` : '';

        case 'heading':
          const level = Math.min(block.level + 2, 6); // Shift down since title is h1
          const headingContent = this.renderInline(block.content).trim();
          return headingContent ? `<h${level}>${headingContent}</h${level}>` : '';

        case 'code':
          const language = this.escapeHtml(block.language);
          const code = this.escapeHtml(block.code);
          return `<pre><code class="language-${language}">${code}</code></pre>`;

        case 'list':
          return this.renderList(block);

        case 'blockquote':
          return `<blockquote>${this.renderBlocks(block.content)}</blockquote>`;

        case 'hr':
          return '<hr>';

        case 'image':
          const alt = this.escapeHtml(block.alt || 'image');
          const imgUrl = this.escapeHtml(block.url);
          const imgTitle = block.title ? ` title="${this.escapeHtml(block.title)}"` : '';
          const imgWidth = block.width ? ` width="${block.width}"` : '';
          const imgHeight = block.height ? ` height="${block.height}"` : '';
          return `<img src="${imgUrl}" alt="${alt}"${imgTitle}${imgWidth}${imgHeight}>`;

        case 'table':
          return this.renderTable(block);

        default:
          return '';
      }
    }).filter(Boolean).join('\n');
  }

  private renderInline(content: InlineContent[]): string {
    return content.map(item => {
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

        case 'link':
          const linkUrl = this.escapeHtml(item.url || '#');
          return `<a href="${linkUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;

        case 'strikethrough':
          return `<del>${text}</del>`;

        default:
          return text;
      }
    }).join('');
  }

  private renderList(block: ListBlock): string {
    const tag = block.ordered ? 'ol' : 'ul';
    const items = block.items.map(item => this.renderListItem(item)).join('\n');
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
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, char => map[char] || char);
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
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
                'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
            line-height: 1.6;
            color: #1f2937;
            background-color: #f9fafb;
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
            font-size: 2rem;
            font-weight: 700;
            color: #111827;
            margin-bottom: 1rem;
        }

        .metadata {
            display: grid;
            gap: 0.5rem;
            font-size: 0.875rem;
            color: #6b7280;
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
            color: #374151;
        }

        .metadata-value a {
            color: #2563eb;
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

        .user-message {
            background: white;
            border-left: 4px solid #2563eb;
        }

        .assistant-message {
            background: #f3f4f6;
            border-left: 4px solid #6b7280;
        }

        .assistant-message[data-platform="chatgpt"] {
            border-left-color: #10a37f;
        }

        .assistant-message[data-platform="claude"] {
            border-left-color: #cc7b58;
        }

        .assistant-message[data-platform="gemini"] {
            border-left-color: #4285f4;
        }

        .message-header {
            margin-bottom: 1rem;
        }

        .message-role {
            font-weight: 600;
            font-size: 0.875rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .user-message .message-role {
            color: #2563eb;
        }

        .assistant-message .message-role {
            color: #686f7d;
        }

        .assistant-message[data-platform="chatgpt"] .message-role {
            color: #0c7e62;
        }

        .assistant-message[data-platform="claude"] .message-role {
            color: #ab5834;
        }

        .assistant-message[data-platform="gemini"] .message-role {
            color: #1165f1;
        }

        .message-timestamp {
            margin-left: 0.5rem;
            font-size: 0.8125rem;
            font-weight: 400;
            text-transform: none;
            letter-spacing: normal;
            color: #9ca3af;
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

        .message-content h1 { font-size: 1.875rem; }
        .message-content h2 { font-size: 1.5rem; }
        .message-content h3 { font-size: 1.25rem; }
        .message-content h4 { font-size: 1.125rem; }
        .message-content h5 { font-size: 1rem; }
        .message-content h6 { font-size: 0.875rem; }

        .message-content pre {
            background: #1f2937;
            color: #f3f4f6;
            border-radius: 0.5rem;
            padding: 1rem;
            overflow-x: auto;
            margin: 1rem 0;
            font-size: 0.875rem;
            line-height: 1.5;
        }

        .message-content code {
            font-family: 'Courier New', Courier, monospace;
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

        .message-content ul,
        .message-content ol {
            margin: 0.75rem 0;
            padding-left: 2rem;
        }

        .message-content li {
            margin: 0.25rem 0;
        }

        .message-content li > ul,
        .message-content li > ol {
            margin: 0.5rem 0;
        }

        .message-content blockquote {
            border-left: 4px solid #d1d5db;
            padding-left: 1rem;
            margin: 1rem 0;
            color: #686f7d;
            font-style: italic;
        }

        .message-content hr {
            border: none;
            border-top: 1px solid #e5e7eb;
            margin: 1.5rem 0;
        }

        .message-content img {
            max-width: 200px;
            height: auto;
            border-radius: 0.5rem;
            margin: 1rem 0;
        }

        .message-content a {
            color: #2563eb;
            text-decoration: none;
        }

        .message-content a:hover {
            text-decoration: underline;
        }

        .message-content table {
            border-collapse: collapse;
            width: 100%;
            margin: 1rem 0;
            border: 1px solid #e5e7eb;
        }

        .message-content th,
        .message-content td {
            border: 1px solid #e5e7eb;
            padding: 0.5rem 0.75rem;
            text-align: left;
        }

        .message-content th {
            background: #f9fafb;
            font-weight: 600;
        }

        .message-content tr:nth-child(even) {
            background: #fafbfc;
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
            border-top: 2px solid #e5e7eb;
        }

        .artifacts-section h3 {
            font-size: 1.125rem;
            font-weight: 600;
            margin-bottom: 1rem;
            color: #374151;
        }

        .artifact {
            margin-bottom: 1.5rem;
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 0.5rem;
            padding: 1rem;
        }

        .user-message .artifact {
            background: #f9fafb;
        }

        .artifact h4 {
            font-size: 1rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: #111827;
        }

        .artifact-type {
            font-size: 0.875rem;
            color: #6b7280;
            margin-bottom: 0.75rem;
        }

        .artifact pre {
            margin: 0;
        }

        .web-searches-section {
            margin-top: 1.5rem;
            padding-top: 1.5rem;
            border-top: 2px solid #e5e7eb;
        }

        .web-searches-section h3 {
            font-size: 1.125rem;
            font-weight: 600;
            margin-bottom: 1rem;
            color: #374151;
        }

        .web-search {
            margin-bottom: 1.5rem;
        }

        .web-search h4 {
            font-size: 1rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: #111827;
        }

        .search-count {
            font-size: 0.875rem;
            color: #686f7d;
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
            border: 1px solid #e5e7eb;
            border-radius: 0.375rem;
            transition: background-color 0.2s;
        }

        .user-message .search-result {
            background: #f9fafb;
        }

        .search-result:hover {
            background: #f9fafb;
        }

        .user-message .search-result:hover {
            background: #f3f4f6;
        }

        .result-content {
            flex: 1;
            min-width: 0;
        }

        .result-title {
            display: block;
            font-weight: 500;
            color: #2563eb;
            text-decoration: none;
            word-break: break-word;
        }

        .result-title:hover {
            text-decoration: underline;
        }

        .result-domain {
            display: block;
            font-size: 0.75rem;
            color: #6b7280;
            margin-top: 0.25rem;
        }

        .footer {
            margin-top: 3rem;
            padding: 1.5rem;
            text-align: center;
            font-size: 0.875rem;
            color: #6a7383;
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

            .footer {
                display: none;
            }
        }
    </style>`;
  }

  private generateSyntaxHighlightingScript(): string {
    // Inline highlight.js to avoid CDN references (required for Chrome Web Store)
    // Using a minimal inline implementation for code highlighting
    return `
    <style>
      /* GitHub Dark theme for code highlighting */
      pre code.hljs {
        display: block;
        overflow-x: auto;
        padding: 1em;
        background: #0d1117;
        color: #c9d1d9;
      }
      .hljs-comment { color: #8b949e; }
      .hljs-keyword, .hljs-selector-tag, .hljs-subst { color: #ff7b72; }
      .hljs-string, .hljs-doctag { color: #a5d6ff; }
      .hljs-number, .hljs-literal { color: #79c0ff; }
      .hljs-function, .hljs-title { color: #d2a8ff; }
      .hljs-params { color: #c9d1d9; }
      .hljs-built_in { color: #ffa657; }
      .hljs-class .hljs-title { color: #f0883e; }
      .hljs-attribute { color: #79c0ff; }
      .hljs-variable, .hljs-template-variable { color: #c9d1d9; }
      .hljs-type { color: #ffa657; }
      .hljs-selector-class { color: #d2a8ff; }
      .hljs-selector-id { color: #79c0ff; }
      .hljs-quote { color: #8b949e; font-style: italic; }
      .hljs-meta { color: #8b949e; }
      .hljs-deletion { background: #ffeef0; }
      .hljs-addition { background: #e6ffec; }
      .hljs-emphasis { font-style: italic; }
      .hljs-strong { font-weight: bold; }
    </style>
    <script>
        // Minimal syntax highlighting implementation
        document.addEventListener('DOMContentLoaded', () => {
            // Simple highlighting for common patterns
            document.querySelectorAll('pre code').forEach((block) => {
                let html = block.textContent;
                if (!html) return;

                // Re-escape before re-injecting as innerHTML: textContent decoded
                // any entities the exporter escaped (e.g. code samples containing
                // "<script>" or "<img onerror=...>" as literal text), so without
                // this the markup below would execute instead of display as text.
                html = html
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');

                // Basic syntax patterns - covers most common cases
                html = html
                    // Keywords
                    .replace(/\\b(function|const|let|var|if|else|for|while|return|class|import|export|from|async|await|try|catch|throw|new|this|typeof|instanceof)\\b/g,
                        '<span class="hljs-keyword">$1</span>')
                    // Strings
                    .replace(/("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)/g,
                        '<span class="hljs-string">$1</span>')
                    // Numbers
                    .replace(/\\b(\\d+\\.?\\d*)\\b/g,
                        '<span class="hljs-number">$1</span>')
                    // Comments (single-line)
                    .replace(/(\\/{2,}.*$)/gm,
                        '<span class="hljs-comment">$1</span>')
                    // Comments (multi-line)
                    .replace(/(\\/\\*[\\s\\S]*?\\*\\/)/g,
                        '<span class="hljs-comment">$1</span>');

                block.innerHTML = html;
                block.classList.add('hljs');
            });
        });
    </script>`;
  }

}
