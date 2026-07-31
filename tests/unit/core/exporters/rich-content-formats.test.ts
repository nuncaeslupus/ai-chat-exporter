/**
 * Regression coverage for lo-3005: a message with web-search metadata used to
 * discard htmlContent and flatten to one paragraph, destroying lists in every
 * export format. This drives all six registered formats end-to-end with a
 * message carrying a web search + a numbered list.
 *
 * lo-db60 (TEST-1, high): the pdf/docx cases used to assert on
 * ConversationStructureService.toStructured() -- a different module than the
 * one under test -- and then only that export() returned a non-empty Blob.
 * They now assert on the exporters' own rendered output (jsPDF's structured
 * calls via a mock, and the rendered word/document.xml), the same way the
 * md/txt/html/json cases already did.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { JsonExporter } from '../../../../src/core/exporters/json-exporter';
import { PdfExporter } from '../../../../src/core/exporters/pdf-exporter';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';
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

function textCallsOf(instance: InstanceType<typeof MockJsPDF>): string[] {
  return instance.calls
    .filter((c) => c.method === 'text')
    .map((c) => c.args[0])
    .filter((t): t is string => typeof t === 'string');
}

const pairs: QAPair[] = [
  {
    id: 'p1',
    index: 0,
    selected: true,
    question: {
      id: 'q1',
      role: 'user',
      content: 'What are the first two points?',
      timestamp: new Date('2025-01-01T00:00:00Z'),
    },
    answer: {
      id: 'a1',
      role: 'assistant',
      content: '[Web Search: first two points]\n\nFirst pointSecond point',
      htmlContent: '<ol><li>First point</li><li>Second point</li></ol>',
      timestamp: new Date('2025-01-01T00:00:01Z'),
      metadata: { webSearches: [{ query: 'first two points', resultCount: 2 }] },
    },
  },
] as unknown as QAPair[];

const conversation: Conversation = {
  id: 'c1',
  title: 'Test Conversation',
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

describe('rich content survives export in all six formats', () => {
  it('md: renders the numbered list', async () => {
    const result = await new StructuredMarkdownExporter().export(conversation, pairs, {
      ...options,
      format: 'md',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain('1. First point');
    expect(text).toContain('2. Second point');
    expect(text).toContain('[Web Search: first two points]');
  });

  it('txt: renders the numbered list', async () => {
    const result = await new TextExporter().export(conversation, pairs, {
      ...options,
      format: 'txt',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain('1. First point');
    expect(text).toContain('2. Second point');
    expect(text).toContain('[Web Search: first two points]');
  });

  it('html: renders the numbered list as <ol><li>', async () => {
    const result = await new HtmlExporter().export(conversation, pairs, {
      ...options,
      format: 'html',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain('<li>First point</li>');
    expect(text).toContain('<li>Second point</li>');
  });

  it('json: preserves the raw htmlContent list markup', async () => {
    const result = await new JsonExporter().export(conversation, pairs, {
      ...options,
      format: 'json',
    });
    const text = await blobToText(result.blob!);
    const parsed = JSON.parse(text) as { pairs: { answer: { htmlContent: string } }[] };
    expect(parsed.pairs[0]!.answer.htmlContent).toContain('<li>First point</li>');
    expect(parsed.pairs[0]!.answer.htmlContent).toContain('<li>Second point</li>');
  });

  it('pdf: renders the list marker and both item texts via the PDF renderer', async () => {
    instances.length = 0;
    const result = await new PdfExporter().export(conversation, pairs, {
      ...options,
      format: 'pdf',
    });
    expect(result.success).toBe(true);

    // Asserted on the renderer's own output (textCallsOf), not on
    // ConversationStructureService.toStructured() -- that only proves the
    // parser emitted a 'list' block, not that PdfExporter.renderList ever ran.
    // pdf-exporter.ts's renderList draws the ordered-list prefix ("1.") and its
    // item text as two separate doc.text() calls.
    const rendered = textCallsOf(instances[0]!);
    expect(rendered).toContain('1.');
    expect(rendered).toContain('First point');
    expect(rendered).toContain('2.');
    expect(rendered).toContain('Second point');
    expect(rendered.indexOf('1.')).toBeLessThan(rendered.indexOf('First point'));
    expect(rendered.indexOf('First point')).toBeLessThan(rendered.indexOf('2.'));
    expect(rendered.indexOf('2.')).toBeLessThan(rendered.indexOf('Second point'));
  });

  it('docx: renders both item texts as separate list paragraphs, not a flattened blob', async () => {
    const result = await new DocxExporter().export(conversation, pairs, {
      ...options,
      format: 'docx',
    });
    expect(result.success).toBe(true);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob!.size).toBeGreaterThan(0);

    // docx-exporter.ts's renderList currently renders a literal "1. "/"2. "
    // bullet run followed by the item-text run in the SAME paragraph (not
    // Word's own <w:numPr> numbering) -- asserted on what it actually emits,
    // not on the suggested-fix's assumption of real Word list numbering.
    const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
    const text = docxRunText(xml);
    expect(text).toContain('1. First point');
    expect(text).toContain('2. Second point');
  });
});

/**
 * TEST-1 (high): renderList's recursive branch (a nested list inside a list
 * item) was unhit and unasserted in pdf/docx -- only structured-md-exporter's
 * own suite has a nested-list case for markdown.
 */
describe('nested lists recurse in pdf and docx', () => {
  const nestedPairs: QAPair[] = [
    {
      id: 'p1',
      index: 0,
      selected: true,
      question: {
        id: 'q1',
        role: 'user',
        content: 'Show me a nested list',
        timestamp: new Date('2025-01-01T00:00:00Z'),
      },
      answer: {
        id: 'a1',
        role: 'assistant',
        content: 'Outer item Inner item',
        htmlContent: '<ul><li>Outer item<ul><li>Inner item</li></ul></li></ul>',
        timestamp: new Date('2025-01-01T00:00:01Z'),
      },
    },
  ] as unknown as QAPair[];

  const nestedConversation: Conversation = {
    id: 'c2',
    title: 'Nested List Test',
    platform: 'claude',
    url: 'https://claude.ai/chat/2',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    pairs: nestedPairs,
  } as unknown as Conversation;

  it('pdf: renders both the outer and the nested item', async () => {
    instances.length = 0;
    const result = await new PdfExporter().export(nestedConversation, nestedPairs, {
      ...options,
      format: 'pdf',
    });
    expect(result.success).toBe(true);

    const rendered = textCallsOf(instances[0]!);
    expect(rendered).toContain('Outer item');
    expect(rendered).toContain('Inner item');
    expect(rendered.indexOf('Outer item')).toBeLessThan(rendered.indexOf('Inner item'));
  });

  it('docx: renders both the outer and the nested item', async () => {
    const result = await new DocxExporter().export(nestedConversation, nestedPairs, {
      ...options,
      format: 'docx',
    });
    expect(result.success).toBe(true);

    const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
    const text = docxRunText(xml);
    expect(text).toContain('Outer item');
    expect(text).toContain('Inner item');
    expect(text.indexOf('Outer item')).toBeLessThan(text.indexOf('Inner item'));
  });
});
