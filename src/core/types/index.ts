/**
 * Core types re-exports
 */

// Conversation types
export type {
  Platform,
  PlatformInfo,
  Message,
  QAPair,
  Conversation,
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
  PDFExportOptions,
  DOCXExportOptions,
  ExportOptions,
  ExportResult,
  IExporter,
  ExporterFactory,
  ExporterRegistry,
  FormatInfo,
} from './exporter';
export {
  EXPORT_FORMATS,
  DEFAULT_PDF_OPTIONS,
  DEFAULT_DOCX_OPTIONS,
  DEFAULT_EXPORT_OPTIONS,
  FORMAT_INFO,
} from './exporter';

// Config types
export type {
  FilenameVariables,
  UserPreferences,
  PrintOptions,
} from './config';
export {
  DEFAULT_FILENAME_TEMPLATE,
  DEFAULT_PREFERENCES,
  DEFAULT_PRINT_OPTIONS,
} from './config';
