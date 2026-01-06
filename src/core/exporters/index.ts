/**
 * Exporter module exports and registry
 */

import type { ExportFormat, ExporterFactory, ExporterRegistry } from '../types';
import { StructuredMarkdownExporter } from './structured-md-exporter';
import { TextExporter } from './txt-exporter';
import { JsonExporter } from './json-exporter';
import { PdfExporter } from './pdf-exporter';
import { DocxExporter } from './docx-exporter';
import { HtmlExporter } from './html-exporter';

// Re-export exporters
export { BaseExporter } from './base-exporter';
export { StructuredMarkdownExporter } from './structured-md-exporter';
export { TextExporter } from './txt-exporter';
export { JsonExporter } from './json-exporter';
export { PdfExporter } from './pdf-exporter';
export { DocxExporter } from './docx-exporter';
export { HtmlExporter } from './html-exporter';

/**
 * Registry of available exporters
 */
export const exporterRegistry: ExporterRegistry = new Map<ExportFormat, ExporterFactory>([
  ['md', () => new StructuredMarkdownExporter()],
  ['txt', () => new TextExporter()],
  ['json', () => new JsonExporter()],
  ['pdf', () => new PdfExporter()],
  ['docx', () => new DocxExporter()],
  ['html', () => new HtmlExporter()],
]);

/**
 * Get an exporter for the specified format
 */
export function getExporter(format: ExportFormat): ReturnType<ExporterFactory> | null {
  const factory = exporterRegistry.get(format);
  return factory ? factory() : null;
}

/**
 * Get all available export formats
 */
export function getAvailableFormats(): ExportFormat[] {
  return Array.from(exporterRegistry.keys());
}
