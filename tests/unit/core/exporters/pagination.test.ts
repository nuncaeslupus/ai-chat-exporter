/**
 * Pagination policy tests (C-5) — orphans, widows, keep-with-next, unbroken
 * tables.
 *
 * Only the paged formats are covered: pdf (hand-rolled layout, measured
 * before drawing), docx (`keepNext` / `keepLines` / `cantSplit`) and html's
 * `@media print` block. md, txt and json have no pages, so the concept is
 * meaningless there and they are deliberately absent.
 *
 * Assertions are on the POLICY, not on pixels: "a role label is never the
 * last thing on a page", "a table row is never split", "a straddling
 * paragraph leaves >= orphans lines behind and carries >= widows over".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { PAGINATION } from '../../../../src/core/exporters/style-tokens';
import { docxRunText, extractDocxEntry } from '../../../utils/docx-helpers';
import { blobToText } from '../../../utils/exporter-helpers';

interface Call {
  method: string;
  args: unknown[];
}

/**
 * jsPDF mock. Unlike the one in pdf-exporter.test.ts this one really wraps:
 * pagination is a function of line COUNT, so a mock that returns the input
 * unsplit cannot exercise it. Wrapping is one word per `WRAP_CHARS` of width,
 * which is enough for the exporter to measure against.
 */
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
    /** One word per line — the exporter's wrapped-line count is the thing under test. */
    splitTextToSize(text: string) {
      return String(text)
        .split(' ')
        .filter((w) => w.length > 0);
    }
    getTextWidth(text: string) {
      // Enough for layout maths; real jsPDF measures the font.
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

// vi.mock is hoisted above the imports below, so the exporters pick up MockJsPDF.
vi.mock('jspdf', () => ({ jsPDF: MockJsPDF }));

import { PdfExporter } from '../../../../src/core/exporters/pdf-exporter';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';

function buildPair(id: string, questionHtml: string, answerHtml: string): QAPair {
  return {
    id: `pair-${id}`,
    index: 0,
    selected: true,
    question: {
      id: `q-${id}`,
      role: 'user',
      content: questionHtml.replace(/<[^>]+>/g, ' '),
      htmlContent: questionHtml,
      timestamp: new Date('2025-01-01T12:00:00Z'),
    },
    answer: {
      id: `a-${id}`,
      role: 'assistant',
      content: answerHtml.replace(/<[^>]+>/g, ' '),
      htmlContent: answerHtml,
      timestamp: new Date('2025-01-01T12:00:00Z'),
    },
  } as unknown as QAPair;
}

function buildConversation(pairs: QAPair[]): Conversation {
  return {
    id: 'pagination-test',
    title: 'Pagination',
    platform: 'claude',
    model: 'claude-3',
    pairs,
    url: 'https://claude.ai/chat/pagination-test',
    createdAt: new Date('2025-01-01T12:00:00Z'),
  } as unknown as Conversation;
}

/** `n` distinct one-word tokens, which the mock wraps to `n` lines. */
function words(prefix: string, n: number): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');
}

async function renderPdf(pairs: QAPair[]): Promise<Call[]> {
  instances.length = 0;
  const result = await new PdfExporter().export(buildConversation(pairs), pairs, {
    format: 'pdf',
    filename: 'test',
    includeMetadata: false,
    includeTimestamps: false,
  });
  expect(result.success).toBe(true);
  return instances[0]!.calls;
}

