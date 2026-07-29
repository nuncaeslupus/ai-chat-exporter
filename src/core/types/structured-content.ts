/**
 * Structured content types for rich conversation formatting
 */

import type { MessageMetadata } from './conversation';

/**
 * Base content block
 */
export interface ContentBlock {
  type: string;
}

/**
 * Paragraph with inline formatting
 */
export interface ParagraphBlock extends ContentBlock {
  type: 'paragraph';
  content: InlineContent[];
}

/**
 * Code block
 */
export interface CodeBlock extends ContentBlock {
  type: 'code';
  language: string;
  code: string;
}

/**
 * Heading
 */
export interface HeadingBlock extends ContentBlock {
  type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  content: InlineContent[];
}

/**
 * List (ordered or unordered)
 */
export interface ListBlock extends ContentBlock {
  type: 'list';
  ordered: boolean;
  items: ListItem[];
}

/**
 * List item
 */
export interface ListItem {
  content: InlineContent[];
  nested?: ListBlock;
}

/**
 * Blockquote
 */
export interface BlockquoteBlock extends ContentBlock {
  type: 'blockquote';
  content: StructuredContentBlock[];
}

/**
 * Horizontal rule
 */
export interface HorizontalRuleBlock extends ContentBlock {
  type: 'hr';
}

/**
 * Image
 */
export interface ImageBlock extends ContentBlock {
  type: 'image';
  url: string;
  alt: string;
  title?: string;
  width?: number;
  height?: number;
  linkUrl?: string; // href of a wrapping <a>, when the image is a link
}

/**
 * Playable media (generated video / audio).
 *
 * Images keep their own `ImageBlock` — every exporter can embed or link a still
 * image, while video and audio can only be played by HTML. Splitting them keeps
 * the PDF/DOCX image-embedding path from ever being handed a video URL.
 */
export interface MediaBlock extends ContentBlock {
  type: 'media';
  kind: 'video' | 'audio';
  url: string;
  alt: string;
  mimeType?: string;
  /** Duration in seconds, when the source exposes one */
  duration?: number;
}

/**
 * Table
 */
export interface TableBlock extends ContentBlock {
  type: 'table';
  headers: InlineContent[][];
  rows: InlineContent[][][];
}

/**
 * All possible content blocks
 */
export type StructuredContentBlock =
  | ParagraphBlock
  | CodeBlock
  | HeadingBlock
  | ListBlock
  | BlockquoteBlock
  | HorizontalRuleBlock
  | ImageBlock
  | MediaBlock
  | TableBlock;

/**
 * Inline content (text with formatting)
 */
export interface InlineContent {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link' | 'strikethrough' | 'math';
  /**
   * For `math`, the **delimited** LaTeX source (`$E = mc^2$`, `$$\sum x$$`) —
   * not the bare TeX. No format can typeset math without KaTeX/MathJax, which
   * the eager content-script bundle can't afford (PR #42), so preserving the
   * source verbatim is the representation. Delimiting it once here, at the
   * parser, rather than once per exporter means the plain-text paths that never
   * touch an exporter (`Message.content`, json's `content`) are self-describing
   * too, and a format that forgets to add a `math` case still emits valid
   * delimited LaTeX from its `default:` branch instead of reintroducing the bug.
   */
  text: string;
  url?: string; // For links
  /** `math` only: which delimiter pair `text` carries, so formats can differ. */
  display?: 'inline' | 'block';
  children?: InlineContent[]; // For nested formatting
}

/**
 * Structured message with rich content
 */
export interface StructuredMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  /** Absent when the source message carries no real timestamp (see D-18). */
  timestamp?: Date;
  blocks: StructuredContentBlock[];
  metadata?: MessageMetadata;
}

/**
 * Structured Q&A pair
 */
export interface StructuredQAPair {
  id: string;
  index: number;
  question: StructuredMessage;
  answer: StructuredMessage;
  selected: boolean;
}

/**
 * Structured conversation
 */
export interface StructuredConversation {
  id: string;
  title: string;
  platform: string;
  model?: string;
  url: string;
  createdAt: Date;
  pairs: StructuredQAPair[];
}
