/**
 * lo-23fb: `metadata.webSearches[].results` — the citation titles, URLs and
 * domains the parsers extract — reached only some formats. md/txt/docx render a
 * "Sources" section, html a result list, json the raw field; pdf listed the
 * title and domain but never the URL, so a printed export could not be followed
 * back to its source. One test per registered format, each proving the title
 * AND the URL survive.
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  Conversation,
  ExportOptions,
  QAPair,
  WebSearchResult,
} from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { JsonExporter } from '../../../../src/core/exporters/json-exporter';
import { PdfExporter } from '../../../../src/core/exporters/pdf-exporter';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';
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

const TITLE = 'Lighthouse keeper shortage explained';
const URL = 'https://example.org/lighthouse-keepers';
const DOMAIN = 'example.org';

const webSearches: WebSearchResult[] = [
  {
    query: 'lighthouse keeper shortage',
    resultCount: 1,
    results: [{ title: TITLE, url: URL, domain: DOMAIN }],
  },
];

const pairs: QAPair[] = [
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
      content: 'Automation replaced most of them.',
      htmlContent: '<p>Automation replaced most of them.</p>',
      timestamp: new Date('2025-01-01T00:00:01Z'),
      metadata: { webSearches },
    },
  },
] as unknown as QAPair[];

const conversation: Conversation = {
  id: 'c1',
  title: 'Web search citations',
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

describe('web search citations survive export in all six formats', () => {
  it('md: renders the citation title and URL', async () => {
    const result = await new StructuredMarkdownExporter().export(conversation, pairs, {
      ...options,
      format: 'md',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain(TITLE);
    expect(text).toContain(URL);
  });

  it('txt: renders the citation title and URL', async () => {
    const result = await new TextExporter().export(conversation, pairs, {
      ...options,
      format: 'txt',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain(TITLE);
    expect(text).toContain(URL);
  });

  it('html: renders the citation title and URL', async () => {
    const result = await new HtmlExporter().export(conversation, pairs, {
      ...options,
      format: 'html',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain(TITLE);
    expect(text).toContain(URL);
  });

  it('json: records the raw results array', async () => {
    const result = await new JsonExporter().export(conversation, pairs, {
      ...options,
      format: 'json',
    });
    const parsed = JSON.parse(await blobToText(result.blob!)) as {
      pairs: { answer: { metadata: { webSearches: WebSearchResult[] } } }[];
    };
    expect(parsed.pairs[0]!.answer.metadata.webSearches[0]!.results).toEqual([
      { title: TITLE, url: URL, domain: DOMAIN },
    ]);
  });

  it('pdf: renders the citation title and URL', async () => {
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
    expect(combined).toContain(TITLE);
    expect(combined).toContain(URL);
  });

  it('docx: renders the citation title and URL', async () => {
    const result = await new DocxExporter().export(conversation, pairs, {
      ...options,
      format: 'docx',
    });
    expect(result.success).toBe(true);
    const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
    expect(xml).toContain(TITLE);
    expect(xml).toContain(URL);
  });
});