describe('pdf pagination policy', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  // These three tests each render 60 full documents through the real
  // exporter (fuzzing every content size so role labels/paragraphs/table
  // rows land at every possible page-boundary offset, not one lucky one).
  // That's ~700-1050ms alone, comfortably under the default 5s testTimeout —
  // but under concurrent CPU load (another `pnpm build`/`test:run` on the
  // same machine) wall-clock time balloons well past that, timing out
  // real, passing work. Raise the timeout for just these three instead of
  // cutting the fuzz range, which would just narrow the offsets covered.
  const HEAVY_TEST_TIMEOUT_MS = 20_000;

  it(
    'never leaves a role label as the last thing drawn on a page',
    async () => {
      // Vary the amount of content so the role labels land at every possible
      // offset relative to the page boundary, rather than one lucky one.
      for (let filler = 1; filler <= 60; filler++) {
        const pairs = [
          buildPair('0', `<p>${words('q', filler)}</p>`, `<p>${words('a', 12)}</p>`),
          buildPair('1', `<p>${words('r', 8)}</p>`, `<p>${words('b', 12)}</p>`),
        ];
        const calls = await renderPdf(pairs);

        // Both role labels must be checked: only the USER label sat behind the
        // pair-level page-break check, so matching just that one passes vacuously.
        const labels = calls
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => c.method === 'text' && /^(User|Assistant):$/.test(String(c.args[0])));
        expect(labels.filter(({ c }) => c.args[0] === 'Assistant:').length).toBeGreaterThan(0);
        expect(labels.filter(({ c }) => c.args[0] === 'User:').length).toBeGreaterThan(0);

        for (const { c, i } of labels) {
          const next = calls
            .slice(i + 1)
            .find((n) => n.method === 'text' || n.method === 'addPage');
          expect(
            next?.method,
            `filler=${filler}: role label "${String(c.args[0])}" stranded — page break immediately after it`
          ).not.toBe('addPage');
        }
      }
    },
    HEAVY_TEST_TIMEOUT_MS
  );

  it(
    'keeps at least `orphans` lines behind and `widows` lines over when a paragraph straddles a page',
    async () => {
      const PARA_LINES = 8;
      for (let filler = 1; filler <= 60; filler++) {
        const pairs = [
          buildPair('0', `<p>${words('q', filler)}</p>`, `<p>${words('T', PARA_LINES)}</p>`),
        ];
        const calls = await renderPdf(pairs);

        // The target paragraph's lines are the only tokens starting with 'T'.
        const seq = calls
          .filter(
            (c) =>
              c.method === 'addPage' || (c.method === 'text' && /^T\d+$/.test(String(c.args[0])))
          )
          .map((c) => c.method);

        const firstLine = seq.indexOf('text');
        const lastLine = seq.lastIndexOf('text');
        expect(firstLine, `filler=${filler}: target paragraph not rendered`).toBeGreaterThanOrEqual(
          0
        );

        const breakInside = seq.slice(firstLine, lastLine).indexOf('addPage');
        if (breakInside === -1) continue; // paragraph did not straddle — nothing to check

        const before = seq
          .slice(firstLine, firstLine + breakInside)
          .filter((m) => m === 'text').length;
        const after = seq
          .slice(firstLine + breakInside, lastLine + 1)
          .filter((m) => m === 'text').length;
        expect(
          before,
          `filler=${filler}: orphan — only ${before} line(s) left at the page foot`
        ).toBeGreaterThanOrEqual(PAGINATION.orphans);
        expect(
          after,
          `filler=${filler}: widow — only ${after} line(s) carried over`
        ).toBeGreaterThanOrEqual(PAGINATION.widows);
      }
    },
    HEAVY_TEST_TIMEOUT_MS
  );

  it(
    'never renders a table header row as the last thing on a page',
    async () => {
      const table =
        '<table><thead><tr><th>Name</th><th>Age</th></tr></thead>' +
        '<tbody><tr><td>Alice</td><td>30</td></tr><tr><td>Bob</td><td>41</td></tr></tbody></table>';

      for (let filler = 1; filler <= 60; filler++) {
        const pairs = [buildPair('0', `<p>${words('q', filler)}</p>`, table)];
        const calls = await renderPdf(pairs);

        // Span from the LAST header cell to the FIRST body cell. Checking the
        // call right after the first header cell only finds its sibling cell,
        // which is always on the same row — a vacuous pass.
        const lastHeaderCell = calls.findIndex(
          (c) => c.method === 'text' && String(c.args[0]) === 'Age'
        );
        const firstBodyCell = calls.findIndex(
          (c) => c.method === 'text' && String(c.args[0]) === 'Alice'
        );
        expect(
          lastHeaderCell,
          `filler=${filler}: table header not rendered`
        ).toBeGreaterThanOrEqual(0);
        expect(firstBodyCell, `filler=${filler}: table body not rendered`).toBeGreaterThan(
          lastHeaderCell
        );

        const brokeBetween = calls
          .slice(lastHeaderCell, firstBodyCell)
          .some((c) => c.method === 'addPage');
        expect(
          brokeBetween,
          `filler=${filler}: table header stranded — page break between it and its first body row`
        ).toBe(false);
      }
    },
    HEAVY_TEST_TIMEOUT_MS
  );
});

