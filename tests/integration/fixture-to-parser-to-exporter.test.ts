/**
 * Integration test: real fixture -> real parser -> every registered exporter.
 *
 * Unit suites test parsers and exporters in isolation: exporters are fed
 * hand-built `Conversation` objects (tests/utils/exporter-helpers.ts), never
 * the actual output of a parser. That leaves the seam between "what a parser
 * emits" and "what an exporter expects" completely uncovered. This suite
 * closes that gap: it parses a real DOM fixture and feeds the *real* parser
 * output straight into every exporter in `exporterRegistry`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { join } from 'path';
import JSZip from 'jszip';
import { ChatGPTParser } from '../../src/core/parsers/chatgpt/parser';
import { exporterRegistry } from '../../src/core/exporters';
import type { Conversation, ExportFormat, QAPair } from '../../src/core/types';

/**
 * jsdom's Blob has no text()/arrayBuffer()/stream() -- only FileReader can
 * read it back out (same trick tests/utils/exporter-helpers.ts's blobToText
 * falls back to).
 */
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as ArrayBuffer);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read blob'));
    };
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Whether a PDF is genuinely text-bearing: real embedded fonts plus a
 * `/ToUnicode` CMap, which is what makes a reader able to search, select and
 * copy it rather than treating it as a picture of text.
 *
 * R-2b replaced jsPDF's standard-14 fonts with embedded TrueType. Those write
 * GLYPH IDS (`<0009002000270027> Tj`), not literal text, so the substring
 * assertions this suite used to run against the raw bytes silently stopped
 * matching anything — they were only ever working because uncompressed
 * standard-14 output happens to contain readable operands.
 *
 * Decoding glyph ids back to text needs each font's own bfchar table resolved
 * through the page's font resource dict; merging the tables collides, because
 * glyph 0x0009 means different characters in different fonts. Writing that
 * parser inside a test is not worth it — per-string PDF content is asserted in
 * tests/unit/core/exporters/pdf-exporter.test.ts, which observes the actual
 * `doc.text()` calls via a jsPDF mock (see `textCallsOf`). What this suite adds,
 * and what only it can add, is that the REAL jsPDF produces a well-formed,
 * text-bearing document from real parser output.
 */
function pdfIsTextBearing(buffer: Buffer): { embedsFonts: boolean; searchable: boolean } {
  const raw = buffer.toString('latin1');
  return {
    embedsFonts: raw.includes('/FontFile2'),
    searchable: raw.includes('/ToUnicode') && /<[0-9a-fA-F]{4,}>\s*Tj/.test(raw),
  };
}

/**
 * Decode an ExportResult's blob into a string we can run substring
 * assertions against. Text formats are trivial; the binary formats (pdf,
 * docx) need format-specific decoding since a naive text decode would just
 * return mojibake for them.
 */
async function extractSearchableText(format: ExportFormat, blob: Blob): Promise<string> {
  const buffer = Buffer.from(await blobToArrayBuffer(blob));

  if (format === 'docx') {
    // docx is a zip of XML parts; the visible text lives in word/document.xml.
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    return documentXml ?? '';
  }

  if (format === 'pdf') {
    // Not decodable to text here — see pdfIsTextBearing. Returning '' would make
    // the shared content assertions below pass vacuously, so pdf opts out of
    // them explicitly instead (`describe.each` filter).
    throw new Error('pdf text is asserted via pdfIsTextBearing, not substring search');
  }

  // md, txt, json, html are plain text blobs.
  return buffer.toString('utf-8');
}

function parseComprehensiveFixture(): Conversation {
  // comprehensive.html carries both artifacts (code, SVG) and web-search
  // citations on the same answer, which is exactly the combination the
  // parser suite proves is *extracted* but no suite proves is *exported*.
  const fixturePath = join(__dirname, '../fixtures/dom-snapshots/chatgpt/comprehensive.html');
  const html = readFileSync(fixturePath, 'utf-8');
  const dom = new JSDOM(html, { url: 'https://chatgpt.com/c/test-comprehensive' });
  const parser = new ChatGPTParser(dom.window.document);

  const result = parser.parse();
  if (!result.success || !result.conversation) {
    throw new Error(`Fixture failed to parse: ${result.error ?? 'unknown error'}`);
  }
  return result.conversation;
}

const EXPORT_OPTIONS = (format: ExportFormat) => ({
  format,
  filename: 'integration-test',
  showMetaInfo: true,
});

