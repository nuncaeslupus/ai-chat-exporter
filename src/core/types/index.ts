/**
 * Core types re-exports
 */

// Conversation types
export type {
  Platform,
  PlatformInfo,
  Message,
  MessageMetadata,
  QAPair,
  Conversation,
  Artifact,
  MediaItem,
  WebSearchResult,
} from './conversation';

// Structured content types
export type {
  ContentBlock,
  ParagraphBlock,
  CodeBlock,
  HeadingBlock,
  ListBlock,
  ListItem,
  BlockquoteBlock,
  HorizontalRuleBlock,
  ImageBlock,
  MediaBlock,
  TableBlock,
  StructuredContentBlock,
  InlineContent,
  StructuredMessage,
  StructuredQAPair,
  StructuredConversation,
} from './structured-content';

// Parser types
export type {
  ParserConfig,
  ParseResult,
  SelectorSet,
  IParser,
  ParserFactory,
  ParserRegistry,
} from './parser';
export { DEFAULT_PARSER_CONFIG } from './parser';

// Exporter types
export type {
  ExportFormat,
  FontScale,
  PDFExportOptions,
  DOCXExportOptions,
  ExportOptions,
  ExportResult,
  IExporter,
  ExporterFactory,
  ExporterRegistry,
} from './exporter';
export { EXPORT_FORMATS, DEFAULT_PDF_OPTIONS, DEFAULT_DOCX_OPTIONS } from './exporter';

// Config types
export type {
  FilenameVariables,
  FilenamePiece,
  FilenamePieceType,
  FilenamePreferences,
  ThemePreference,
} from './config';
export { DEFAULT_FILENAME_PIECES } from './config';

// Claude API types
export type {
  ClaudeApiArtifactInput,
  ClaudeApiToolUseContent,
  ClaudeApiTextContent,
  ClaudeApiContent,
  ClaudeApiChatMessage,
  ClaudeApiConversationResponse,
  ClaudeApiRequest,
} from './claude-api';
export { isArtifactContent } from './claude-api';
