/**
 * DOCX format exporter
 * Uses docx library for Word document generation
 * Now uses StructuredConversation for rich content rendering
 */

import {
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
import type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  Conversation,
  QAPair,
  StructuredContentBlock,
  InlineContent,
  ListBlock,
} from '../types';
import { BaseExporter } from './base-exporter';
import { ConversationStructureService } from '../services';

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
    conversation: any, // StructuredConversation
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
            size: 32, // 16pt
          }),
        ],
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
              size: 22,
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
                size: 22,
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
                size: 22,
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
              size: 22,
            }),
          ],
          spacing: { after: 300 },
        })
      );
    }

    // Q&A pairs
    const assistantName = this.getAssistantName(conversation.platform);
    for (const pair of conversation.pairs) {
      sections.push(...this.formatPair(pair, options, assistantName));
    }

    return new Document({
      title: conversation.title,
      creator: 'AI Chat Exporter',
      styles: {
        default: {
          document: {
            run: {
              font: 'Arial',
              size: 24, // 12pt
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
   * Format a single Q&A pair as DOCX paragraphs
   */
  private formatPair(pair: any, _options: ExportOptions, assistantName: string): (Paragraph | Table)[] {
    const paragraphs: (Paragraph | Table)[] = [];

    // User heading
    paragraphs.push(
      new Paragraph({
        text: 'User',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 150 },
      })
    );

    // User content
    paragraphs.push(...this.renderBlocks(pair.question.blocks));

    // Assistant heading
    paragraphs.push(
      new Paragraph({
        text: assistantName,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 150 },
      })
    );

    // Assistant content
    paragraphs.push(...this.renderBlocks(pair.answer.blocks));

    // Add artifacts if present
    if (pair.answer.metadata?.artifacts && Array.isArray(pair.answer.metadata.artifacts)) {
      const artifactsWithContent = pair.answer.metadata.artifacts.filter((a: any) => a.content);

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
                  size: 26,
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
                    size: 22,
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
                    size: 22,
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
                      font: 'Courier New',
                      size: 20,
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
                new TextRun({ text: result.title, size: 22 }),
                new TextRun({ text: ` — ${result.url}`, size: 20, italics: true }),
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

    // Map heading levels (shift by 2 since we use HEADING_2 for user/assistant)
    const headingLevels: (typeof HeadingLevel)[keyof typeof HeadingLevel][] = [
      HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4,
      HeadingLevel.HEADING_5,
      HeadingLevel.HEADING_6,
      HeadingLevel.HEADING_6,
      HeadingLevel.HEADING_6,
    ];
    const heading: (typeof HeadingLevel)[keyof typeof HeadingLevel] = headingLevels[Math.min(block.level - 1, headingLevels.length - 1)]!;

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
              size: 18,
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
              font: 'Courier New',
              size: 20,
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
            indent: { left: 360 + (depth * 360) }, // 0.25 inch base + 0.25 inch per level
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
        // Render paragraph with blockquote styling
        const textRuns = this.renderInline(block.content);
        if (textRuns.length > 0) {
          elements.push(
            new Paragraph({
              children: textRuns,
              indent: { left: 720 }, // Indent 0.5 inch
              border: {
                left: { style: BorderStyle.SINGLE, size: 6 },
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
        bottom: { style: BorderStyle.SINGLE, size: 6 },
      },
    });
  }

  /**
   * Render a table
   */
  private renderTable(block: any): Table {
    const rows: TableRow[] = [];

    // Render header rows
    if (block.headers && block.headers.length > 0) {
      const headerCells = block.headers.map(
        (cell: InlineContent[]) =>
          new TableCell({
            children: [
              new Paragraph({
                children: this.renderInline(cell),
                ...{ bold: true },
              }),
            ],
            shading: { fill: 'D9D9D9' }, // Light gray background for headers
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
   * Render inline content to TextRuns
   */
  private renderInline(content: InlineContent[]): TextRun[] {
    return content.map((item) => {
      const options: any = {
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
          options.font = 'Courier New';
          options.size = 20;
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