describe('fixture -> parser -> every exporter', () => {
  // The pristine, unmodified real parser output, used for every exporter
  // including pdf (see the 'PDF export' block below for why that used to be
  // notable).
  let conversation: Conversation;
  let selectedPairs: QAPair[];

  beforeAll(() => {
    conversation = parseComprehensiveFixture();
    selectedPairs = conversation.pairs.filter((pair) => pair.selected);
  });

  it('parsed real output actually carries the metadata this suite depends on', () => {
    // Sanity check on the parser output itself, so a failure below points at
    // the exporter rather than a fixture/parser regression.
    expect(conversation.pairs.length).toBeGreaterThan(0);
    const answer = conversation.pairs[0]?.answer;
    expect(answer?.metadata?.artifacts?.length).toBeGreaterThan(0);
    expect(answer?.metadata?.webSearches?.length).toBeGreaterThan(0);
  });

  describe('PDF export', () => {
    // Was: PdfExporter never resolved for this real, unmodified fixture
    // (lo-4b7f). The SVG artifact in comprehensive.html embeds a decorative
    // inline preview <img src="data:image/svg+xml,..."> inside its code
    // panel; ChatGPTParser.extractImages() used to scoop it up as if it were
    // a real conversation image (the same misclassification lo-45b2 tracks
    // for the duplicate-rendering symptom), and PdfExporter's image loader
    // would then hang forever trying to decode that data URI. Both are now
    // fixed: extractImages() skips artifact-internal images, and
    // loadImageAsDataUrl() times out rather than hanging on any future
    // undecodable image.
    it('exports the real, unmodified fixture without hanging', async () => {
      const exporter = await exporterRegistry.get('pdf')!();
      const result = await exporter.export(conversation, selectedPairs, EXPORT_OPTIONS('pdf'));
      expect(result.success, result.error).toBe(true);
    });

    it('produces a searchable document, not a picture of text', async () => {
      const exporter = await exporterRegistry.get('pdf')!();
      const result = await exporter.export(conversation, selectedPairs, EXPORT_OPTIONS('pdf'));
      const buffer = Buffer.from(await blobToArrayBuffer(result.blob!));
      const { embedsFonts, searchable } = pdfIsTextBearing(buffer);

      // R-2b embeds TrueType so the design's own notation renders at all. The
      // risk it introduces is an unsearchable PDF, which is what /ToUnicode
      // rules out.
      expect(embedsFonts).toBe(true);
      expect(searchable).toBe(true);
    });
  });

  it('parses the ChatGPT capture and exports it to every format without throwing', async () => {
    for (const [format, factory] of exporterRegistry) {
      const exporter = await factory();
      const result = await exporter.export(conversation, selectedPairs, EXPORT_OPTIONS(format));

      expect(result.success, `${format} export failed: ${result.error ?? 'unknown error'}`).toBe(
        true
      );
      expect(result.blob).toBeDefined();
    }
  });

  const textFormats = Array.from(exporterRegistry.keys()).filter((f) => f !== 'pdf');

  describe.each(textFormats)('%s exporter', (format) => {
    async function exportFixture() {
      const exporter = await exporterRegistry.get(format)!();
      const result = await exporter.export(conversation, selectedPairs, EXPORT_OPTIONS(format));
      return extractSearchableText(format, result.blob!);
    }

    it('carries the question text through', async () => {
      const text = await exportFixture();
      expect(text).toContain('Create a comprehensive guide to web development');
    });

    it('carries a code artifact (React component) through', async () => {
      const text = await exportFixture();
      // Real, parser-extracted artifact content -- not a hand-built fixture.
      expect(text).toContain('useState');
    });

    // The fixture answer contains an <h2>/<h3> in its markdown body. But
    // ConversationStructureService.toStructured() intentionally skips
    // HtmlContentParser (and therefore heading/link block parsing) for *any*
    // message that also carries artifacts or web-search metadata -- it falls
    // back to a single plain-text paragraph built from Message.content
    // (see src/core/services/conversation-structure-service.ts, the
    // `hasSpecialContent` branch). Message.content itself is plain
    // `textContent`, with no markdown/HTML re-encoding
    // (src/core/parsers/base-parser.ts extractContent()). So the heading's
    // *text* survives everywhere, but nowhere does it come back out as a
    // heading -- md/txt/html/pdf all render it as an ordinary paragraph line,
    // and docx as an ordinary Paragraph with no heading style. This is a
    // genuine, previously unflagged shape mismatch: any assistant message
    // that also has an artifact or a web search loses ALL rich formatting
    // (headings, bold, links, lists) from its own body text -- parser suite
    // and exporter suite are both green on this. Documented as current
    // (wrong) behaviour rather than silently asserted as correct.
    it('carries the heading text through (but not as a heading -- known gap, see suite header comment)', async () => {
      const text = await exportFixture();
      expect(text).toContain('Web Development Technologies Comparison');
    });

    // lo-23fb is fixed: md/txt/docx now read metadata.webSearches too, so every
    // registered exporter carries cited sources. Keep this asserted for ALL
    // formats -- Gemini Deep Research files its sources in the same field.
    it('carries a web-search result URL through', async () => {
      const text = await exportFixture();
      expect(text).toContain('developer.mozilla.org');
    });
  });
});
