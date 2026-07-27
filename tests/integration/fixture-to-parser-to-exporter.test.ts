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
    // jsPDF is used here without stream compression, so the literal text
    // operands (e.g. "(some text) Tj") remain readable in the raw bytes.
    return buffer.toString('latin1');
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
  includeMetadata: true,
  includeTimestamps: true,
});

describe('fixture -> parser -> every exporter', () => {
  // The pristine, unmodified real parser output. Used for every exporter
  // except pdf, which hangs on it -- see the dedicated 'PDF export' block.
  let conversation: Conversation;
  let selectedPairs: QAPair[];

  // A second, independent parse of the *same* fixture, with one field
  // stripped from the real output before exporting. Needed only to get PDF's
  // own text-rendering paths (headings-as-text, artifact code, web search)
  // under test despite the hang documented below -- see that block for why.
  let pdfSafeConversation: Conversation;
  let pdfSafeSelectedPairs: QAPair[];

  beforeAll(() => {
    conversation = parseComprehensiveFixture();
    selectedPairs = conversation.pairs.filter((pair) => pair.selected);

    pdfSafeConversation = parseComprehensiveFixture();
    delete pdfSafeConversation.pairs[0]?.answer.metadata?.images;
    pdfSafeSelectedPairs = pdfSafeConversation.pairs.filter((pair) => pair.selected);
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
    // FINDING (new, not one of the pre-queued bugs): PdfExporter never
    // resolves for this real, unmodified fixture.
    //
    // Root cause: the SVG artifact in comprehensive.html embeds an inline
    // preview <img src="data:image/svg+xml,..."> inside its code panel.
    // ChatGPTParser.extractImages() (src/core/parsers/chatgpt/parser.ts)
    // scans the *entire* assistant turn for <img> tags, so it scoops up that
    // decorative artifact-preview image and adds it to
    // message.metadata.images as if it were a real conversation image. This
    // is the same misclassification behind the already-queued lo-45b2
    // ("artifacts rendered twice"): ConversationStructureService pushes an
    // extra image block for it, so the artifact's picture is duplicated.
    //
    // For PDF specifically the symptom is worse than a duplicate: PdfExporter
    // -> loadImagesParallel -> loadImageAsDataUrl (src/core/utils/image-
    // loader.ts) does `new Image(); img.onload = ...; img.src = url` to
    // actually decode the image before embedding it, and that promise never
    // settles for this data URI in this environment -- export() never
    // returns. Verified below with a bounded race instead of letting it hang
    // the whole suite.
    it('hangs indefinitely on the real, unmodified fixture (known bug, related to lo-45b2)', async () => {
      const TIMED_OUT = Symbol('timed-out');
      const exporter = exporterRegistry.get('pdf')!();

      const raced = await Promise.race([
        exporter.export(conversation, selectedPairs, EXPORT_OPTIONS('pdf')),
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(TIMED_OUT);
          }, 1000);
        }),
      ]);

      expect(raced).toBe(TIMED_OUT);
    }, 3000);

    it('exports fine once the misclassified artifact-preview image is removed', async () => {
      const exporter = exporterRegistry.get('pdf')!();
      const result = await exporter.export(
        pdfSafeConversation,
        pdfSafeSelectedPairs,
        EXPORT_OPTIONS('pdf')
      );
      expect(result.success, result.error).toBe(true);
    });
  });

  it('parses the ChatGPT capture and exports it to every format without throwing', async () => {
    for (const [format, factory] of exporterRegistry) {
      // pdf uses the image-stripped copy; the unmodified-fixture hang is
      // covered by the dedicated test above.
      const conv = format === 'pdf' ? pdfSafeConversation : conversation;
      const pairs = format === 'pdf' ? pdfSafeSelectedPairs : selectedPairs;

      const exporter = factory();
      const result = await exporter.export(conv, pairs, EXPORT_OPTIONS(format));

      expect(result.success, `${format} export failed: ${result.error ?? 'unknown error'}`).toBe(
        true
      );
      expect(result.blob).toBeDefined();
    }
  });

  describe.each(Array.from(exporterRegistry.keys()))('%s exporter', (format) => {
    async function exportFixture() {
      const conv = format === 'pdf' ? pdfSafeConversation : conversation;
      const pairs = format === 'pdf' ? pdfSafeSelectedPairs : selectedPairs;

      const exporter = exporterRegistry.get(format)!();
      const result = await exporter.export(conv, pairs, EXPORT_OPTIONS(format));
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

    if (format === 'html' || format === 'pdf' || format === 'json') {
      it('carries a web-search result URL through', async () => {
        const text = await exportFixture();
        expect(text).toContain('developer.mozilla.org');
      });
    } else {
      // Known bug lo-23fb: web-search titles/URLs are missing from md/txt/docx
      // exports -- those exporters never read metadata.webSearches at all.
      // Asserted here as current (wrong) behaviour so a fix shows up as a
      // test failure that needs lo-23fb's assertion flipped, not a silent gap.
      it('does NOT carry a web-search result URL through (known bug lo-23fb)', async () => {
        const text = await exportFixture();
        expect(text).not.toContain('developer.mozilla.org');
      });
    }
  });
});
