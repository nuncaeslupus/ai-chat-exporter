/**
 * lo-f827: `ConversationStructureService` pushed a `[Web Search: …]` marker
 * paragraph for every search, and then each exporter rendered a full sources
 * section for the same search — two consecutive outputs about one search.
 *
 * The marker is now the *fallback*: it survives only for a search with no
 * results, because md / txt / docx skip such a search entirely (`if
 * (!search.results?.length) continue;`) and it would otherwise vanish from
 * those exports. html / pdf render their section from the query alone, and
 * json carries the raw metadata, so all six still announce the search.
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
    output(type: string) {
      this.record('output', [type]);
      return new Blob(['%PDF-mock'], { type: 'application/pdf' });
    }
  }

  const instances: InstanceType<typeof MockJsPDF>[] = [];
  return { instances, MockJsPDF };
});

vi.mock('jspdf', () => ({ jsPDF: MockJsPDF }));

const QUERY = 'lighthouse keeper shortage';
const MARKER = `[Web Search: ${QUERY}]`;

function conversationWith(results: { title: string; url: string; domain?: string }[]): {
  conversation: Conversation;
  pairs: QAPair[];
} {
  const pairs = [
    {
      id: 'p1',
      index: 0,
      selected: true,
      question: {
        id: 'q1',
        role: 'user',
        content: 'Why are lighthouse keepers scarce?',
        timestamp: new Date('2025-01-01T00:00:00Z'),
      },
      answer: {
        id: 'a1',
        role: 'assistant',
        content: 'Here is what I found.',
        htmlContent: '<p>Here is what I found.</p>',
        timestamp: new Date('2025-01-01T00:00:01Z'),
        metadata: {
          webSearches: [{ query: QUERY, resultCount: results.length, results }],
        },
      },
    },
  ] as unknown as QAPair[];

  const conversation = {
    id: 'c1',
    title: 'Lighthouses',
    platform: 'chatgpt',
    url: 'https://chatgpt.com/c/1',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    pairs,
  } as unknown as Conversation;

  return { conversation, pairs };
}

const options: ExportOptions = {
  format: 'md',
  filename: 'test',
  includeMetadata: false,
  includeTimestamps: false,
};

async function exportAll(conversation: Conversation, pairs: QAPair[]) {
  instances.length = 0;
  const md = await blobToText(
    (
      await new StructuredMarkdownExporter().export(conversation, pairs, {
        ...options,
        format: 'md',
      })
    ).blob!
  );
  const txt = await blobToText(
    (await new TextExporter().export(conversation, pairs, { ...options, format: 'txt' })).blob!
  );
  const html = await blobToText(
    (await new HtmlExporter().export(conversation, pairs, { ...options, format: 'html' })).blob!
  );
  const json = await blobToText(
    (await new JsonExporter().export(conversation, pairs, { ...options, format: 'json' })).blob!
  );
  await new PdfExporter().export(conversation, pairs, { ...options, format: 'pdf' });
  const pdf = instances
    .flatMap((doc) => doc.calls.filter((c) => c.method === 'text'))
    .map((c) => String(c.args[0]))
    .join('\n');
  const docx = await extractDocxEntry(
    (await new DocxExporter().export(conversation, pairs, { ...options, format: 'docx' })).blob!,
    'word/document.xml'
  );
  return { md, txt, html, json, pdf, docx };
}

describe('web-search marker does not duplicate the sources section', () => {
  const withResults = conversationWith([
    { title: 'Keeper shortage explained', url: 'https://example.com/a', domain: 'example.com' },
  ]);
  const withoutResults = conversationWith([]);

  it('model: a search with results emits no marker paragraph', () => {
    const blocks = ConversationStructureService.toStructured(withResults.conversation).pairs[0]!
      .answer.blocks;
    const texts = blocks.flatMap((b) =>
      b.type === 'paragraph' ? b.content.map((c) => ('text' in c ? c.text : '')) : []
    );
    expect(texts).not.toContain(MARKER);
  });

  it('model: a search with no results keeps the marker as the fallback', () => {
    const blocks = ConversationStructureService.toStructured(withoutResults.conversation).pairs[0]!
      .answer.blocks;
    const texts = blocks.flatMap((b) =>
      b.type === 'paragraph' ? b.content.map((c) => ('text' in c ? c.text : '')) : []
    );
    expect(texts).toContain(MARKER);
  });

  it('all six formats: a search with results renders the section and no marker', async () => {
    const out = await exportAll(withResults.conversation, withResults.pairs);

    for (const [format, text] of Object.entries(out)) {
      expect(text, `${format} still emits the marker`).not.toContain(MARKER);
      expect(text, `${format} dropped the search`).toContain(QUERY);
    }
    expect(out.md).toContain(`### Sources — ${QUERY}`);
    expect(out.txt).toContain(`Sources — ${QUERY}:`);
    expect(out.docx).toContain(`Sources — ${QUERY}`);
    expect(out.html).toContain('Web Search Results');
    expect(out.pdf).toContain('Web Search Results:');
    expect(out.md).toContain('https://example.com/a');
  });

  it('all six formats: a search with no results still says a search happened', async () => {
    const out = await exportAll(withoutResults.conversation, withoutResults.pairs);

    for (const [format, text] of Object.entries(out)) {
      expect(text, `${format} lost the search entirely`).toContain(QUERY);
    }
    // md / txt / docx skip a result-less search, so the marker is their only trace.
    expect(out.md).toContain(MARKER);
    expect(out.txt).toContain(MARKER);
    expect(out.docx).toContain(MARKER);
    // html / pdf build their section from the query alone; json keeps the raw field.
    expect(out.html).toContain('Web Search Results');
    expect(out.pdf).toContain('Web Search Results:');
    const parsed = JSON.parse(out.json) as {
      pairs: { answer: { metadata: { webSearches: { query: string }[] } } }[];
    };
    expect(parsed.pairs[0]!.answer.metadata.webSearches[0]!.query).toBe(QUERY);
  });
});
