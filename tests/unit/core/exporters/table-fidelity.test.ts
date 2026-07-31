/**
 * EXP-4: a two-row `<thead>` was flattened into one row by appending CELLS
 * instead of rows (doubling the reported column count), and `colspan`/
 * `rowspan` were ignored entirely, so a merged-cell table put values under
 * the wrong heading in every format. `tests/unit/core/services/
 * html-content-parser.test.ts` proves the parser-level mapping; this file
 * proves the same mapping survives every exporter that can render a table
 * (md/html/docx), and that txt/pdf -- which can't show a real span -- fail
 * *visibly* (a blank cell in the right place) instead of silently
 * misattributing a value. No assertion here is about styling.
 */

import { describe, it, expect, vi } from 'vitest';
import { marked, type Tokens } from 'marked';
import { JSDOM } from 'jsdom';
import type { Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { PdfExporter } from '../../../../src/core/exporters/pdf-exporter';
import { blobToText } from '../../../utils/exporter-helpers';
import { docxRunText, extractDocxEntry } from '../../../utils/docx-helpers';

interface Call {
  method: string;
  args: unknown[];
}

const { instances, MockJsPDF } = vi.hoisted(() => {
  class MockJsPDF {
    calls: Call[] = [];
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };

    constructor(_options: unknown) {
      instances.push(this);
    }

    private record(method: string, args: unknown[]) {
      this.calls.push({ method, args });
    }

    setFontSize(...args: unknown[]) {
      this.record('setFontSize', args);
    }
    setFont(...args: unknown[]) {
      this.record('setFont', args);
    }
    setTextColor(...args: unknown[]) {
      this.record('setTextColor', args);
    }
    setDrawColor(...args: unknown[]) {
      this.record('setDrawColor', args);
    }
    setFillColor(...args: unknown[]) {
      this.record('setFillColor', args);
    }
    setLineWidth(...args: unknown[]) {
      this.record('setLineWidth', args);
    }
    text(...args: unknown[]) {
      this.record('text', args);
    }
    line(...args: unknown[]) {
      this.record('line', args);
    }
    rect(...args: unknown[]) {
      this.record('rect', args);
    }
    roundedRect(...args: unknown[]) {
      this.record('roundedRect', args);
    }
    addPage(...args: unknown[]) {
      this.record('addPage', args);
    }
    addImage(...args: unknown[]) {
      this.record('addImage', args);
    }
    setPage(...args: unknown[]) {
      this.record('setPage', args);
    }
    getNumberOfPages() {
      return 1;
    }
    // No wrapping -- keeps the exact strings PdfExporter asked to render
    // visible to the assertions below instead of split into fragments.
    splitTextToSize(text: string) {
      return [text];
    }
    addFileToVFS(...args: unknown[]) {
      this.record('addFileToVFS', args);
    }
    addFont(...args: unknown[]) {
      this.record('addFont', args);
    }
    getTextWidth(text: string) {
      return text.length * 2;
    }
    output(type: string) {
      this.record('output', [type]);
      return new Blob(['%PDF-mock'], { type: 'application/pdf' });
    }
  }

  const instances: InstanceType<typeof MockJsPDF>[] = [];
  return { instances, MockJsPDF };
});

vi.mock('jspdf', () => ({ jsPDF: MockJsPDF }));

vi.mock('../../../../src/core/utils/image-loader', () => ({
  loadImagesParallel: async () => new Map(),
}));

// The exact scenario from the review finding: a 3-column table where column
// A's first cell spans two rows, and the last row's first cell spans two
// columns. Single header row -- the two-row-thead case is covered by its own
// scenario below.
const HTML_MIXED_SPANS =
  '<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>' +
  '<tbody>' +
  '<tr><td rowspan="2">x</td><td>1</td><td>2</td></tr>' +
  '<tr><td>3</td><td>4</td></tr>' +
  '<tr><td colspan="2">merged</td><td>9</td></tr>' +
  '</tbody></table>';

// A two-row <thead>: a primary label row over a units row, exactly the
// Gemini tax-table shape referenced by the finding.
const HTML_TWO_ROW_HEADER =
  '<table><thead>' +
  '<tr><th>Region</th><th>Q1</th></tr>' +
  '<tr><th>(EUR)</th><th>(EUR)</th></tr>' +
  '</thead><tbody>' +
  '<tr><td>EMEA</td><td>10</td></tr>' +
  '</tbody></table>';

