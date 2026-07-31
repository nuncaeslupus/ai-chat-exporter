/**
 * lo-db60 (TEST-1, high): `renderBlockquote` and `renderHorizontalRule` were
 * never invoked by the suite in either binary exporter (0 coverage hits), and
 * the md/txt/html cases were likewise unasserted anywhere. The parser side
 * (HtmlContentParser) is proven to emit 'blockquote'/'hr' blocks correctly;
 * this file proves the six renderers that consume those blocks actually do
 * something with them. Modeled on math-formats.test.ts's cross-format matrix.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { JsonExporter } from '../../../../src/core/exporters/json-exporter';
import { PdfExporter } from '../../../../src/core/exporters/pdf-exporter';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';
import { COLOR, hexToRgbTuple, hexToDocxColor } from '../../../../src/core/exporters/style-tokens';
import { blobToText } from '../../../utils/exporter-helpers';
import { extractDocxEntry, docxRunText } from '../../../utils/docx-helpers';

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

const HTML_CONTENT = '<blockquote><p>quoted line</p></blockquote><hr><p>after</p>';

const pairs: QAPair[] = [
  {
    id: 'p1',
    index: 0,
    selected: true,
    question: {
      id: 'q1',
      role: 'user',
      content: 'Quote something for me',
      timestamp: new Date('2025-01-01T00:00:00Z'),
    },
    answer: {
      id: 'a1',
      role: 'assistant',
      content: 'quoted line\n\nafter',
      htmlContent: HTML_CONTENT,
      timestamp: new Date('2025-01-01T00:00:01Z'),
    },
  },
] as unknown as QAPair[];

const conversation: Conversation = {
  id: 'c1',
  title: 'Blockquote and rule',
  platform: 'claude',
  url: 'https://claude.ai/chat/1',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  pairs,
} as unknown as Conversation;

const options: ExportOptions = {
  format: 'md',
  filename: 'test',
  showMetaInfo: false,
};

function textCallsOf(instance: InstanceType<typeof MockJsPDF>): string[] {
  return instance.calls
    .filter((c) => c.method === 'text')
    .map((c) => c.args[0])
    .filter((t): t is string => typeof t === 'string');
}

describe('blockquotes and horizontal rules survive export in all six formats', () => {
  it('md: renders a real blockquote and a standalone rule', async () => {
    const result = await new StructuredMarkdownExporter().export(conversation, pairs, {
      ...options,
      format: 'md',
    });
    const text = await blobToText(result.blob!);

    expect(text).toContain('> quoted line');
    // A `---` before the conversation body is unconditional (metadata rule), so
    // proving the CONTENT rule renders means counting standalone `---` lines
    // rather than a bare toContain, which would pass even if renderHorizontalRule
    // were deleted.
    const hrLines = text.split('\n').filter((l) => l === '---');
    expect(hrLines).toHaveLength(2);
    // And it sits between the quote and "after", not somewhere unrelated.
    const quoteIdx = text.indexOf('> quoted line');
    const hrIdx = text.indexOf('\n---\n', quoteIdx);
    expect(hrIdx).toBeGreaterThan(quoteIdx);
    expect(text.indexOf('after')).toBeGreaterThan(hrIdx);
  });

  it('txt: renders a quote prefix and a full-width rule', async () => {
    const result = await new TextExporter().export(conversation, pairs, {
      ...options,
      format: 'txt',
    });
    const text = await blobToText(result.blob!);

    expect(text).toContain('> quoted line');
    // showMetaInfo is off and there is only one pair, so the only source of a
    // bare 72-column dash line is the hr block itself.
    const dashLines = text.split('\n').filter((l) => l === '-'.repeat(72));
    expect(dashLines).toHaveLength(1);
    const quoteIdx = text.indexOf('> quoted line');
    const hrIdx = text.indexOf('-'.repeat(72), quoteIdx);
    expect(hrIdx).toBeGreaterThan(quoteIdx);
    expect(text.indexOf('after')).toBeGreaterThan(hrIdx);
  });

  it('html: emits a real <blockquote> and <hr>, not flattened prose', async () => {
    const result = await new HtmlExporter().export(conversation, pairs, {
      ...options,
      format: 'html',
    });
    const text = await blobToText(result.blob!);

    expect(text).toContain('<blockquote>');
    expect(text).toContain('quoted line');
    expect(text).toContain('</blockquote>');
    expect(text).toContain('<hr>');
    expect(text.indexOf('<hr>')).toBeGreaterThan(text.indexOf('</blockquote>'));
  });

  it('json: preserves the raw blockquote/hr markup in htmlContent', async () => {
    const result = await new JsonExporter().export(conversation, pairs, {
      ...options,
      format: 'json',
    });
    const text = await blobToText(result.blob!);
    const parsed = JSON.parse(text) as { pairs: { answer: { htmlContent: string } }[] };
    expect(parsed.pairs[0]!.answer.htmlContent).toContain('<blockquote>');
    expect(parsed.pairs[0]!.answer.htmlContent).toContain('<hr>');
  });

  it('pdf: writes the quoted text and draws the rule in the border colour', async () => {
    instances.length = 0;
    const result = await new PdfExporter().export(conversation, pairs, {
      ...options,
      format: 'pdf',
    });
    expect(result.success).toBe(true);

    const instance = instances[0]!;
    expect(textCallsOf(instance)).toContain('quoted line');

    // renderHorizontalRule's drawRule call: setDrawColor(COLOR.border) then a
    // horizontal line spanning contentWidth. COLOR.border is otherwise unused
    // here (metadata off, no table) so this is unambiguous.
    const borderColor = hexToRgbTuple(COLOR.border).join(',');
    const calls = instance.calls;
    const drawIdx = calls.findIndex(
      (c) => c.method === 'setDrawColor' && c.args.join(',') === borderColor
    );
    expect(drawIdx).toBeGreaterThan(-1);
    const lineIdx = calls.findIndex(
      (c, i) => i > drawIdx && c.method === 'line' && c.args[1] === c.args[3]
    );
    expect(lineIdx).toBeGreaterThan(drawIdx);

    // The blockquote's own left border (a vertical line) is drawn too.
    const quoteBorderColor = hexToRgbTuple(COLOR.blockquoteBorder).join(',');
    expect(
      calls.some((c) => c.method === 'setDrawColor' && c.args.join(',') === quoteBorderColor)
    ).toBe(true);
  });

  it('docx: renders the quote as a run and the rule as a bottom-bordered paragraph', async () => {
    const result = await new DocxExporter().export(conversation, pairs, {
      ...options,
      format: 'docx',
    });
    expect(result.success).toBe(true);

    const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
    expect(docxRunText(xml)).toContain('quoted line');

    // renderHorizontalRule's own bottom border, in COLOR.border.
    const ruleColor = hexToDocxColor(COLOR.border);
    expect(xml).toMatch(new RegExp(`<w:bottom w:val="single"[^/]*w:color="${ruleColor}"`, 'i'));

    // renderBlockquote's own left border, in COLOR.blockquoteBorder — distinct
    // from the rule's border so the two are not the same accidental match.
    const quoteColor = hexToDocxColor(COLOR.blockquoteBorder);
    expect(xml).toMatch(new RegExp(`<w:left w:val="single"[^/]*w:color="${quoteColor}"`, 'i'));
  });
});
