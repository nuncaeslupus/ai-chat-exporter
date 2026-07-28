/**
 * Structured content types for rich conversation formatting
 */

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
  | TableBlock;

/**
 * Inline content (text with formatting)
 */
export interface InlineContent {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link' | 'strikethrough';
  text: string;
  url?: string; // For links
  children?: InlineContent[]; // For nested formatting
}

/**
 * Structured message with rich content
 */
export interface StructuredMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: Date;
  blocks: StructuredContentBlock[];
  metadata?: {
    artifacts?: any[];
    webSearches?: any[];
    images?: any[];
    [key: string]: any;
  };
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