function buildPair(htmlContent: string): QAPair {
  return {
    id: 'pair-0',
    index: 0,
    selected: true,
    question: {
      id: 'q-0',
      role: 'user',
      content: 'question',
      timestamp: new Date('2025-01-01T12:00:00Z'),
    },
    answer: {
      id: 'a-0',
      role: 'assistant',
      content: 'fallback',
      htmlContent,
      timestamp: new Date('2025-01-01T12:00:00Z'),
    },
  } as unknown as QAPair;
}

function buildConversation(pair: QAPair): Conversation {
  return {
    id: 'test-conversation',
    title: 'Table Fidelity Test',
    platform: 'claude',
    model: 'claude-3',
    pairs: [pair],
    url: 'https://claude.ai/chat/table-fidelity-test',
    createdAt: new Date('2025-01-01T12:00:00Z'),
  } as unknown as Conversation;
}

const baseOptions: ExportOptions = { format: 'md', filename: 'test', showMetaInfo: false };

describe('EXP-4: value-under-heading fidelity — md/html/docx can express the mapping', () => {
  describe('md', () => {
    async function renderTable(html: string): Promise<Tokens.Table> {
      const pair = buildPair(html);
      const conversation = buildConversation(pair);
      const result = await new StructuredMarkdownExporter().export(conversation, [pair], {
        ...baseOptions,
        format: 'md',
      });
      const text = await blobToText(result.blob!);
      const tokens = marked.lexer(text);
      const table = tokens.find((t) => t.type === 'table') as Tokens.Table | undefined;
      expect(table).toBeDefined();
      return table!;
    }

    it('keeps a merged-cell row aligned: header count matches row count, values under their own column', async () => {
      const table = await renderTable(HTML_MIXED_SPANS);

      // RED (pre-fix): a 3-header / 2-cell body row is a malformed GFM table;
      // the ragged rows("3","4" and "merged","9") shifted every trailing
      // value one column left of its heading once `marked` re-parsed it.
      expect(table.header).toHaveLength(3);
      expect(table.rows.every((row) => row.length === 3)).toBe(true);

      expect(table.rows[1]?.[0]?.text).toBe(''); // blank under A (rowspan continuation)
      expect(table.rows[1]?.[1]?.text).toBe('3'); // under B, not A
      expect(table.rows[1]?.[2]?.text).toBe('4'); // under C, not B
      expect(table.rows[2]?.[0]?.text).toBe('merged'); // under A
      expect(table.rows[2]?.[1]?.text).toBe(''); // blank under B (colspan continuation)
      expect(table.rows[2]?.[2]?.text).toBe('9'); // under C, not B
    });

    it('merges a two-row thead into one composite header instead of doubling the column count', async () => {
      const table = await renderTable(HTML_TWO_ROW_HEADER);

      // RED (pre-fix): 4 header cells over a 2-cell body row.
      expect(table.header).toHaveLength(2);
      expect(table.header.map((h) => h.text)).toEqual(['Region (EUR)', 'Q1 (EUR)']);
      expect(table.rows[0]?.[0]?.text).toBe('EMEA');
      expect(table.rows[0]?.[1]?.text).toBe('10');
    });
  });

  describe('html', () => {
    async function renderTableCells(
      html: string
    ): Promise<{ headers: string[]; rows: string[][] }> {
      const pair = buildPair(html);
      const conversation = buildConversation(pair);
      const result = await new HtmlExporter().export(conversation, [pair], {
        ...baseOptions,
        format: 'html',
      });
      const text = await blobToText(result.blob!);
      const dom = new JSDOM(text);
      const table = dom.window.document.querySelector('table');
      expect(table).not.toBeNull();
      const headers = Array.from(table!.querySelectorAll('thead th')).map(
        (th) => th.textContent ?? ''
      );
      const rows = Array.from(table!.querySelectorAll('tbody tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? '')
      );
      return { headers, rows };
    }

    it('keeps a merged-cell row aligned: no value drawn under the wrong <th>', async () => {
      const { headers, rows } = await renderTableCells(HTML_MIXED_SPANS);

      expect(headers).toEqual(['A', 'B', 'C']);
      expect(rows[1]).toEqual(['', '3', '4']);
      expect(rows[2]).toEqual(['merged', '', '9']);
    });

    it('merges a two-row thead into one composite header row', async () => {
      const { headers, rows } = await renderTableCells(HTML_TWO_ROW_HEADER);

      expect(headers).toEqual(['Region (EUR)', 'Q1 (EUR)']);
      expect(rows[0]).toEqual(['EMEA', '10']);
    });
  });

  describe('docx', () => {
    /** Split one `<w:tr>…</w:tr>` body into its `<w:tc>` cells' plain text. */
    function cellsOf(rowXml: string): string[] {
      return rowXml
        .split('<w:tc>')
        .slice(1)
        .map((c) => docxRunText(c.split('</w:tc>')[0] ?? ''));
    }

    async function renderRows(html: string): Promise<string[][]> {
      const pair = buildPair(html);
      const conversation = buildConversation(pair);
      const result = await new DocxExporter().export(conversation, [pair], {
        ...baseOptions,
        format: 'docx',
      });
      const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
      return xml
        .split('<w:tr>')
        .slice(1)
        .map((r) => cellsOf(r.split('</w:tr>')[0] ?? ''));
    }

    it('keeps a merged-cell row aligned: no value in the wrong table cell', async () => {
      const rows = await renderRows(HTML_MIXED_SPANS);

      expect(rows[0]).toEqual(['A', 'B', 'C']); // header row
      expect(rows[2]).toEqual(['', '3', '4']); // row 2 of the body
      expect(rows[3]).toEqual(['merged', '', '9']); // row 3 of the body
    });

    it('merges a two-row thead into one composite header row', async () => {
      const rows = await renderRows(HTML_TWO_ROW_HEADER);

      expect(rows[0]).toEqual(['Region (EUR)', 'Q1 (EUR)']);
      expect(rows[1]).toEqual(['EMEA', '10']);
    });
  });
});

describe('EXP-4: txt/pdf cannot show a real span, so they must degrade visibly (blank), not misalign', () => {
  describe('txt', () => {
    /** One boxed `| a | b | c |` row, split and trimmed into its cells. */
    function cellsOf(line: string): string[] {
      return line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
    }

    it('shows a blank cell for a rowspan/colspan continuation instead of shifting later values left', async () => {
      const pair = buildPair(HTML_MIXED_SPANS);
      const conversation = buildConversation(pair);
      const result = await new TextExporter().export(conversation, [pair], {
        ...baseOptions,
        format: 'txt',
      });
      const text = await blobToText(result.blob!);
      const rowLines = text.split('\n').filter((l) => /^\|.*\|$/.test(l));

      // RED (pre-fix): "3"/"4" and "merged"/"9" rows had one fewer cell than
      // the header, and the boxed layout drew them left-justified into
      // columns A/B instead of their real columns B/C and A/C.
      expect(rowLines.map(cellsOf)).toContainEqual(['', '3', '4']);
      expect(rowLines.map(cellsOf)).toContainEqual(['merged', '', '9']);
    });
  });

  describe('pdf', () => {
    it('draws a rowspan/colspan continuation value at its own column x, not an earlier column', async () => {
      instances.length = 0;
      const pair = buildPair(HTML_MIXED_SPANS);
      const conversation = buildConversation(pair);
      await new PdfExporter().export(conversation, [pair], { ...baseOptions, format: 'pdf' });
      const instance = instances[0]!;

      const xOf = (value: string): number | undefined => {
        const call = instance.calls.find((c) => c.method === 'text' && c.args[0] === value);
        return call?.args[1] as number | undefined;
      };

      // RED (pre-fix): "3" and "4" were drawn at columns A/B's x positions
      // (one column left of where they belong), and "9" at column B's x
      // instead of column C's.
      expect(xOf('3')).toBe(xOf('B'));
      expect(xOf('4')).toBe(xOf('C'));
      expect(xOf('9')).toBe(xOf('C'));
      expect(xOf('merged')).toBe(xOf('A'));
      expect(xOf('x')).toBe(xOf('A'));
    });
  });
});
