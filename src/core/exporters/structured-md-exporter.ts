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
import { isProseArtifact } from './artifact-content';
import { ConversationStructureService } from '../services';
import { getMessage } from '../../shared/i18n';
import { DOC_HEADING_LEVEL, bodyHeadingLevel, buildHeadingLevelMap } from './style-tokens';
import type { HeadingLevelMap } from './style-tokens';

/**
 * Longest run of consecutive backticks anywhere in `text`, 0 if none.
 */
function longestBacktickRun(text: string): number {
  const runs = text.match(/`+/g);
  return runs ? Math.max(...runs.map((run) => run.length)) : 0;
}

/**
 * Fence long enough that a backtick run inside `content` can never close it
 * early. CommonMark only requires the closing fence to be at least as long as
 * the opening one, so one run longer than the longest run *inside* the
 * content is always safe; 3 is the floor for an ordinary block with no
 * backticks at all.
 */
function codeFence(content: string): string {
  return '`'.repeat(Math.max(3, longestBacktickRun(content) + 1));
}

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
    const levelMap = buildHeadingLevelMap(
      ConversationStructureService.collectHeadingLevels(conversation)
    );

    // Title
    lines.push(`${'#'.repeat(DOC_HEADING_LEVEL.title)} ${conversation.title}`);
    lines.push('');

    // Metadata as a table
    if (options.showMetaInfo) {
      lines.push(
        `| **${getMessage('metadataTableHeaderField')}** | **${getMessage('metadataTableHeaderValue')}** |`
      );
      lines.push('|---|---|');
      lines.push(
        `| ${this.getMetadataLabel('platform')} | ${this.formatPlatformName(conversation.platform)} |`
      );
      if (conversation.model) {
        lines.push(`| ${this.getMetadataLabel('model')} | ${conversation.model} |`);
      }
      const dateRange = this.formatDateRange(conversation.pairs);
      if (dateRange) {
        lines.push(`| ${this.getMetadataLabel('dateRange')} | ${dateRange} |`);
      }
      lines.push(
        `| ${this.getMetadataLabel('exported')} | ${this.formatTimestamp(conversation.createdAt)} |`
      );
      lines.push(`| ${this.getMetadataLabel('url')} | ${conversation.url} |`);
      lines.push('');
    }

    // Horizontal rule before conversation
    lines.push('---');
    lines.push('');

    // Q&A pairs
    const daySeparator = this.daySeparator(options.showMetaInfo);
    const pushDaySeparator = (date?: Date): void => {
      const separator = daySeparator(date);
      if (separator) {
        lines.push(`**${separator}**`, '');
      }
    };

    /**
     * `**User** · 12:04` — bold text with a middot, not a heading (R-4).
     *
     * Markdown formats the time itself rather than reusing
     * `formatTimestampSuffix`'s ` (12:04)` (CONSIST-1: now hours-and-minutes
     * there too, matching this design's original reasoning that seconds are
     * noise at this scale): only the wrapper glyph — bold text and a middot
     * instead of parens — stays local to md.
     */
    const roleLabel = (name: string, timestamp?: Date): string => {
      if (!options.showMetaInfo || !timestamp) return `**${name}**`;
      return `**${name}** · ${this.formatTime(timestamp).slice(0, 5)}`;
    };

    for (const [i, pair] of conversation.pairs.entries()) {
      // User question — quoted, which is what separates the voices now that the
      // role label is no longer a heading.
      pushDaySeparator(pair.question.timestamp);
      lines.push(roleLabel(this.getRoleName('user'), pair.question.timestamp));
      lines.push('');
      lines.push(...this.quote(this.renderBlocks(pair.question.blocks, levelMap)));

      // Assistant answer
      pushDaySeparator(pair.answer.timestamp);
      lines.push(
        roleLabel(this.getRoleName('assistant', conversation.platform), pair.answer.timestamp)
      );
      lines.push('');
      lines.push(...this.renderBlocks(pair.answer.blocks, levelMap));

      // Add artifacts if present
      if (pair.answer.metadata?.artifacts && Array.isArray(pair.answer.metadata.artifacts)) {
        const artifactsWithContent = pair.answer.metadata.artifacts.filter((a) => a.content);

        if (artifactsWithContent.length > 0) {
          lines.push('');
          lines.push(`### ${this.artifactsSectionLabel()}`);
          lines.push('');

          for (const artifact of artifactsWithContent) {
            // Add artifact header
            lines.push(`#### ${artifact.title}`);

            if (artifact.typeLabel) {
              lines.push(`*${this.artifactTypeFieldLabel()}: ${artifact.typeLabel}*`);
            }

            lines.push('');

            // Handle different artifact types appropriately
            if (artifact.type === 'image' && artifact.language === 'svg' && artifact.content) {
              // SVG artifacts: embed as data URL image.
              //
              // `btoa` throws for any codepoint above U+00FF (Latin-1 only),
              // so a single non-Latin-1 character anywhere in the SVG (an en
              // dash, a curly quote, CJK/Cyrillic text, an emoji) used to
              // fail the WHOLE export with no file produced at all. A
              // percent-encoded data URL has no such ceiling and needs no
              // encoding table. Still guarded -- `encodeURIComponent` throws
              // on a lone unpaired surrogate -- because losing just the
              // preview image is a far smaller failure than losing the
              // entire export; the `<details>` block below still carries the
              // raw source either way.
              try {
                const svgDataUrl = `data:image/svg+xml,${encodeURIComponent(artifact.content)}`;
                lines.push(
                  `<img src="${svgDataUrl}" alt="${artifact.title}" style="max-width: 100%; height: auto;">`
                );
                lines.push('');
              } catch {
                // Degrade to the source-only block below rather than failing the export.
              }

              // Also include the SVG code in a collapsible section
              const svgFence = codeFence(artifact.content);
              lines.push('<details>');
              lines.push(`<summary>${getMessage('exportViewSvgCode')}</summary>`);
              lines.push('');
              lines.push(`${svgFence}svg`);
              lines.push(artifact.content);
              lines.push(svgFence);
              lines.push('</details>');
            } else if (isProseArtifact(artifact)) {
              // Markdown documents: render directly as markdown
              lines.push(artifact.content || '');
            } else {
              // For code artifacts (HTML, React, SVG, etc.), use code blocks
              const language = artifact.language || this.inferLanguageFromType(artifact.type);
              const fence = codeFence(artifact.content || '');
              lines.push(`${fence}${language}`);
              lines.push(artifact.content || '');
              lines.push(fence);
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
          lines.push(`### ${this.sourcesSectionLabel(search.query)}`);
          lines.push('');
          for (const result of search.results) {
            lines.push(
              `- [${result.title}](${result.url})${result.domain ? ` — *${result.domain}*` : ''}`
            );
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
  /**
   * Prefix rendered lines with Markdown's quote marker. Interior blank lines
   * become a bare `>` so the quote survives as one block instead of splitting at
   * every paragraph break.
   *
   * Trailing blanks are dropped and replaced with one unquoted blank line: a
   * quote that ends on `>` puts the next line directly against the block, where
   * Markdown's lazy continuation can swallow it into the quote — which would
   * pull the *assistant's* role label inside the user's question.
   */
  private quote(lines: string[]): string[] {
    const end = lines.reduce((last, line, i) => (line ? i + 1 : last), 0);
    return [...lines.slice(0, end).map((line) => (line ? `> ${line}` : '>')), ''];
  }

  private renderBlocks(blocks: StructuredContentBlock[], levelMap: HeadingLevelMap): string[] {
    const lines: string[] = [];

    for (const block of blocks) {
      switch (block.type) {
        case 'paragraph': {
          const paraText = this.escapeLeadingMarker(this.renderInline(block.content).trim());
          if (paraText) {
            lines.push(paraText);
            lines.push('');
          }
          break;
        }

        case 'heading': {
          const hashes = '#'.repeat(bodyHeadingLevel(block.level, levelMap)); // # is the title; body headings start at ##
          const headingText = this.renderInline(block.content).trim();
          if (headingText) {
            lines.push(`${hashes} ${headingText}`);
            lines.push('');
          }
          break;
        }

        case 'code': {
          const fence = codeFence(block.code);
          lines.push(`${fence}${block.language}`);
          lines.push(block.code);
          lines.push(fence);
          lines.push('');
          break;
        }

        case 'list':
          lines.push(...this.renderList(block, ''));
          lines.push('');
          break;

        case 'blockquote': {
          const quoteLines = this.renderBlocks(block.content, levelMap);
          lines.push(...quoteLines.map((line) => (line ? `> ${line}` : '>')));
          lines.push('');
          break;
        }

        case 'hr':
          lines.push('---');
          lines.push('');
          break;

        case 'image': {
          /**
           * Native Markdown (R-4). This used to emit a raw `<img>` scaled to a
           * 200 px "webchat thumbnail", which is a rendering decision a
           * Markdown file has no business making: it is not Markdown, it does
           * not survive a converter, and it shrinks a full-width chart to a
           * thumbnail everywhere the file is read. Width belongs to whatever
           * renders the file.
           */
          const alt = block.alt || 'image';
          lines.push(`![${alt}](${block.url})`);
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
   * Render one table cell: escape `|` (the only character a table cell can't
   * hold literally -- it shifts or drops columns) and collapse a raw newline
   * to a space. A newline can reach here unchanged because `HtmlContentParser`
   * doesn't whitespace-collapse inline `code`/`math` text, and a literal
   * newline in a cell splits the row across two physical lines.
   */
  private renderTableCell(cell: InlineContent[]): string {
    const text = this.renderInline(cell).trim().replace(/\r?\n/g, ' ');
    return text ? text.replace(/\|/g, '\\|') : ' ';
  }

  /**
   * Render a table to markdown
   */
  private renderTable(block: TableBlock): string[] {
    const lines: string[] = [];

    // Render headers if present
    if (block.headers && block.headers.length > 0) {
      const headerCells = block.headers.map((cell: InlineContent[]) => this.renderTableCell(cell));
      lines.push(`| ${headerCells.join(' | ')} |`);

      // Separator row
      const separators = headerCells.map(() => '---');
      lines.push(`| ${separators.join(' | ')} |`);
    }

    // Render body rows
    if (block.rows && block.rows.length > 0) {
      for (const row of block.rows) {
        const rowCells = row.map((cell: InlineContent[]) => this.renderTableCell(cell));
        lines.push(`| ${rowCells.join(' | ')} |`);
      }
    }

    return lines;
  }

  /**
   * Escape a marker that would start new block structure if it opened the
   * rendered line: an ATX heading (`#`), a blockquote (`>`), a bullet
   * (`-`/`+`), or an ordered marker (`1.`/`1)`). Markdown only reads these at
   * the very start of a line, so this only ever touches position 0 -- `*`
   * mid-sentence or `_` inside `my_var_name` are untouched. Only a marker
   * genuinely followed by whitespace/end-of-line qualifies, so `3.14` and
   * `-5` (no space after the punctuation) are left alone too.
   *
   * The ordered-marker case escapes the delimiter (`.`/`)`), not the digits:
   * CommonMark can't backslash-escape a digit (it isn't ASCII punctuation),
   * so `\1.` would render with a literal, visible backslash instead of
   * disappearing into `1.`.
   */
  private escapeLeadingMarker(text: string): string {
    if (/^#{1,6}(?=\s|$)/.test(text)) return `\\${text}`;
    if (text.startsWith('>')) return `\\${text}`;
    if (/^[-+](?=\s|$)/.test(text)) return `\\${text}`;

    const ordered = /^(\d{1,9})([.)])(?=\s|$)/.exec(text);
    if (ordered) {
      return `${ordered[1]}\\${ordered[2]}${text.slice(ordered[0].length)}`;
    }

    return text;
  }

  /**
   * Render a list to markdown.
   *
   * `indent` is the literal string prefixed to every line at this level, not
   * a depth count: CommonMark requires a nested list to be indented to the
   * parent item's *content* column, which is the parent marker's width plus
   * one space -- 2 for a bullet (`- `), but 3 for `1. ` and 4 for `10. `. A
   * fixed 2-space step under an ordered ancestor falls short of that column,
   * so the nested list is read as a sibling instead of a child.
   */
  private renderList(block: ListBlock, indent: string): string[] {
    const lines: string[] = [];

    block.items.forEach((item, index) => {
      const prefix = block.ordered ? `${index + 1}.` : '-';
      const content = this.renderInline(item.content).trim();

      // Put content on the same line as the bullet/number
      if (content) {
        lines.push(`${indent}${prefix} ${content}`);
      }

      if (item.nested) {
        lines.push(...this.renderList(item.nested, indent + ' '.repeat(prefix.length + 1)));
      }
    });

    return lines;
  }

  /**
   * Render inline content to markdown
   */
  private renderInline(content: InlineContent[]): string {
    return content
      .map((item) => {
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

          // lo-320b: `item.text` already carries the `$…$` / `$$…$$` delimiters
          // every markdown math renderer expects, so markdown needs no wrapping
          // of its own. Explicit rather than left to `default:` because this is
          // the format where the delimiters are native syntax — a future
          // "cleanup" of the default branch must not silently strip them.
          case 'math':
            return item.text;

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
