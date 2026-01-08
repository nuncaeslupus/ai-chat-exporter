/**
 * Markdown format exporter
 */

import type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  Conversation,
  QAPair,
} from '../types';
import { BaseExporter } from './base-exporter';

/**
 * Exports conversations to Markdown format
 */
export class MarkdownExporter extends BaseExporter {
  readonly format: ExportFormat = 'md';
  readonly extension = 'md';
  readonly mimeType = 'text/markdown';

  /**
   * Export selected Q&A pairs to Markdown
   */
  async export(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      const content = this.generateMarkdown(conversation, selectedPairs, options);
      return this.createSuccessResult(content, options.filename);
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Failed to export to Markdown'
      );
    }
  }

  /**
   * Generate Markdown content
   */
  private generateMarkdown(
    conversation: Conversation,
    pairs: QAPair[],
    options: ExportOptions
  ): string {
    const lines: string[] = [];

    // Title
    lines.push(`# ${conversation.title}`);
    lines.push('');

    // Metadata section
    if (options.includeMetadata) {
      lines.push(`**Platform:** ${this.formatPlatformName(conversation.platform)}`);
      if (conversation.model) {
        lines.push(`**Model:** ${conversation.model}`);
      }
      if (conversation.createdAt) {
        lines.push(`**Exported:** ${this.formatTimestamp(conversation.createdAt)}`);
      }
      lines.push(`**URL:** ${conversation.url}`);
      lines.push('---');
      lines.push('');
    }

    // Q&A pairs
    for (const pair of pairs) {
      lines.push(...this.formatPair(pair, options));
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format a single Q&A pair
   */
  private formatPair(pair: QAPair, options: ExportOptions): string[] {
    const lines: string[] = [];

    // User message
    lines.push('## User');
    if (options.includeTimestamps && pair.question.timestamp) {
      lines.push(`*${this.formatTimestamp(pair.question.timestamp)}*`);
      lines.push('');
    }

    // Add user-uploaded images if present
    if (pair.question.metadata?.images && Array.isArray(pair.question.metadata.images)) {
      for (const image of pair.question.metadata.images) {
        if (image.src) {
          const alt = image.alt || 'User uploaded image';

          // Check if it's a data URL (will work in exports) or a blob URL (won't work)
          if (image.src.startsWith('data:')) {
            // Data URL - will work in the export
            // Match Claude's webchat thumbnail size (typically ~200px)
            const webChatThumbnailSize = 200;
            let width = image.width;
            let height = image.height;

            // If we have dimensions and they exceed webchat size, scale proportionally
            if (width && width > webChatThumbnailSize) {
              const scale = webChatThumbnailSize / width;
              width = webChatThumbnailSize;
              height = height ? Math.round(height * scale) : undefined;
            }

            if (width && height) {
              lines.push(`<img src="${image.src}" alt="${alt}" width="${width}" height="${height}">`);
            } else {
              // No dimensions - constrain with CSS to match webchat
              lines.push(`<img src="${image.src}" alt="${alt}" style="max-width: 200px; height: auto;">`);
            }
          } else {
            // Blob URL or external URL - may not work in exports
            // Just indicate an image was present with its description
            lines.push(`**[Image: ${alt}]**`);
            lines.push('');
            lines.push(`*Note: User-uploaded image cannot be embedded in markdown export (source: ${image.src.substring(0, 50)}...)*`);
          }
          lines.push('');
        }
      }
    }

    lines.push(pair.question.content);
    lines.push('');

    // Assistant message
    lines.push('## Assistant');
    if (options.includeTimestamps && pair.answer.timestamp) {
      lines.push(`*${this.formatTimestamp(pair.answer.timestamp)}*`);
      lines.push('');
    }
    lines.push(pair.answer.content);

    // Add artifact content if available
    if (pair.answer.metadata?.artifacts && Array.isArray(pair.answer.metadata.artifacts)) {
      console.log('[MD Exporter] Total artifacts:', pair.answer.metadata.artifacts.length);
      pair.answer.metadata.artifacts.forEach((a, i) => {
        console.log(`[MD Exporter] Artifact ${i}: "${a.title}", hasContent:`, !!a.content, 'contentLength:', a.content?.length || 0);
      });

      const artifactsWithContent = pair.answer.metadata.artifacts.filter(a => a.content);
      console.log('[MD Exporter] Artifacts with content:', artifactsWithContent.length);

      if (artifactsWithContent.length > 0) {
        lines.push('');
        lines.push('### Artifacts');
        lines.push('');

        for (const artifact of artifactsWithContent) {
          console.log(`[MD Exporter] Adding artifact "${artifact.title}" to markdown`);
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
            // Other artifacts (code, React, etc.): show as code blocks
            const language = artifact.language || this.inferLanguageFromType(artifact.type);
            lines.push(`\`\`\`${language}`);
            lines.push(artifact.content || '');
            lines.push('```');
          }
          lines.push('');
        }
      }
    }

    // Add web search results (ChatGPT citations)
    if (pair.answer.metadata?.webSearches && Array.isArray(pair.answer.metadata.webSearches)) {
      const webSearches = pair.answer.metadata.webSearches;
      if (webSearches.length > 0) {
        lines.push('');
        lines.push('### Web Search Results');
        lines.push('');

        for (const search of webSearches) {
          lines.push(`#### ${search.query || 'References'}`);
          if (search.resultCount) {
            lines.push(`*${search.resultCount} results found*`);
          }
          lines.push('');

          if (search.results && search.results.length > 0) {
            for (const result of search.results) {
              lines.push(`- [${result.title}](${result.url})`);
              if (result.domain) {
                lines.push(`  *${result.domain}*`);
              }
            }
            lines.push('');
          }
        }
      }
    }

    return lines;
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
