/**
 * Core conversation data types
 */

/**
 * Supported chatbot platforms
 */
export type Platform = 'chatgpt' | 'claude' | 'gemini' | 'mistral' | 'grok';

/**
 * Platform information
 */
export interface PlatformInfo {
  /** Platform identifier */
  id: Platform;
  /** Human-readable platform name */
  name: string;
  /** URL patterns that match this platform */
  urlPatterns: RegExp[];
  /** Optional icon identifier */
  icon?: string;
}

/**
 * Artifact/Canvas content (Claude-specific)
 */
export interface Artifact {
  /** Artifact type (e.g., 'image', 'react', 'document', 'diagram', 'code') */
  type: string;
  /** Artifact title */
  title: string;
  /** Artifact content type label (e.g., 'Imagen', 'Artefacto interactivo') */
  typeLabel?: string;
  /** Artifact language/format (e.g., 'svg', 'react', 'markdown', 'mermaid') */
  language?: string;
  /** Artifact content (code, SVG, markdown, etc.) */
  content?: string;
}

/**
 * Web search results (Claude-specific)
 */
export interface WebSearchResult {
  /** Search query */
  query: string;
  /** Number of results */
  resultCount?: number;
  /** Individual search results */
  results?: {
    title: string;
    url: string;
    favicon?: string;
    domain?: string;
  }[];
}

/**
 * Message metadata with typed fields for platform-specific features
 */
export interface MessageMetadata {
  /** Images in the message */
  images?: {
    src: string;
    alt?: string;
    width?: number;
    height?: number;
  }[];
  /** Artifacts/Canvases (Claude) */
  artifacts?: Artifact[];
  /** Web search results (Claude) */
  webSearches?: WebSearchResult[];
  /** Deep research info (ChatGPT) */
  research?: {
    duration: string;
    sources: number;
    searches: number;
  };
  /** Other platform-specific metadata */
  [key: string]: unknown;
}

/**
 * Represents a single message in a conversation
 */
export interface Message {
  /** Unique identifier for the message */
  id: string;
  /** Role of the message sender */
  role: 'user' | 'assistant' | 'system';
  /** Plain text content of the message */
  content: string;
  /** HTML content for rich formatting (optional) */
  htmlContent?: string;
  /** Timestamp of the message */
  timestamp?: Date;
  /** Additional metadata (model info, tokens, etc.) */
  metadata?: MessageMetadata;
}

/**
 * Represents a Q&A pair (user question + assistant response)
 */
export interface QAPair {
  /** Unique identifier for the pair */
  id: string;
  /** Index in the conversation (0-based) */
  index: number;
  /** User's question/prompt */
  question: Message;
  /** Assistant's response */
  answer: Message;
  /** Whether this pair is selected for export */
  selected: boolean;
}

/**
 * Represents a complete conversation
 */
export interface Conversation {
  /** Unique identifier for the conversation */
  id: string;
  /** Conversation title (from page or generated) */
  title: string;
  /** Platform where the conversation occurred */
  platform: Platform;
  /** Model used (if detectable) */
  model?: string;
  /** All Q&A pairs in the conversation */
  pairs: QAPair[];
  /** Conversation URL */
  url: string;
  /** Conversation creation timestamp */
  createdAt?: Date;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}
