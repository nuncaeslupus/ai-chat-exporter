/**
 * Exporter interfaces and types
 */

import type { Conversation, QAPair } from './conversation';

/**
 * Supported export formats
 */
export type ExportFormat = 'pdf' | 'md' | 'txt' | 'json' | 'docx' | 'html';

/**
 * All available export formats
 */
export const EXPORT_FORMATS: readonly ExportFormat[] = ['pdf', 'md', 'txt', 'json', 'docx', 'html'];

/**
 * Global type-size step for the formats that have a typographic surface
 * (pdf, docx, html).
 *
 * Three steps, not a font picker: the request behind it is "reduce the page
 * count", which a coarse step answers and a free size input only complicates.
 * The factors, and the fact that the step moves the *whole* ramp, live in
 * `exporters/style-tokens.ts`.
 */
export type FontScale = 'compact' | 'normal' | 'large';

/**
 * PDF-specific export options
 */
export interface PDFExportOptions {
  /** Page size */
  pageSize: 'a4' | 'letter' | 'legal';
  /** Page orientation */
  orientation: 'portrait' | 'landscape';
  /** Margins in mm */
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  /** Whether to include page numbers */
  includePageNumbers: boolean;
  /** Image quality (0-1) */
  imageQuality: number;
}

/**
 * Default PDF export options
 */
export const DEFAULT_PDF_OPTIONS: PDFExportOptions = {
  pageSize: 'a4',
  orientation: 'portrait',
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
  includePageNumbers: true,
  imageQuality: 0.92,
};

/**
 * DOCX-specific export options
 */
export interface DOCXExportOptions {
  /** Document title */
  title?: string;
  /** Document author */
  author?: string;
  /** Whether to use styled headings */
  useHeadings: boolean;
  /**
   * Page size, matching `PDFExportOptions.pageSize` (R-3).
   *
   * DOCX previously declared no page size at all and silently took the `docx`
   * library's default regardless of what the user chose, so a Letter preference
   * produced an A4 document.
   */
  pageSize: 'a4' | 'letter' | 'legal';
}

/**
 * Default DOCX export options
 */
export const DEFAULT_DOCX_OPTIONS: DOCXExportOptions = {
  useHeadings: true,
  pageSize: 'a4',
};

/**
 * Export options
 */
export interface ExportOptions {
  /** Export format */
  format: ExportFormat;
  /** Filename (without extension) */
  filename: string;
  /** Whether to include metadata */
  includeMetadata: boolean;
  /** Whether to include timestamps */
  includeTimestamps: boolean;
  /** Type-size step; absent means `normal` (preferences predating the setting) */
  fontScale?: FontScale;
  /** PDF-specific options */
  pdfOptions?: PDFExportOptions;
  /** DOCX-specific options */
  docxOptions?: DOCXExportOptions;
}

/**
 * Default export options
 */
export const DEFAULT_EXPORT_OPTIONS: Omit<ExportOptions, 'filename'> = {
  format: 'md',
  includeMetadata: true,
  includeTimestamps: true,
  fontScale: 'normal',
  pdfOptions: DEFAULT_PDF_OPTIONS,
  docxOptions: DEFAULT_DOCX_OPTIONS,
};

/**
 * Export result
 */
export interface ExportResult {
  /** Whether export was successful */
  success: boolean;
  /** Generated file (if successful) */
  blob?: Blob;
  /** Filename with extension */
  filename?: string;
  /** File MIME type */
  mimeType?: string;
  /** Error message (if unsuccessful) */
  error?: string;
}

/**
 * Interface for format-specific exporters
 */
export interface IExporter {
  /** Export format this exporter handles */
  readonly format: ExportFormat;

  /** File extension (without dot) */
  readonly extension: string;

  /** MIME type for the export */
  readonly mimeType: string;

  /**
   * Export selected Q&A pairs from a conversation
   */
  export(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult>;

  /**
   * Validate options for this exporter
   */
  validateOptions(options: ExportOptions): boolean;
}

/**
 * Exporter factory function type.
 *
 * Async because each factory `import()`s its exporter on demand -- jsPDF and
 * docx are ~700 KB together and must not sit in the content script bundle.
 */
export type ExporterFactory = () => Promise<IExporter>;

/**
 * Exporter registry type
 */
export type ExporterRegistry = Map<ExportFormat, ExporterFactory>;

/**
 * Export format display information
 */
export interface FormatInfo {
  /** Format identifier */
  format: ExportFormat;
  /** Human-readable label */
  label: string;
  /** File extension */
  extension: string;
  /** MIME type */
  mimeType: string;
  /** Optional icon identifier */
  icon?: string;
}

/**
 * Format information for all export types
 */
export const FORMAT_INFO: Record<ExportFormat, FormatInfo> = {
  pdf: {
    format: 'pdf',
    label: 'PDF Document',
    extension: 'pdf',
    mimeType: 'application/pdf',
  },
  md: {
    format: 'md',
    label: 'Markdown',
    extension: 'md',
    mimeType: 'text/markdown',
  },
  txt: {
    format: 'txt',
    label: 'Plain Text',
    extension: 'txt',
    mimeType: 'text/plain',
  },
  json: {
    format: 'json',
    label: 'JSON',
    extension: 'json',
    mimeType: 'application/json',
  },
  docx: {
    format: 'docx',
    label: 'Word Document',
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  html: {
    format: 'html',
    label: 'HTML Document',
    extension: 'html',
    mimeType: 'text/html',
  },
};
