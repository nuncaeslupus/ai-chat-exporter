/**
 * Exporter registry
 *
 * Every factory `import()`s its exporter on demand so the bundler emits one
 * chunk per format. The content script is injected into every page load, so
 * jsPDF, docx and friends must not be part of its eager bundle.
 *
 * Import the concrete exporter classes from their own modules
 * (`./pdf-exporter`, ...) -- this barrel deliberately does not re-export them,
 * because a retained static re-export would pull them back into the eager
 * graph and defeat the split.
 */

import type { ExportFormat, ExporterFactory, ExporterRegistry, IExporter } from '../types';

export { BaseExporter } from './base-exporter';

/**
 * Registry of available exporters
 */
export const exporterRegistry: ExporterRegistry = new Map<ExportFormat, ExporterFactory>([
  ['md', async () => new (await import('./structured-md-exporter')).StructuredMarkdownExporter()],
  ['txt', async () => new (await import('./txt-exporter')).TextExporter()],
  ['json', async () => new (await import('./json-exporter')).JsonExporter()],
  ['pdf', async () => new (await import('./pdf-exporter')).PdfExporter()],
  ['docx', async () => new (await import('./docx-exporter')).DocxExporter()],
  ['html', async () => new (await import('./html-exporter')).HtmlExporter()],
]);

/**
 * Get an exporter for the specified format
 */
export async function getExporter(format: ExportFormat): Promise<IExporter | null> {
  const factory = exporterRegistry.get(format);
  return factory ? await factory() : null;
}

/**
 * Get all available export formats
 */
export function getAvailableFormats(): ExportFormat[] {
  return Array.from(exporterRegistry.keys());
}