describe('docx pagination policy', () => {
  async function exportDocx(pair: QAPair): Promise<string> {
    const result = await new DocxExporter().export(buildConversation([pair]), [pair], {
      format: 'docx',
      filename: 'test',
      includeMetadata: false,
      includeTimestamps: false,
    });
    return extractDocxEntry(result.blob!, 'word/document.xml');
  }

  /** Paragraph bodies, so a property can be attributed to the paragraph carrying a given text. */
  /**
   * Paragraph chunks whose *rendered text* contains `needle`.
   *
   * Matches on joined run text rather than the raw XML: R-8 splits a code block
   * into one run per highlighted token, so `'const a = 1;'` is no longer a
   * contiguous substring of the markup and a raw search silently found nothing.
   */
  function paragraphsContaining(xml: string, needle: string): string[] {
    return xml
      .split('<w:p ')
      .flatMap((chunk) => chunk.split('<w:p>'))
      .filter((chunk) => chunk.includes(needle) || docxRunText(chunk).includes(needle));
  }

  it('sets keepNext on role labels so a label cannot strand at the page foot', async () => {
    const xml = await exportDocx(buildPair('0', '<p>question</p>', '<p>answer</p>'));
    const labelParas = paragraphsContaining(xml, '>User<');
    expect(labelParas.length).toBeGreaterThan(0);
    for (const para of labelParas) {
      expect(para).toContain('<w:keepNext/>');
    }
  });

  it('sets keepNext on body headings', async () => {
    const xml = await exportDocx(
      buildPair('0', '<p>question</p>', '<h2>Section Heading</h2><p>body text</p>')
    );
    const headingParas = paragraphsContaining(xml, 'Section Heading');
    expect(headingParas.length).toBeGreaterThan(0);
    for (const para of headingParas) {
      expect(para).toContain('<w:keepNext/>');
    }
  });

  it('sets keepLines on code blocks so they do not fragment', async () => {
    const xml = await exportDocx(
      buildPair(
        '0',
        '<p>question</p>',
        '<pre><code class="language-js">const a = 1;\nconst b = 2;</code></pre>'
      )
    );
    const codeParas = paragraphsContaining(xml, 'const a = 1;');
    expect(codeParas.length).toBeGreaterThan(0);
    for (const para of codeParas) {
      expect(para).toContain('<w:keepLines/>');
    }
  });

  it('sets cantSplit on every table row so no row splits across a page break', async () => {
    const xml = await exportDocx(
      buildPair(
        '0',
        '<p>question</p>',
        '<table><thead><tr><th>Name</th><th>Age</th></tr></thead>' +
          '<tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>'
      )
    );
    const rows = xml
      .split(/<w:tr[ >]/)
      .slice(1)
      .map((r) => r.split('</w:tr>')[0]!);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toContain('<w:cantSplit/>');
    }
  });
});

describe('html print pagination policy', () => {
  it('declares orphans/widows and keeps headings and table rows unbroken when printed', async () => {
    const pair = buildPair('0', '<p>question</p>', '<p>answer</p>');
    const result = await new HtmlExporter().export(buildConversation([pair]), [pair], {
      format: 'html',
      filename: 'test',
      includeMetadata: false,
      includeTimestamps: false,
    });
    const html = await blobToText(result.blob!);

    const printBlock = html.split('@media print')[1]?.split('</style>')[0] ?? '';
    expect(printBlock).not.toBe('');
    expect(printBlock).toContain(`orphans: ${PAGINATION.orphans}`);
    expect(printBlock).toContain(`widows: ${PAGINATION.widows}`);
    // Headings keep with the content that follows them.
    expect(printBlock).toMatch(/\.message-content h1[\s\S]*?break-after:\s*avoid/);
    // A table row is never split down the middle.
    expect(printBlock).toMatch(/\.message-content tr\s*\{[\s\S]*?break-inside:\s*avoid/);
  });
});
