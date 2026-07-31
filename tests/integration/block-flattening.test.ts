/**
 * D-35 integration test: block-level content a structured parser doesn't
 * recognise (a div-based table, two bare adjacent divs, a heading glued to a
 * following list) used to collapse into one unreadable, wordlessly-joined
 * run wherever it hit plain-text flattening -- `BaseParser.extractContent`
 * (src/core/parsers/base-parser.ts) and `HtmlContentParser`'s inline
 * fallback (src/core/services/html-content-parser.ts). Both now delegate to
 * `flattenElementText` (src/core/utils/dom-text.ts), which inserts a
 * boundary between block-level children instead of using raw `textContent`.
 *
 * Fixture answers are run through the real `BaseParser.extractContent` (via
 * a throwaway `GeminiParser`) to get `content`/`htmlContent`, then driven
 * through all six registered exporters -- the corruption was invisible to
 * per-exporter unit suites because none of them fed in *this* kind of
 * markup, and invisible to the existing fixture-to-parser-to-exporter suite
 * because its ChatGPT fixture never contains an unrecognised div-based
 * table.
 */

import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import type { Conversation, ExportFormat, Message, QAPair } from '../../src/core/types';
import { exporterRegistry } from '../../src/core/exporters';
import { GeminiParser } from '../../src/core/parsers/gemini/parser';

// jsPDF does not run under jsdom (see tests/unit/core/exporters/pdf-exporter.test.ts,
// which this mock mirrors). Mocking it here lets the pdf format run through
// this suite too, instead of being the one format nothing checks.
interface PdfCall {
  method: string;
  args: unknown[];
}

const { pdfInstances, MockJsPDF } = vi.hoisted(() => {
  class MockJsPDF {
    calls: PdfCall[] = [];
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    constructor() {
      pdfInstances.push(this);
    }
    private record(method: string, args: unknown[]) {
      this.calls.push({ method, args });
    }
    setFontSize(...a: unknown[]) {
      this.record('setFontSize', a);
    }
    setFont(...a: unknown[]) {
      this.record('setFont', a);
    }
    setTextColor(...a: unknown[]) {
      this.record('setTextColor', a);
    }
    setDrawColor(...a: unknown[]) {
      this.record('setDrawColor', a);
    }
    setFillColor(...a: unknown[]) {
      this.record('setFillColor', a);
    }
    setLineWidth(...a: unknown[]) {
      this.record('setLineWidth', a);
    }
    text(...a: unknown[]) {
      this.record('text', a);
    }
    line(...a: unknown[]) {
      this.record('line', a);
    }
    rect(...a: unknown[]) {
      this.record('rect', a);
    }
    roundedRect(...a: unknown[]) {
      this.record('roundedRect', a);
    }
    addPage(...a: unknown[]) {
      this.record('addPage', a);
    }
    addImage(...a: unknown[]) {
      this.record('addImage', a);
    }
    setPage(...a: unknown[]) {
      this.record('setPage', a);
    }
    getNumberOfPages() {
      return 1;
    }
    splitTextToSize(text: string) {
      return [text];
    }
    addFileToVFS(...a: unknown[]) {
      this.record('addFileToVFS', a);
    }
    addFont(...a: unknown[]) {
      this.record('addFont', a);
    }
    getTextWidth(text: string) {
      return text.length * 2;
    }
    output(type: string) {
      this.record('output', [type]);
      return new Blob(['%PDF-mock'], { type: 'application/pdf' });
    }
  }
  const pdfInstances: InstanceType<typeof MockJsPDF>[] = [];
  return { pdfInstances, MockJsPDF };
});

vi.mock('jspdf', () => ({ jsPDF: MockJsPDF }));
vi.mock('../../src/core/utils/image-loader', () => ({
  loadImagesParallel: async () => new Map(),
}));

/** Every string ever handed to jsPDF's `text()` across every export in this run. */
function pdfRenderedText(): string {
  const strings: string[] = [];
  for (const instance of pdfInstances) {
    for (const call of instance.calls) {
      if (call.method !== 'text') continue;
      const arg = call.args[0];
      if (typeof arg === 'string') strings.push(arg);
      else if (Array.isArray(arg)) {
        strings.push(...arg.filter((x): x is string => typeof x === 'string'));
      }
    }
  }
  return strings.join('\n');
}

