/**
 * Configuration types for user preferences
 */

import type { ExportFormat } from './exporter';
import { DEFAULT_PDF_OPTIONS, DEFAULT_DOCX_OPTIONS } from './exporter';
import type { PDFExportOptions, DOCXExportOptions } from './exporter';

/**
 * Filename template variables
 */
export interface FilenameVariables {
  /** Platform name (e.g., "ChatGPT") */
  platform: string;
  /** Conversation title */
  title: string;
  /** Date in YYYY-MM-DD format */
  date: string;
  /** Time in HH-MM format */
  time: string;
  /** Full datetime in YYYY-MM-DD_HH-MM format */
  datetime: string;
  /** Model name if available */
  model?: string;
}

/**
 * Default filename template
 * Example: "{platform}_{title}_{datetime}" -> "ChatGPT_My-Conversation_2025-01-01_14-30"
 */
export const DEFAULT_FILENAME_TEMPLATE = '{platform}_{title}_{datetime}';

/**
 * User preferences stored in extension storage
 */
export interface UserPreferences {
  /** Default export format */
  defaultFormat: ExportFormat;
  /** Default filename template */
  filenameTemplate: string;
  /** Whether to remember selections between sessions */
  rememberSelections: boolean;
  /** PDF default options */
  pdfDefaults: PDFExportOptions;
  /** DOCX default options */
  docxDefaults: DOCXExportOptions;
  /** Show confirmation before export */
  showConfirmation: boolean;
}

/**
 * Default user preferences
 */
export const DEFAULT_PREFERENCES: UserPreferences = {
  defaultFormat: 'md',
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
  rememberSelections: false,
  pdfDefaults: DEFAULT_PDF_OPTIONS,
  docxDefaults: DEFAULT_DOCX_OPTIONS,
  showConfirmation: true,
};

/**
 * Print options
 */
export interface PrintOptions {
  /** Whether to include metadata header */
  includeMetadata: boolean;
  /** Whether to include timestamps */
  includeTimestamps: boolean;
  /** Paper size */
  paperSize: 'a4' | 'letter' | 'legal';
  /** Orientation */
  orientation: 'portrait' | 'landscape';
}

/**
 * Default print options
 */
export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  includeMetadata: true,
  includeTimestamps: false,
  paperSize: 'a4',
  orientation: 'portrait',
};
