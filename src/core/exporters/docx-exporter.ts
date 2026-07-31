/**
 * DOCX format exporter
 * Uses docx library for Word document generation
 * Now uses StructuredConversation for rich content rendering
 */

import {
  AlignmentType,
  Footer,
  PageNumber,
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
import { DEFAULT_DOCX_OPTIONS } from '../types';
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
import { isProseArtifact } from './artifact-content';
import {
  escapeHtmlText,
  highlightCode,
  loadHighlighter,
  loadMarkdownRenderer,
  tokenLines,
  type CodeToken,
  type Highlighter,
} from './code-highlight';
import { ConversationStructureService, HtmlContentParser } from '../services';
import {
  CODE_TOKEN_COLOR,
  COLOR,
  DOCX_FONT_SIZE_PT,
  DOC_HEADING_LEVEL,
  FONT_FAMILY,
  FONT_SIZE_PT,
  SPACING,
  bodyHeadingLevel,
  brandColorFor,
  buildHeadingLevelMap,
  scaleFontSizes,
  hexToDocxColor,
  mmToTwips,
  ptToHalfPt,
} from './style-tokens';
import type { HeadingLevelMap } from './style-tokens';

/**
 * Codepoints illegal in XML 1.0 (word/document.xml is plain XML). The `docx`
 * library only escapes `& < >` — it does not strip these — so a raw control
 * character from scraped chat text (e.g. an ANSI escape U+001B in pasted
 * terminal output) makes the produced file malformed and unopenable in Word,
 * even though `export()` reports success.
 *
 * U+0009 (tab), U+000A (LF) and U+000D (CR) are explicitly legal in XML 1.0
 * and are excluded here — stripping them would destroy code block formatting.
 */
// eslint-disable-next-line no-control-regex -- intentionally matching control chars
const XML_ILLEGAL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g;

/**
 * Replace (not strip) XML-1.0-illegal codepoints with U+FFFD.
 *
 * Substitution over stripping: none of these codepoints carry legitimate
 * meaning in prose or code (real whitespace is already excluded above), so
 * there is no content to preserve — but silently deleting bytes from a user's
 * pasted text is exactly the kind of silent loss this bug already causes one
 * layer up. Leaving a visible replacement marker makes the loss visible
 * instead, at the cost of nothing a reader would have wanted to keep.
 */
function xmlSafe(text: string): string {
  return text.replace(XML_ILLEGAL_CHARS, '�');
}

/** `new TextRun`, but with any `text` field sanitized for XML validity first. */
function safeTextRun(options: IRunOptions): TextRun {
  const opts = options as Mutable<IRunOptions>;
  if (typeof opts.text === 'string') {
    opts.text = xmlSafe(opts.text);
  }
  return new TextRun(opts);
}

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
 * Document heading level (1-6) -> docx HeadingLevel.
 *
 * `noUncheckedIndexedAccess` types every number-indexed read as `| undefined`,
 * so the lookup needs a total wrapper. Callers only ever pass 1..6
 * (`DOC_HEADING_LEVEL.title`, or `bodyHeadingLevel`, which clamps
 * to `DOC_HEADING_LEVEL.max`), so the fallback is unreachable in practice.
 */
function docxHeading(docLevel: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  return DOCX_HEADING_BY_LEVEL[docLevel - 1] ?? HeadingLevel.HEADING_6;
}

/**
 * Exports conversations to DOCX (Word) format
 */
export class DocxExporter extends BaseExporter {
  readonly format: ExportFormat = 'docx';
  readonly extension = 'docx';
  readonly mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  /**
   * The size tables for this export, already multiplied by the chosen step.
   * Set once per export (a fresh exporter is built per export), so no run
   * below can be emitted at an unscaled size.
   */
  private sizes = scaleFontSizes(FONT_SIZE_PT);
  private docxSizes = scaleFontSizes(DOCX_FONT_SIZE_PT);

  /** Loaded once per export; null degrades to uncoloured code (R-8). */
  private highlighter: Highlighter | null = null;

  /**
   * Markdown -> sanitized HTML, for prose artifacts. Null when `marked` could
   * not be loaded, in which case a prose artifact falls back to a code block
   * (same fallback as html-exporter).
   */
  private markdown: ((md: string) => string | null) | null = null;

  /**
   * The DOM document used to parse hljs output into tokens.
   *
   * Typed via `typeof globalThis.document`, not `Document`: the `docx` library
   * exports its own `Document` class, which shadows the DOM type in this module.
   */
  private get domDocument(): typeof globalThis.document | undefined {
    return typeof globalThis.document === 'undefined' ? undefined : globalThis.document;
  }

  /**
   * Export selected Q&A pairs to DOCX
   */
  async export(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      this.sizes = scaleFontSizes(FONT_SIZE_PT, options.fontScale);
      this.docxSizes = scaleFontSizes(DOCX_FONT_SIZE_PT, options.fontScale);
      this.highlighter = await loadHighlighter();
      // The renderer inside a prose artifact's fenced code is discarded again by
      // `HtmlContentParser.parseCodeBlock` (it keeps only the plain text and the
      // language class) — `renderCodeBlock` below re-derives highlighting from
      // that, so this callback only needs to be inert, not coloured.
      this.markdown = await loadMarkdownRenderer(null, escapeHtmlText);

      // Convert to structured format (only the selected pairs)
      const structured = ConversationStructureService.toStructured({
        ...conversation,
        pairs: selectedPairs,
      });

      const doc = this.generateDocx(structured, options);
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
  private generateDocx(conversation: StructuredConversation, options: ExportOptions): Document {
    const sections: (Paragraph | Table)[] = [];

    // Title
    sections.push(
      new Paragraph({
        children: [
          safeTextRun({
            text: conversation.title,
            bold: true,
            size: ptToHalfPt(this.docxSizes.title),
          }),
        ],
        heading: docxHeading(DOC_HEADING_LEVEL.title),
        spacing: { after: 300 },
      })
    );

    // Metadata
    if (options.showMetaInfo) {
      sections.push(
        new Paragraph({
          children: [
            safeTextRun({
              text: `${this.getMetadataLabel('platform')}: ${this.formatPlatformName(conversation.platform)}`,
              size: ptToHalfPt(this.sizes.meta),
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
              safeTextRun({
                text: `${this.getMetadataLabel('model')}: ${conversation.model}`,
                size: ptToHalfPt(this.sizes.meta),
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
              safeTextRun({
                text: `${this.getMetadataLabel('dateRange')}: ${dateRange}`,
                size: ptToHalfPt(this.sizes.meta),
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
              safeTextRun({
                text: `${this.getMetadataLabel('exported')}: ${this.formatTimestamp(conversation.createdAt)}`,
                size: ptToHalfPt(this.sizes.meta),
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
            safeTextRun({
              text: `${this.getMetadataLabel('url')}: ${conversation.url}`,
              size: ptToHalfPt(this.sizes.meta),
              color: hexToDocxColor(COLOR.textMuted),
            }),
          ],
          spacing: { after: 300 },
        })
      );
    }

    // Q&A pairs
    const assistantName = this.getRoleName('assistant', conversation.platform);
    // The role label is text on a white page, so take the darkened
    // on-light variant — the same token html's role label uses.
    const assistantColor = brandColorFor(COLOR.brandTextOnLight, conversation.platform);
    const daySeparator = this.daySeparator(options.showMetaInfo);
    const levelMap = buildHeadingLevelMap(
      ConversationStructureService.collectHeadingLevels(conversation)
    );
    for (const pair of conversation.pairs) {
      sections.push(
        ...this.formatPair(pair, options, assistantName, assistantColor, daySeparator, levelMap)
      );
    }

    return new Document({
      title: conversation.title,
      creator: 'AI Chat Exporter',
      styles: {
        default: {
          document: {
            run: {
              font: FONT_FAMILY.body.docx,
              size: ptToHalfPt(this.sizes.body),
            },
          },
          ...this.headingStyles(),
        },
      },
      sections: [
        {
          properties: { page: this.pageProperties(options) },
          footers: { default: this.pageFooter() },
          children: sections,
        },
      ],
    });
  }

  /**
   * Size overrides for Word's built-in `Heading 1`-`Heading 6` styles.
   *
   * Without them a heading's size comes from Word's default stylesheet and
   * stays put while the body text scales — at `large` the body would outgrow
   * `Heading 3` and the outline would read upside down. The values are Word's
   * own defaults, so `normal` renders exactly as it did before this existed.
   */
  /**
   * Page geometry (R-3).
   *
   * DOCX declared no page size at all and took the `docx` library's default
   * regardless of the user's preference, so choosing Letter still produced an A4
   * document. Margins match the pdf's 20/18/16 mm.
   */
  private pageProperties(options: ExportOptions): {
    size: { width: number; height: number };
    margin: { top: number; right: number; bottom: number; left: number };
  } {
    // Word page sizes in twips (1in = 1440).
    const SIZES = {
      a4: { width: 11906, height: 16838 },
      letter: { width: 12240, height: 15840 },
      legal: { width: 12240, height: 20160 },
    } as const;
    const pageSize = options.docxOptions?.pageSize ?? DEFAULT_DOCX_OPTIONS.pageSize;

    return {
      size: SIZES[pageSize],
      margin: {
        top: mmToTwips(20),
        right: mmToTwips(18),
        bottom: mmToTwips(16),
        left: mmToTwips(18),
      },
    };
  }

  /**
   * Footer with the page number as a real Word FIELD, not literal text (R-3), so
   * it renumbers when the document reflows or the reader edits it.
   */
  private pageFooter(): Footer {
    return new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            safeTextRun({
              children: [PageNumber.CURRENT],
              size: ptToHalfPt(this.sizes.meta),
              color: hexToDocxColor(COLOR.textFaint),
            }),
          ],
        }),
      ],
    });
  }

  /**
   * Fully-declared heading styles (R-3).
   *
   * Size alone was already overridden; font and colour are stated now too, so a
   * heading cannot pick up the reader's Normal style or Office theme and change
   * the document's shape between two machines — the problem the design calls out.
   *
   * Deliberately still Word's built-in `Heading N` rather than custom
   * `ChatTitle`/`ChatBody` styles as the design suggests: Word's Navigation Pane,
   * generated tables of contents and heading semantics for screen readers all key
   * off `Heading N`. Renaming would make the document render identically and
   * navigate worse. Declaring the formatting solves the stated problem without
   * that cost.
   */
  private headingStyles(): Record<
    string,
    { run: { size: number; font: string; color: string; bold: boolean } }
  > {
    return Object.fromEntries(
      this.docxSizes.headingByLevel.map((pt, index) => [
        `heading${index + 1}`,
        {
          run: {
            size: ptToHalfPt(pt),
            font: FONT_FAMILY.body.docx,
            color: hexToDocxColor(COLOR.textPrimary),
            bold: true,
          },
        },
      ])
    );
  }

  /**
   * Render the role label, appending a de-emphasized timestamp run when non-empty.
   *
   * `labelColor` is a '#rrggbb' hex — the platform brand colour for the
   * assistant, the user accent for the user — so a docx is identifiable as
   * ChatGPT / Claude / Gemini the way pdf and html already are.
   *
   * Not a heading (R-1). It used to borrow Word's `Heading 2`, which both
   * rendered it enormous and cost the body its two highest heading levels. The
   * weight is declared here instead: bold, small, brand-coloured. R-3 moves
   * this onto a named `ChatRole` style so it does not depend on Word's
   * paragraph defaults at all.
   */
  private renderRoleLabel(label: string, timestampSuffix: string, labelColor: string): Paragraph {
    const children: TextRun[] = [
      safeTextRun({
        text: label,
        bold: true,
        size: ptToHalfPt(this.sizes.roleLabel),
        color: hexToDocxColor(labelColor),
      }),
    ];
    if (timestampSuffix) {
      children.push(
        safeTextRun({
          text: timestampSuffix,
          size: ptToHalfPt(this.sizes.meta),
          color: hexToDocxColor(COLOR.textMuted),
        })
      );
    }
    return new Paragraph({
      children,
      spacing: { before: 300, after: 150 },
      keepNext: true, // never strand the role label at the foot of a page
    });
  }

  /**
   * A day-change marker, centred and de-emphasized like the timestamps it
   * replaces. Not a heading: it carries no outline weight.
   */
  private renderDaySeparator(separator: string): Paragraph {
    return new Paragraph({
      children: [
        safeTextRun({
          text: separator,
          size: ptToHalfPt(this.sizes.meta),
          color: hexToDocxColor(COLOR.textMuted),
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 300, after: 150 },
      keepNext: true, // it introduces the message below it; alone at a page foot it is a dead line
    });
  }

  /**
   * Format a single Q&A pair as DOCX paragraphs
   */
  private formatPair(
    pair: StructuredQAPair,
    options: ExportOptions,
    assistantName: string,
    assistantColor: string,
    daySeparator: (date?: Date) => string,
    levelMap: HeadingLevelMap
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
      this.renderRoleLabel(
        this.getRoleName('user'),
        this.formatTimestampSuffix(pair.question.timestamp, options.showMetaInfo),
        COLOR.link
      )
    );

    // User content
    paragraphs.push(...this.renderBlocks(pair.question.blocks, levelMap));

    // Assistant heading
    pushDaySeparator(pair.answer.timestamp);
    paragraphs.push(
      this.renderRoleLabel(
        assistantName,
        this.formatTimestampSuffix(pair.answer.timestamp, options.showMetaInfo),
        assistantColor
      )
    );

    // Assistant content
    paragraphs.push(...this.renderBlocks(pair.answer.blocks, levelMap));

    // Add artifacts if present
    if (pair.answer.metadata?.artifacts && Array.isArray(pair.answer.metadata.artifacts)) {
      const artifactsWithContent = pair.answer.metadata.artifacts.filter((a) => a.content);

      if (artifactsWithContent.length > 0) {
        paragraphs.push(
          new Paragraph({
            text: this.artifactsSectionLabel(),
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 100 },
          })
        );

        for (const artifact of artifactsWithContent) {
          // Artifact title
          paragraphs.push(
            new Paragraph({
              children: [
                safeTextRun({
                  text: artifact.title,
                  bold: true,
                  size: ptToHalfPt(this.docxSizes.artifactTitle),
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
                  safeTextRun({
                    text: `${this.artifactTypeFieldLabel()}: ${artifact.typeLabel}`,
                    italics: true,
                    size: ptToHalfPt(this.sizes.meta),
                  }),
                ],
                spacing: { after: 100 },
              })
            );
          }

          // Artifact content
          // Prose artifacts (type: 'document') render through the same
          // markdown -> HTML -> structured-block pipeline message content
          // uses; code artifacts (including one whose language happens to be
          // 'markdown') stay monospace below.
          const proseBlocks = isProseArtifact(artifact)
            ? this.renderProseArtifact(artifact.content ?? '', levelMap)
            : null;
          if (proseBlocks) {
            paragraphs.push(...proseBlocks);
          } else {
            // Show as monospace code
            const contentLines = (artifact.content || '').split('\n');
            for (const line of contentLines) {
              paragraphs.push(
                new Paragraph({
                  children: [
                    safeTextRun({
                      text: line,
                      font: FONT_FAMILY.code.docx,
                      size: ptToHalfPt(this.sizes.code),
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
            text: this.sourcesSectionLabel(search.query),
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 100 },
          })
        );
        for (const result of search.results) {
          paragraphs.push(
            new Paragraph({
              children: [
                safeTextRun({ text: result.title, size: ptToHalfPt(this.sizes.body) }),
                safeTextRun({
                  text: ` — ${result.url}`,
                  size: ptToHalfPt(this.sizes.meta),
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
   * A prose artifact's content, rendered as real DOCX structure instead of a
   * single unstyled paragraph of raw markdown source.
   *
   * Route: markdown -> sanitized HTML (`marked`) -> structured blocks (the
   * same `HtmlContentParser` message content goes through) -> the existing
   * block renderer below. Returns null when the markdown renderer could not
   * be loaded or there is no content, so the caller falls back to a code
   * block — the same fallback html-exporter uses for prose artifacts.
   */
  private renderProseArtifact(
    content: string,
    levelMap: HeadingLevelMap
  ): (Paragraph | Table)[] | null {
    if (!this.markdown || !content) return null;
    const html = this.markdown(content);
    if (html === null) return null;
    return this.renderBlocks(HtmlContentParser.parse(html), levelMap);
  }

  /**
   * Render structured content blocks to DOCX elements
   */
  private renderBlocks(
    blocks: StructuredContentBlock[],
    levelMap: HeadingLevelMap
  ): (Paragraph | Table)[] {
    const elements: (Paragraph | Table)[] = [];

    for (const block of blocks) {
      switch (block.type) {
        case 'paragraph':
          elements.push(...this.renderParagraph(block.content));
          break;

        case 'heading':
          elements.push(...this.renderHeading(block, levelMap));
          break;

        case 'code':
          elements.push(...this.renderCodeBlock(block.code, block.language));
          break;

        case 'list':
          elements.push(...this.renderList(block, 0));
          break;

        case 'blockquote':
          elements.push(...this.renderBlockquote(block.content, levelMap));
          break;

        case 'hr':
          elements.push(this.renderHorizontalRule());
          break;

        // Word gets no embedded picture here; label it and keep the URL so the
        // image is still reachable.
        case 'image':
          elements.push(
            new Paragraph({
              children: [
                safeTextRun({
                  text: `[Image: ${block.alt || 'image'}] ${block.url}`,
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
                safeTextRun({
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
  private renderHeading(
    block: { level: number; content: InlineContent[] },
    levelMap: HeadingLevelMap
  ): Paragraph[] {
    const textRuns = this.renderInline(block.content);

    if (textRuns.length === 0) {
      return [];
    }

    const heading = docxHeading(bodyHeadingLevel(block.level, levelMap));

    return [
      new Paragraph({
        children: textRuns,
        heading: heading,
        spacing: { before: 250, after: 150 },
        keepNext: true, // a heading stays with the content it introduces
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
            safeTextRun({
              text: language.toUpperCase(),
              size: ptToHalfPt(this.sizes.codeLabel),
              bold: true,
            }),
          ],
          spacing: { before: 100, after: 50 },
          keepNext: true, // the language tag belongs with the code it labels
        })
      );
    }

    // Code block — one TextRun per highlighted token per line (R-8), with an
    // explicit break before each line but the first, since a literal '\n'
    // inside a run is not a line break in OOXML and Word collapses it.
    //
    // The colour goes on the run itself rather than a character style, so it
    // survives in any Word without depending on the document's stylesheet.
    const lines = tokenLines(highlightCode(code, language, this.highlighter, this.domDocument));
    const runs: TextRun[] = [];
    lines.forEach((tokens, lineIndex) => {
      // An empty line still needs a run to carry its break.
      const lineTokens: CodeToken[] = tokens.length > 0 ? tokens : [{ text: '', cls: null }];
      lineTokens.forEach((token, tokenIndex) => {
        runs.push(
          safeTextRun({
            text: token.text,
            font: FONT_FAMILY.code.docx,
            size: ptToHalfPt(this.sizes.code),
            ...(token.cls && { color: hexToDocxColor(CODE_TOKEN_COLOR[token.cls]) }),
            break: lineIndex > 0 && tokenIndex === 0 ? 1 : 0,
          })
        );
      });
    });

    paragraphs.push(
      new Paragraph({
        children: runs,
        spacing: { before: 50, after: 150 },
        keepLines: true, // a code block reads as one unit — do not fragment it
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
        const bulletRun = safeTextRun({ text: `${prefix} ` });

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
  private renderBlockquote(
    content: StructuredContentBlock[],
    levelMap: HeadingLevelMap
  ): (Paragraph | Table)[] {
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
        elements.push(...this.renderBlocks([block], levelMap));
      }
    }

    return elements;
  }

  /**
   * Render a horizontal rule
   */
  private renderHorizontalRule(): Paragraph {
    return new Paragraph({
      children: [safeTextRun({ text: '' })],
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
      // cantSplit: the row never breaks down the middle across a page boundary.
      // tableHeader: Word repeats it at the top of each continuation page, which
      // is its native answer to "header stranded at the foot of a page".
      rows.push(new TableRow({ children: headerCells, cantSplit: true, tableHeader: true }));
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
        rows.push(new TableRow({ children: bodyCells, cantSplit: true }));
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
          options.size = ptToHalfPt(this.sizes.code);
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

        // lo-320b: OMML is Word's native math and the `docx` library does export
        // the builders for it (Math, MathRun, MathSum, MathFraction, …) — but
        // they take a built OMML tree, not a TeX string, so using them means
        // shipping a LaTeX parser. Deliberate fallback: the delimited source in
        // the code font, matching how inline `code` is marked, so it reads as a
        // formula and stays copy-pasteable into a real math tool.
        case 'math':
          options.font = FONT_FAMILY.code.docx;
          break;
      }

      if (overrides) {
        Object.assign(options, overrides);
      }

      return safeTextRun(options);
    });
  }
}
