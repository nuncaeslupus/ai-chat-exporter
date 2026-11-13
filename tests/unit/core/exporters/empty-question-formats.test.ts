/**
 * A pair whose question the page never held must not render a role label with
 * nothing under it.
 *
 * ChatGPT's scheduled tasks are one assistant turn and no question anywhere on
 * the page (measured live 2026-11-13), so the parser pairs the answer with an
 * empty question rather than dropping the turn and exporting nothing. Before
 * `hasContent`, every such export opened with a bare "User" heading.
 *
 * JSON is deliberately absent from the matrix: it carries the pair as data, and
 * an empty question is honest there.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
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
    setPage(...args: unknown[]) {
      this.record('setPage', args);
    }
    addImage(...args: unknown[]) {
      this.record('addImage', args);
    }
    splitTextToSize(text: string) {
      return [text];
    }
    getTextWidth(text: string) {
      return text.length;
    }
    getNumberOfPages() {
      return 1;
    }
    output() {
      return new Blob(['pdf'], { type: 'application/pdf' });
    }
  }
  const instances: InstanceType<typeof MockJsPDF>[] = [];
  return { instances, MockJsPDF };
});

vi.mock('jspdf', () => ({ jsPDF: MockJsPDF }));

const pairs: QAPair[] = [
  {
    id: 'p1',
    index: 0,
    selected: true,
    // The shape ChatGPTParser emits for an orphan assistant turn.
    question: { id: 'q1', role: 'user', content: '' },
    answer: {
      id: 'a1',
      role: 'assistant',
      content: 'Three new roles matched your saved search.',
      htmlContent: '<p>Three new roles matched your saved search.</p>',
    },
  },
] as unknown as QAPair[];

const conversation: Conversation = {
  id: 'c1',
  title: 'Recurring job search',
  platform: 'chatgpt',
  url: 'https://chatgpt.com/c/scheduled',
  createdAt: new Date('2026-11-13T00:00:00Z'),
  pairs,
} as unknown as Conversation;

const options: ExportOptions = { format: 'md', filename: 'test', showMetaInfo: false };

describe('an absent question renders no role label in any readable format', () => {
  it('md: no User label, and the answer is still there', async () => {
    const result = await new StructuredMarkdownExporter().export(conversation, pairs, {
      ...options,
      format: 'md',
    });
    const text = await blobToText(result.blob!);

    expect(text).not.toContain('**User**');
    expect(text).toContain('Three new roles matched');
  });

  it('txt: no User label, and the answer is still there', async () => {
    const result = await new TextExporter().export(conversation, pairs, {
      ...options,
      format: 'txt',
    });
    const text = await blobToText(result.blob!);

    expect(text).not.toContain('User');
    expect(text).toContain('Three new roles matched');
  });

  it('html: no user-message block, and the answer is still there', async () => {
    const result = await new HtmlExporter().export(conversation, pairs, {
      ...options,
      format: 'html',
    });
    const text = await blobToText(result.blob!);

    expect(text).not.toContain('class="message user-message"');
    expect(text).toContain('Three new roles matched');
  });

  it('pdf: no User label drawn, and the answer is still there', async () => {
    instances.length = 0;
    await new PdfExporter().export(conversation, pairs, { ...options, format: 'pdf' });
    const drawn = instances[0]!.calls.filter((c) => c.method === 'text').map((c) => c.args[0]);

    expect(drawn).not.toContain('User');
    expect(drawn.join(' ')).toContain('Three new roles matched');
  });

  it('docx: no User heading, and the answer is still there', async () => {
    const result = await new DocxExporter().export(conversation, pairs, {
      ...options,
      format: 'docx',
    });
    const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
    const text = docxRunText(xml);

    expect(text).not.toContain('User');
    expect(text).toContain('Three new roles matched');
  });
});
