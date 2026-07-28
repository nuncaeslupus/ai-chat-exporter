/**
 * Structured Markdown Exporter
 * Generates clean markdown from structured conversation content
 */

import type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  Conversation,
  QAPair,
  StructuredContentBlock,
  StructuredConversation,
  InlineContent,
  ListBlock,
  TableBlock,
} from '../types';
import { BaseExporter } from './base-exporter';
import { ConversationStructureService } from '../services';
import { getMessage } from '../../shared/i18n';
import { DOC_HEADING_LEVEL, bodyHeadingLevel } from './style-tokens';

export class StructuredMarkdownExporter extends BaseExporter {
  readonly format: ExportFormat = 'md';
  readonly extension = 'md';
  readonly mimeType = 'text/markdown';

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

      // Generate markdown
      const markdown = this.generateMarkdown(structured, options);

      return this.createSuccessResult(markdown, options.filename);
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Failed to export to Markdown'
      );
    }
  }

  private generateMarkdown(conversation: StructuredConversation, options: ExportOptions): string {
    const lines: string[] = [];
    const roleHashes = '#'.repeat(DOC_HEADING_LEVEL.roleLabel);

    // Title
    lines.push(`${'#'.repeat(DOC_HEADING_LEVEL.title)} ${conversation.title}`);
    lines.push('');

    // Metadata as a table
    if (options.includeMetadata) {
      lines.push(`| **${getMessage('metadataTableHeaderField')}** | **${getMessage('metadataTableHeaderValue')}** |`);
      lines.push('|---|---|');
      lines.push(`| ${this.getMetadataLabel('platform')} | ${this.formatPlatformName(conversation.platform)} |`);
      if (conversation.model) {
        lines.push(`| ${this.getMetadataLabel('model')} | ${conversation.model} |`);
      }
      lines.push(`| ${this.getMetadataLabel('exported')} | ${this.formatTimestamp(conversation.createdAt)} |`);
      lines.push(`| ${this.getMetadataLabel('url')} | ${conversation.url} |`);
      lines.push('');
    }

    // Horizontal rule before conversation
    lines.push('---');
    lines.push('');

    // Q&A pairs
    for (const [i, pair] of conversation.pairs.entries()) {
      // User question
      lines.push(`${roleHashes} 👤 ${this.getRoleName('user')}${this.formatTimestampSuffix(pair.question.timestamp, options.includeTimestamps)}`);
      lines.push('');
      lines.push(...this.renderBlocks(pair.question.blocks));

      // Assistant answer
      lines.push(`${roleHashes} 🤖 ${this.getRoleName('assistant', conversation.platform)}${this.formatTimestampSuffix(pair.answer.timestamp, options.includeTimestamps)}`);
      lines.push('');
      lines.push(...this.renderBlocks(pair.answer.blocks));

      // Add artifacts if present
      if (pair.answer.metadata?.artifacts && Array.isArray(pair.answer.metadata.artifacts)) {
        const artifactsWithContent = pair.answer.metadata.artifacts.filter((a) => a.content);

        if (artifactsWithContent.length > 0) {
          lines.push('');
          lines.push('### Artifacts');
          lines.push('');

          for (const artifact of artifactsWithContent) {
            // Add artifact header
            lines.push(`#### ${artifact.title}`);

            if (artifact.typeLabel) {
              lines.push(`*Type: ${artifact.typeLabel}*`);
            }

            lines.push('');

            // Handle different artifact types appropriately
            if (artifact.type === 'image' && artifact.language === 'svg' && artifact.content) {
              // SVG artifacts: embed as data URL image
              const svgDataUrl = `data:image/svg+xml;base64,${btoa(artifact.content)}`;
              lines.push(`<img src="${svgDataUrl}" alt="${artifact.title}" style="max-width: 100%; height: auto;">`);
              lines.push('');

              // Also include the SVG code in a collapsible section
              lines.push('<details>');
              lines.push('<summary>View SVG Code</summary>');
              lines.push('');
              lines.push('```svg');
              lines.push(artifact.content);
              lines.push('```');
              lines.push('</details>');
            } else if (artifact.type === 'document' || artifact.language === 'markdown') {
              // Markdown documents: render directly as markdown
              lines.push(artifact.content || '');
            } else {
              // For code artifacts (HTML, React, SVG, etc.), use code blocks
              const language = artifact.language || this.inferLanguageFromType(artifact.type);
              lines.push(`\`\`\`${language}`);
              lines.push(artifact.content || '');
              lines.push('```');
            }

            lines.push('');
          }
        }
      }

      // Add cited sources (Gemini Deep Research, ChatGPT/Claude web search)
      if (pair.answer.metadata?.webSearches && Array.isArray(pair.answer.metadata.webSearches)) {
        for (const search of pair.answer.metadata.webSearches) {
          if (!search.results?.length) {
            continue;
          }
          lines.push('');
          lines.push(`### Sources — ${search.query || 'References'}`);
          lines.push('');
          for (const result of search.results) {
            lines.push(`- [${result.title}](${result.url})${result.domain ? ` — *${result.domain}*` : ''}`);
          }
          lines.push('');
        }
      }

      // Add separator between pairs (but not after the last one)
      if (i < conversation.pairs.length - 1) {
        lines.push('---');
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Render structured content blocks to markdown
   */
  private renderBlocks(blocks: StructuredContentBlock[]): string[] {
    const lines: string[] = [];

    for (const block of blocks) {
      switch (block.type) {
        case 'paragraph': {
          const paraText = this.renderInline(block.content).trim();
          if (paraText) {
            lines.push(paraText);
            lines.push('');
          }
          break;
        }

        case 'heading': {
          const hashes = '#'.repeat(bodyHeadingLevel(block.level)); // # is the title, ## the role label
          const headingText = this.renderInline(block.content).trim();
          if (headingText) {
            lines.push(`${hashes} ${headingText}`);
            lines.push('');
          }
          break;
        }

        case 'code':
          lines.push(`\`\`\`${block.language}`);
          lines.push(block.code);
          lines.push('```');
          lines.push('');
          break;

        case 'list':
          lines.push(...this.renderList(block, 0));
          lines.push('');
          break;

        case 'blockquote': {
          const quoteLines = this.renderBlocks(block.content);
          lines.push(...quoteLines.map(line => (line ? `> ${line}` : '>')));
          lines.push('');
          break;
        }

        case 'hr':
          lines.push('---');
          lines.push('');
          break;

        case 'image': {
          const alt = block.alt || 'image';

          // Match Claude's webchat thumbnail size (typically ~200px)
          const webChatThumbnailSize = 200;
          let width = block.width;
          let height = block.height;

          // If we have dimensions and they exceed webchat size, scale proportionally
          if (width && width > webChatThumbnailSize) {
            const scale = webChatThumbnailSize / width;
            width = webChatThumbnailSize;
            height = height ? Math.round(height * scale) : undefined;
          }

          // Use HTML img tag for better size control
          if (width && height) {
            lines.push(`<img src="${block.url}" alt="${alt}" width="${width}" height="${height}">`);
          } else if (width || height) {
            const widthAttr = width ? ` width="${width}"` : '';
            const heightAttr = height ? ` height="${height}"` : '';
            lines.push(`<img src="${block.url}" alt="${alt}"${widthAttr}${heightAttr}>`);
          } else {
            // No dimensions - constrain with CSS to match webchat
            lines.push(`<img src="${block.url}" alt="${alt}" style="max-width: 200px; height: auto;">`);
          }
          lines.push('');
          break;
        }

        // No markdown syntax plays video or audio, so link it with a label.
        case 'media':
          lines.push(`[${this.mediaLabel(block)}](${block.url})`);
          lines.push('');
          break;

        case 'table':
          lines.push(...this.renderTable(block));
          lines.push('');
          break;
      }
    }

    return lines;
  }

  /**
   * Render a table to markdown
   */
  private renderTable(block: TableBlock): string[] {
    const lines: string[] = [];

    // Render headers if present
    if (block.headers && block.headers.length > 0) {
      const headerCells = block.headers.map((cell: InlineContent[]) =>
        this.renderInline(cell).trim() || ' '
      );
      lines.push(`| ${headerCells.join(' | ')} |`);

      // Separator row
      const separators = headerCells.map(() => '---');
      lines.push(`| ${separators.join(' | ')} |`);
    }

    // Render body rows
    if (block.rows && block.rows.length > 0) {
      for (const row of block.rows) {
        const rowCells = row.map((cell: InlineContent[]) =>
          this.renderInline(cell).trim() || ' '
        );
        lines.push(`| ${rowCells.join(' | ')} |`);
      }
    }

    return lines;
  }

  /**
   * Render a list to markdown
   */
  private renderList(block: ListBlock, depth: number): string[] {
    const lines: string[] = [];
    const indent = '  '.repeat(depth);

    block.items.forEach((item, index) => {
      const prefix = block.ordered ? `${index + 1}.` : '-';
      const content = this.renderInline(item.content).trim();

      // Put content on the same line as the bullet/number
      if (content) {
        lines.push(`${indent}${prefix} ${content}`);
      }

      if (item.nested) {
        lines.push(...this.renderList(item.nested, depth + 1));
      }
    });

    return lines;
  }

  /**
   * Render inline content to markdown
   */
  private renderInline(content: InlineContent[]): string {
    return content
      .map(item => {
        switch (item.type) {
          case 'text':
            return item.text;

          case 'bold':
            return `**${item.text}**`;

          case 'italic':
            return `*${item.text}*`;

          case 'code':
            return `\`${item.text}\``;

          case 'link':
            return `[${item.text}](${item.url})`;

          case 'strikethrough':
            return `~~${item.text}~~`;

          default:
            return item.text;
        }
      })
      .join('');
  }

  /**
   * Infer code block language from artifact type
   */
  private inferLanguageFromType(type: string): string {
    const languageMap: Record<string, string> = {
      image: 'svg',
      react: 'tsx',
      document: 'markdown',
      diagram: 'mermaid',
      code: 'javascript',
    };

    return languageMap[type] || '';
  }
}