/**
 * Strips HTML tags and common markdown emphasis/code markers so the same
 * assertion can run against txt/md/html/docx/json alike -- this suite cares
 * about word-adjacency (joined or spuriously spaced), not per-format markup.
 */
function normalizeProse(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Route fixture content through the REAL `BaseParser.extractContent` (via a
// throwaway GeminiParser instance) rather than hand-building `content`/
// `htmlContent` -- otherwise the json-format cases below would just be
// checking that JsonExporter relays whatever string this file already
// computed, without ever exercising base-parser.ts at all.
type TestableParser = GeminiParser & {
  extractContent: (
    element: Element,
    preserveHtml: boolean
  ) => { content: string; htmlContent?: string };
};

function answerMessage(id: string, html: string): Message {
  const dom = new JSDOM(`<html><body><div id="root">${html}</div></body></html>`, {
    url: 'https://gemini.google.com/app/d35',
  });
  const parser = new GeminiParser(dom.window.document) as TestableParser;
  const element = dom.window.document.getElementById('root')!;
  const { content, htmlContent } = parser.extractContent(element, true);
  return { id, role: 'assistant', content, ...(htmlContent && { htmlContent }) };
}

function pair(index: number, html: string): QAPair {
  return {
    id: `pair-${index}`,
    index,
    selected: true,
    question: { id: `q-${index}`, role: 'user', content: `Question ${index}` },
    answer: answerMessage(`a-${index}`, html),
  };
}

// A div-based grid: no `<table>` tag at all (Gemini's real export renders its
// tax-bracket table this way; see claude-arsenal/queue/lo-a23a.md). Cells sit
// immediately adjacent with no whitespace between tags, exactly as serialized
// DOM does -- pretty-printing this string would hide the bug.
const DIV_TABLE_HTML =
  '<div><div><div>Base Liquidable</div><div>Cuota</div><div>Pct</div></div>' +
  '<div><div>Hasta 6.000 EUR</div><div>0 EUR</div><div>19%</div></div>' +
  '<div><div>Ajuste</div><div>–</div><div>0%</div></div>' +
  '<div><div>Nota</div><div>EUR</div><div>EUR</div></div></div>';

const ADJACENT_DIVS_HTML = '<div>First block</div><div>Second block</div>';

const HEADING_THEN_LIST_HTML = '<h2>Section Title</h2><ul><li>Item one</li><li>Item two</li></ul>';

const INLINE_MID_SENTENCE_HTML =
  '<p>The <strong>quick</strong> fox jumps over the <em>lazy</em> dog.</p>';

function buildConversation(): { conversation: Conversation; pairs: QAPair[] } {
  const pairs = [
    pair(0, DIV_TABLE_HTML),
    pair(1, ADJACENT_DIVS_HTML),
    pair(2, HEADING_THEN_LIST_HTML),
    pair(3, INLINE_MID_SENTENCE_HTML),
  ];
  const conversation: Conversation = {
    id: 'd35-conversation',
    title: 'D-35 block flattening',
    platform: 'gemini',
    pairs,
    url: 'https://gemini.google.com/app/d35',
    createdAt: new Date('2026-07-30T00:00:00Z'),
  };
  return { conversation, pairs };
}

const EXPORT_OPTIONS = (format: ExportFormat) => ({
  format,
  filename: 'd35-test',
  showMetaInfo: true,
});

async function exportText(format: 'md' | 'txt' | 'json' | 'html'): Promise<string> {
  const { conversation, pairs } = buildConversation();
  const exporter = await exporterRegistry.get(format)!();
  const result = await exporter.export(conversation, pairs, EXPORT_OPTIONS(format));
  expect(result.success, result.error).toBe(true);
  return (await result.blob!.text()).toString();
}

async function exportDocxText(): Promise<string> {
  const { conversation, pairs } = buildConversation();
  const exporter = await exporterRegistry.get('docx')!();
  const result = await exporter.export(conversation, pairs, EXPORT_OPTIONS('docx'));
  expect(result.success, result.error).toBe(true);
  // docx is a zip of XML parts; word/document.xml carries the visible text.
  const JSZip = (await import('jszip')).default;
  const buffer = Buffer.from(await result.blob!.arrayBuffer());
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  return documentXml ?? '';
}

async function exportPdfText(): Promise<string> {
  const { conversation, pairs } = buildConversation();
  const exporter = await exporterRegistry.get('pdf')!();
  const result = await exporter.export(conversation, pairs, EXPORT_OPTIONS('pdf'));
  expect(result.success, result.error).toBe(true);
  return normalizeProse(pdfRenderedText());
}

const textFormats: ('md' | 'txt' | 'json' | 'html')[] = ['md', 'txt', 'json', 'html'];

describe('D-35: block-level content never joins across every exporter', () => {
  describe.each(textFormats)('%s exporter', (format) => {
    it('never concatenates cells of a div-based table', async () => {
      const text = normalizeProse(await exportText(format));
      // The hostile pair from the real export: two adjacent cells must not
      // fuse into "0 EUR19%".
      expect(text).not.toContain('0 EUR19%');
      expect(text).toContain('0 EUR');
      expect(text).toContain('19%');
      // Header row cells must not fuse either.
      expect(text).not.toContain('Base LiquidableCuota');
    });

    it('keeps a lone "–" cell distinct from its neighbours', async () => {
      const text = normalizeProse(await exportText(format));
      expect(text).not.toContain('Ajuste–');
      expect(text).not.toContain('–0%');
      expect(text).toContain('–');
    });

    it('keeps identical adjacent cells distinct (not merged into one run)', async () => {
      const text = normalizeProse(await exportText(format));
      expect(text).not.toContain('NotaEUREUR');
      // Both "EUR" cells must still be present as separate words.
      expect(text.match(/EUR/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    });

    it('never concatenates two adjacent block divs', async () => {
      const text = normalizeProse(await exportText(format));
      expect(text).not.toContain('First blockSecond block');
      expect(text).toContain('First block');
      expect(text).toContain('Second block');
    });

    it('never concatenates a heading with the list that follows it', async () => {
      const text = normalizeProse(await exportText(format));
      expect(text).not.toContain('Section TitleItem one');
      expect(text).toContain('Section Title');
      expect(text).toContain('Item one');
    });

    it('does not add spurious spaces around inline elements mid-sentence', async () => {
      const text = normalizeProse(await exportText(format));
      expect(text).toContain('The quick fox jumps over the lazy dog.');
    });
  });

  describe('docx exporter', () => {
    it('never concatenates cells of a div-based table', async () => {
      const text = normalizeProse(await exportDocxText());
      expect(text).not.toContain('0 EUR19%');
      expect(text).toContain('0 EUR');
      expect(text).toContain('19%');
    });

    it('never concatenates two adjacent block divs', async () => {
      const text = normalizeProse(await exportDocxText());
      expect(text).not.toContain('First blockSecond block');
    });

    it('never concatenates a heading with the list that follows it', async () => {
      const text = normalizeProse(await exportDocxText());
      expect(text).not.toContain('Section TitleItem one');
    });

    it('does not add spurious spaces around inline elements mid-sentence', async () => {
      const text = normalizeProse(await exportDocxText());
      expect(text).toContain('The quick fox jumps over the lazy dog.');
    });
  });

  describe('pdf exporter', () => {
    it('never concatenates cells of a div-based table', async () => {
      const text = await exportPdfText();
      expect(text).not.toContain('0 EUR19%');
      expect(text).toContain('0 EUR');
      expect(text).toContain('19%');
    });

    it('never concatenates two adjacent block divs', async () => {
      const text = await exportPdfText();
      expect(text).not.toContain('First blockSecond block');
    });

    it('never concatenates a heading with the list that follows it', async () => {
      const text = await exportPdfText();
      expect(text).not.toContain('Section TitleItem one');
    });

    it('does not add spurious spaces around inline elements mid-sentence', async () => {
      const text = await exportPdfText();
      expect(text).toContain('The quick fox jumps over the lazy dog.');
    });
  });
});
