/**
 * DOCX format exporter
 * Uses docx library for Word document generation
 * Now uses StructuredConversation for rich content rendering
 */

import {
  AlignmentType,
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Packer,
  UnderlineType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from 'docx';
import type { IRunOptions } from 'docx';

// IRunOptions is declared readonly; the switch below builds one field by field.
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
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
  TableBlock,
} from '../types';
import { BaseExporter } from './base-exporter';
import { ConversationStructureService } from '../services';
import {
  COLOR,
  DOCX_FONT_SIZE_PT,
  DOC_HEADING_LEVEL,
  FONT_FAMILY,
  FONT_SIZE_PT,
  SPACING,
  bodyHeadingLevel,
  hexToDocxColor,
  mmToTwips,
  ptToHalfPt,
} from './style-tokens';

/** Document heading level 1-6 -> docx HeadingLevel, index 0 = level 1. */
const DOCX_HEADING_BY_LEVEL: (typeof HeadingLevel)[keyof typeof HeadingLevel][] = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

/**
 * Exports conversations to DOCX (Word) format
 */
export class DocxExporter extends BaseExporter {
  readonly format: ExportFormat = 'docx';
  readonly extension = 'docx';
  readonly mimeType =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  /**
   * Export selected Q&A pairs to DOCX
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

      const doc = this.createDocument(structured, options);
      const blob = await Packer.toBlob(doc);
      return this.createSuccessResult(blob, options.filename);
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Failed to export to DOCX'
      );
    }
  }

  /**
   * Create a DOCX document
   */
  private createDocument(
    conversation: StructuredConversation,
    options: ExportOptions
  ): Document {
    const sections: (Paragraph | Table)[] = [];

    // Title
    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: conversation.title,
            bold: true,
            size: ptToHalfPt(DOCX_FONT_SIZE_PT.title),
          }),
        ],
        heading: DOCX_HEADING_BY_LEVEL[DOC_HEADING_LEVEL.title - 1]!,
        spacing: { after: 300 },
      })
    );

    // Metadata
    if (options.includeMetadata) {
      sections.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Platform: ${this.formatPlatformName(conversation.platform)}`,
              size: ptToHalfPt(FONT_SIZE_PT.meta),
              color: hexToDocxColor(COLOR.textMuted),
            }),
          ],
          spacing: { after: 100 },
        })
      );

      if (conversation.model) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `Model: ${conversation.model}`,
                size: ptToHalfPt(FONT_SIZE_PT.meta),
                color: hexToDocxColor(COLOR.textMuted),
              }),
            ],
            spacing: { after: 100 },
          })
        );
      }

      const dateRange = this.formatDateRange(conversation.pairs);
      if (dateRange) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${this.getMetadataLabel('dateRange')}: ${dateRange}`,
                size: ptToHalfPt(FONT_SIZE_PT.meta),
                color: hexToDocxColor(COLOR.textMuted),
              }),
            ],
            spacing: { after: 100 },
          })
        );
      }

      if (conversation.createdAt) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `Exported: ${this.formatTimestamp(conversation.createdAt)}`,
                size: ptToHalfPt(FONT_SIZE_PT.meta),
                color: hexToDocxColor(COLOR.textMuted),
              }),
            ],
            spacing: { after: 100 },
          })
        );
      }

      sections.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `URL: ${conversation.url}`,
              size: ptToHalfPt(FONT_SIZE_PT.meta),
              color: hexToDocxColor(COLOR.textMuted),
            }),
          ],
          spacing: { after: 300 },
        })
      );
    }

    // Q&A pairs
    const assistantName = this.getAssistantName(conversation.platform);
    const daySeparator = this.daySeparator(options.includeTimestamps);
    for (const pair of conversation.pairs) {
      sections.push(...this.formatPair(pair, options, assistantName, daySeparator));
    }

    return new Document({
      title: conversation.title,
      creator: 'AI Chat Exporter',
      styles: {
        default: {
          document: {
            run: {
              font: FONT_FAMILY.body.docx,
              size: ptToHalfPt(FONT_SIZE_PT.body),
            },
          },
        },
      },
      sections: [
        {
          children: sections,
        },
      ],
    });
  }

  /**
   * Render a role heading, appending a de-emphasized timestamp run when non-empty.
   */
  private renderRoleHeading(label: string, timestampSuffix: string): Paragraph {
    const children: TextRun[] = [new TextRun({ text: label })];
    if (timestampSuffix) {
      children.push(
        new TextRun({
          text: timestampSuffix,
          italics: true,
          size: ptToHalfPt(FONT_SIZE_PT.meta),
          color: hexToDocxColor(COLOR.textMuted),
        })
      );
    }
    return new Paragraph({
      children,
      heading: DOCX_HEADING_BY_LEVEL[DOC_HEADING_LEVEL.roleLabel - 1]!,
      spacing: { before: 300, after: 150 },
    });
  }

  /**
   * A day-change marker, centred and de-emphasized like the timestamps it
   * replaces. Not a heading: it carries no outline weight.
   */
  private renderDaySeparator(separator: string): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({
          text: separator,
          size: ptToHalfPt(FONT_SIZE_PT.meta),
          color: hexToDocxColor(COLOR.textMuted),
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 300, after: 150 },
    });
  }

  /**
   * Format a single Q&A pair as DOCX paragraphs
   */
  private formatPair(
    pair: StructuredQAPair,
    options: ExportOptions,
    assistantName: string,
    daySeparator: (date?: Date) => string
  ): (Paragraph | Table)[] {
    const paragraphs: (Paragraph | Table)[] = [];
    const pushDaySeparator = (date?: Date): void => {
      const separator = daySeparator(date);
      if (separator) {
        paragraphs.push(this.renderDaySeparator(separator));
      }
    };

    // User heading
    pushDaySeparator(pair.question.timestamp);
    paragraphs.push(
      this.renderRoleHeading('User', this.formatTimestampSuffix(pair.question.timestamp, options.includeTimestamps))
    );

    // User content
    paragraphs.push(...this.renderBlocks(pair.question.blocks));

    // Assistant heading
    pushDaySeparator(pair.answer.timestamp);
    paragraphs.push(
      this.renderRoleHeading(assistantName, this.formatTimestampSuffix(pair.answer.timestamp, options.includeTimestamps))
    );

    // Assistant content
    paragraphs.push(...this.renderBlocks(pair.answer.blocks));

    // Add artifacts if present
    if (pair.answer.metadata?.artifacts && Array.isArray(pair.answer.metadata.artifacts)) {
      const artifactsWithContent = pair.answer.metadata.artifacts.filter((a) => a.content);

      if (artifactsWithContent.length > 0) {
        paragraphs.push(
          new Paragraph({
            text: 'Artifacts',
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 100 },
          })
        );

        for (const artifact of artifactsWithContent) {
          // Artifact title
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: artifact.title,
                  bold: true,
                  size: ptToHalfPt(DOCX_FONT_SIZE_PT.artifactTitle),
                }),
              ],
              spacing: { before: 150, after: 50 },
            })
          );

          // Artifact type
          if (artifact.typeLabel) {
            paragraphs.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Type: ${artifact.typeLabel}`,
                    italics: true,
                    size: ptToHalfPt(FONT_SIZE_PT.meta),
                  }),
                ],
                spacing: { after: 100 },
              })
            );
          }

          // Artifact content
          // For markdown artifacts, try to render; for others, show as code
          if (artifact.type === 'document' || artifact.language === 'markdown') {
            // Note: Full markdown parsing for DOCX would be complex
            // For now, just render as formatted text
            paragraphs.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: artifact.content || '',
                    size: ptToHalfPt(FONT_SIZE_PT.body),
                  }),
                ],
                spacing: { after: 150 },
              })
            );
          } else {
            // Show as monospace code
            const contentLines = (artifact.content || '').split('\n');
            for (const line of contentLines) {
              paragraphs.push(
                new Paragraph({
                  children: [
                    new TextRun({
                      text: line,
                      font: FONT_FAMILY.code.docx,
                      size: ptToHalfPt(FONT_SIZE_PT.code),
                    }),
                  ],
                  spacing: { after: 0 },
                })
              );
            }
            paragraphs.push(new Paragraph({ text: '', spacing: { after: 150 } }));
          }
        }
      }
    }

    // Add cited sources (Gemini Deep Research, ChatGPT/Claude web search)
    if (pair.answer.metadata?.webSearches && Array.isArray(pair.answer.metadata.webSearches)) {
      for (const search of pair.answer.metadata.webSearches) {
        if (!search.results?.length) {
          continue;
        }
        paragraphs.push(
          new Paragraph({
            text: `Sources — ${search.query || 'References'}`,
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 100 },
          })
        );
        for (const result of search.results) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: result.title, size: ptToHalfPt(FONT_SIZE_PT.body) }),
                new TextRun({
                  text: ` — ${result.url}`,
                  size: ptToHalfPt(FONT_SIZE_PT.meta),
                  italics: true,
                }),
              ],
              spacing: { after: 50 },
            })
          );
        }
      }
    }

    return paragraphs;
  }

  /**
   * Render structured content blocks to DOCX elements
   */
  private renderBlocks(blocks: StructuredContentBlock[]): (Paragraph | Table)[] {
    const elements: (Paragraph | Table)[] = [];

    for (const block of blocks) {
      switch (block.type) {
        case 'paragraph':
          elements.push(...this.renderParagraph(block.content));
          break;

        case 'heading':
          elements.push(...this.renderHeading(block));
          break;

        case 'code':
          elements.push(...this.renderCodeBlock(block.code, block.language));
          break;

        case 'list':
          elements.push(...this.renderList(block, 0));
          break;

        case 'blockquote':
          elements.push(...this.renderBlockquote(block.content));
          break;

        case 'hr':
          elements.push(this.renderHorizontalRule());
          break;

        case 'image':
          elements.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `[Image: ${block.alt || 'image'}]`,
                  italics: true,
                }),
              ],
              spacing: { before: 100, after: 100 },
            })
          );
          break;

        // Word can't play the clip inline; label it and keep the URL.
        case 'media':
          elements.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `[${this.mediaLabel(block)}] ${block.url}`,
                  italics: true,
                }),
              ],
              spacing: { before: 100, after: 100 },
            })
          );
          break;

        case 'table':
          elements.push(this.renderTable(block));
          break;
      }
    }

    return elements;
  }

  /**
   * Render a paragraph
   */
  private renderParagraph(content: InlineContent[]): Paragraph[] {
    const textRuns = this.renderInline(content);

    if (textRuns.length === 0) {
      return [];
    }

    return [
      new Paragraph({
        children: textRuns,
        spacing: { after: 200 },
      }),
    ];
  }

  /**
   * Render a heading
   */
  private renderHeading(block: { level: number; content: InlineContent[] }): Paragraph[] {
    const textRuns = this.renderInline(block.content);

    if (textRuns.length === 0) {
      return [];
    }

    const heading = DOCX_HEADING_BY_LEVEL[bodyHeadingLevel(block.level) - 1]!;

    return [
      new Paragraph({
        children: textRuns,
        heading: heading,
        spacing: { before: 250, after: 150 },
      }),
    ];
  }

  /**
   * Render a code block
   */
  private renderCodeBlock(code: string, language: string): Paragraph[] {
    const paragraphs: Paragraph[] = [];

    // Language label
    if (language) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: language.toUpperCase(),
              size: ptToHalfPt(FONT_SIZE_PT.codeLabel),
              bold: true,
            }),
          ],
          spacing: { before: 100, after: 50 },
        })
      );
    }

    // Code block — one TextRun per line, with an explicit break before all
    // but the first, since a literal '\n' inside a run is not a line break
    // in OOXML and Word collapses it.
    const lines = code.split('\n');
    paragraphs.push(
      new Paragraph({
        children: lines.map(
          (line, i) =>
            new TextRun({
              text: line,
              font: FONT_FAMILY.code.docx,
              size: ptToHalfPt(FONT_SIZE_PT.code),
              break: i > 0 ? 1 : 0,
            })
        ),
        spacing: { before: 50, after: 150 },
      })
    );

    return paragraphs;
  }

  /**
   * Render a list
   */
  private renderList(block: ListBlock, depth: number): Paragraph[] {
    const paragraphs: Paragraph[] = [];

    block.items.forEach((item, i) => {
      const textRuns = this.renderInline(item.content);

      if (textRuns.length > 0) {
        const prefix = block.ordered ? `${i + 1}.` : '•';
        const bulletRun = new TextRun({ text: `${prefix} ` });

        paragraphs.push(
          new Paragraph({
            children: [bulletRun, ...textRuns],
            spacing: { after: 100 },
            indent: { left: mmToTwips(SPACING.listIndentStepMm) * (depth + 1) },
          })
        );
      }

      // Render nested list
      if (item.nested) {
        paragraphs.push(...this.renderList(item.nested, depth + 1));
      }
    });

    return paragraphs;
  }

  /**
   * Render a blockquote
   */
  private renderBlockquote(content: StructuredContentBlock[]): (Paragraph | Table)[] {
    const elements: (Paragraph | Table)[] = [];

    // Process each block in the blockquote
    for (const block of content) {
      if (block.type === 'paragraph') {
        // Render paragraph with blockquote styling — italic + muted colour +
        // a coloured rule, matching pdf/html (docx previously had border only).
        const textRuns = this.renderInline(block.content, {
          italics: true,
          color: hexToDocxColor(COLOR.textMuted),
        });
        if (textRuns.length > 0) {
          elements.push(
            new Paragraph({
              children: textRuns,
              indent: { left: mmToTwips(SPACING.blockquoteIndentMm) },
              border: {
                left: {
                  style: BorderStyle.SINGLE,
                  size: 6,
                  color: hexToDocxColor(COLOR.blockquoteBorder),
                },
              },
              spacing: { after: 100 },
            })
          );
        }
      } else {
        // For other block types, render normally (without special blockquote styling)
        elements.push(...this.renderBlocks([block]));
      }
    }

    return elements;
  }

  /**
   * Render a horizontal rule
   */
  private renderHorizontalRule(): Paragraph {
    return new Paragraph({
      children: [new TextRun({ text: '' })],
      spacing: { before: 100, after: 100 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: hexToDocxColor(COLOR.border) },
      },
    });
  }

  /**
   * Render a table
   */
  private renderTable(block: TableBlock): Table {
    const rows: TableRow[] = [];

    // Render header rows
    if (block.headers && block.headers.length > 0) {
      const headerCells = block.headers.map(
        (cell: InlineContent[]) =>
          new TableCell({
            children: [
              new Paragraph({
                children: this.renderInline(cell, { bold: true }),
              }),
            ],
            shading: { fill: hexToDocxColor(COLOR.surfaceSubtle) }, // matches pdf/html table header background
          })
      );
      rows.push(new TableRow({ children: headerCells }));
    }

    // Render body rows
    if (block.rows && block.rows.length > 0) {
      for (const row of block.rows) {
        const bodyCells = row.map(
          (cell: InlineContent[]) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: this.renderInline(cell),
                }),
              ],
            })
        );
        rows.push(new TableRow({ children: bodyCells }));
      }
    }

    return new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
    });
  }

  /**
   * Render inline content to TextRuns.
   * `overrides` layers extra run properties (e.g. blockquote's italic + muted
   * colour) on top of each item's own styling, without disturbing it.
   */
  private renderInline(
    content: InlineContent[],
    overrides?: { italics?: boolean; color?: string; bold?: boolean }
  ): TextRun[] {
    return content.map((item) => {
      const options: Mutable<IRunOptions> = {
        text: item.text,
      };

      switch (item.type) {
        case 'bold':
          options.bold = true;
          break;

        case 'italic':
          options.italics = true;
          break;

        case 'code':
          options.font = FONT_FAMILY.code.docx;
          options.size = ptToHalfPt(FONT_SIZE_PT.code);
          break;

        case 'link':
          options.underline = { type: UnderlineType.SINGLE };
          // Note: docx library doesn't easily support clickable hyperlinks in this context
          // You might want to append the URL to the text
          if (item.url) {
            options.text = `${item.text} (${item.url})`;
          }
          break;

        case 'strikethrough':
          options.strike = true;
          break;
      }

      if (overrides) {
        Object.assign(options, overrides);
      }

      return new TextRun(options);
    });
  }

  /**
   * Get assistant name based on platform
   */
  private getAssistantName(platform: string): string {
    const platformNames: Record<string, string> = {
      chatgpt: 'ChatGPT',
      claude: 'Claude',
      gemini: 'Gemini',
    };

    return platformNames[platform] || 'Assistant';
  }
}
