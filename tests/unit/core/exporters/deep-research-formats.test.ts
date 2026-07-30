/**
 * lo-5970: `metadata.research` (ChatGPT deep research: duration / sources /
 * searches) was parsed and then dropped by every format. It is now emitted as a
 * marker paragraph by ConversationStructureService — the same route
 * `metadata.webSearches` takes — so every structured format renders it, and
 * JSON keeps the raw field. This drives all six registered formats end-to-end.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { JsonExporter } from '../../../../src/core/exporters/json-exporter';
import { PdfExporter } from '../../../../src/core/exporters/pdf-exporter';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';
import { ConversationStructureService } from '../../../../src/core/services/conversation-structure-service';
import { blobToText } from '../../../utils/exporter-helpers';
import { extractDocxEntry } from '../../../utils/docx-helpers';

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

vi.mock('jspdf', () => ({ jsPDF: MockJsPDF }));

const MARKER = '[Deep Research: 6m, 18 sources, 60 searches]';

const pairs: QAPair[] = [
  {
    id: 'p1',
    index: 0,
    selected: true,
    question: {
      id: 'q1',
      role: 'user',
      content: 'Research the lighthouse keeper shortage',
      timestamp: new Date('2025-01-01T00:00:00Z'),
    },
    answer: {
      id: 'a1',
      role: 'assistant',
      content: 'Here is the report.',
      htmlContent: '<p>Here is the report.</p>',
      timestamp: new Date('2025-01-01T00:00:01Z'),
      metadata: {
        research: { duration: '6m', sources: 18, searches: 60 },
      },
    },
  },
] as unknown as QAPair[];

const conversation: Conversation = {
  id: 'c1',
  title: 'Deep research',
  platform: 'chatgpt',
  url: 'https://chatgpt.com/c/1',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  pairs,
} as unknown as Conversation;

const options: ExportOptions = {
  format: 'md',
  filename: 'test',
  includeMetadata: false,
  includeTimestamps: false,
};

describe('deep research metadata survives export in all six formats', () => {
  it('model: research becomes a marker paragraph in the structured conversation', () => {
    const blocks = ConversationStructureService.toStructured(conversation).pairs[0]!.answer.blocks;
    const texts = blocks.flatMap((b) =>
      b.type === 'paragraph' ? b.content.map((c) => ('text' in c ? c.text : '')) : []
    );
    expect(texts).toContain(MARKER);
  });

  it('md: renders the research marker', async () => {
    const result = await new StructuredMarkdownExporter().export(conversation, pairs, {
      ...options,
      format: 'md',
    });
    expect(await blobToText(result.blob!)).toContain(MARKER);
  });

  it('txt: renders the research marker', async () => {
    const result = await new TextExporter().export(conversation, pairs, {
      ...options,
      format: 'txt',
    });
    expect(await blobToText(result.blob!)).toContain(MARKER);
  });

  it('html: renders the research marker', async () => {
    const result = await new HtmlExporter().export(conversation, pairs, {
      ...options,
      format: 'html',
    });
    expect(await blobToText(result.blob!)).toContain(MARKER);
  });

  it('json: records the raw research fields', async () => {
    const result = await new JsonExporter().export(conversation, pairs, {
      ...options,
      format: 'json',
    });
    const parsed = JSON.parse(await blobToText(result.blob!)) as {
      pairs: { answer: { metadata: { research: unknown } } }[];
    };
    expect(parsed.pairs[0]!.answer.metadata.research).toEqual({
      duration: '6m',
      sources: 18,
      searches: 60,
    });
  });

  it('pdf: renders the research marker', async () => {
    instances.length = 0;
    const result = await new PdfExporter().export(conversation, pairs, {
      ...options,
      format: 'pdf',
    });
    expect(result.success).toBe(true);

    const combined = instances
      .flatMap((doc) => doc.calls.filter((c) => c.method === 'text'))
      .map((c) => String(c.args[0]))
      .join('\n');
    expect(combined).toContain(MARKER);
  });

  it('docx: renders the research marker', async () => {
    const result = await new DocxExporter().export(conversation, pairs, {
      ...options,
      format: 'docx',
    });
    expect(result.success).toBe(true);
    const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
    expect(xml).toContain(MARKER);
  });

  it('omits pieces the parser could not read', () => {
    const partial = {
      ...conversation,
      pairs: [
        {
          ...pairs[0]!,
          answer: {
            ...pairs[0]!.answer,
            metadata: { research: { duration: '', sources: 0, searches: 12 } },
          },
        },
      ],
    } as unknown as Conversation;

    const blocks = ConversationStructureService.toStructured(partial).pairs[0]!.answer.blocks;
    const texts = blocks.flatMap((b) =>
      b.type === 'paragraph' ? b.content.map((c) => ('text' in c ? c.text : '')) : []
    );
    expect(texts).toContain('[Deep Research: 12 searches]');
  });
});
