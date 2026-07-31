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

const { instances, MockJsPDF, setPageHeightForTest } = vi.hoisted(() => {
  // Mutable so a single test can shrink the page to force a page break inside
  // a wrapped title deterministically, without guessing at content offsets.
  let pageHeightOverride = 297;

  class MockJsPDF {
    calls: Call[] = [];
    internal = { pageSize: { getWidth: () => 210, getHeight: () => pageHeightOverride } };

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
    // Real greedy word-wrap driven by `getTextWidth`, so a title long enough
    // to exceed the given width actually produces multiple lines instead of
    // one long unsplit string — needed to exercise the one-bullet-per-source
    // fix (D-37) below. Short titles still fit on a single line, so this
    // doesn't disturb the existing single-line assertions above.
    splitTextToSize(text: string, width?: number) {
      const str = String(text);
      if (!width) return [str];
      const words = str.split(' ');
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && this.getTextWidth(candidate) > width) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      if (current) lines.push(current);
      return lines.length > 0 ? lines : [str];
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
  return {
    instances,
    MockJsPDF,
    setPageHeightForTest: (h: number) => {
      pageHeightOverride = h;
    },
  };
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
  showMetaInfo: false,
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

/**
 * D-37: a source title long enough to wrap used to get a bullet on EVERY
 * wrapped line, turning one source into several nonsensical entries. The
 * fix draws the bullet once and indents continuation lines to the text
 * column, mirroring `renderList`'s hanging indent.
 */
describe('pdf: a wrapped source title gets one bullet, not one per line', () => {
  const LONG_TITLE = Array.from({ length: 40 }, (_, i) => `Word${i}`).join(' ');

  function conversationWithTitle(
    title: string,
    fillerWords = 0
  ): { conversation: Conversation; pairs: QAPair[] } {
    const searches: WebSearchResult[] = [
      {
        query: 'lighthouse keeper shortage',
        resultCount: 1,
        results: [{ title, url: URL, domain: DOMAIN }],
      },
    ];
    const answerText = fillerWords
      ? Array.from({ length: fillerWords }, (_, i) => `filler${i}`).join(' ')
      : 'Automation replaced most of them.';
    const p: QAPair[] = [
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
          content: answerText,
          htmlContent: `<p>${answerText}</p>`,
          timestamp: new Date('2025-01-01T00:00:01Z'),
          metadata: { webSearches: searches },
        },
      },
    ] as unknown as QAPair[];

    const c: Conversation = {
      id: 'c1',
      title: 'Web search citations',
      platform: 'chatgpt',
      url: 'https://chatgpt.com/c/1',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      pairs: p,
    } as unknown as Conversation;

    return { conversation: c, pairs: p };
  }

  /**
   * Walks forward from the bullet call, greedily reassembling consecutive
   * `text` calls until they reconstruct `fullTitle` word-for-word. Reports
   * how many `addPage` calls fell inside that span, so a straddling title
   * can be told apart from one that fit on a single page.
   */
  function collectTitleRender(calls: Call[], fullTitle: string) {
    const bulletIdx = calls.findIndex((c) => c.method === 'text' && c.args[0] === '•');
    expect(bulletIdx, 'expected a bullet to be drawn for the source title').toBeGreaterThanOrEqual(
      0
    );
    const bulletCall = calls[bulletIdx]!;
    let acc = '';
    const lineCalls: Call[] = [];
    let i = bulletIdx + 1;
    while (i < calls.length && acc !== fullTitle) {
      const call = calls[i]!;
      if (call.method === 'text' && typeof call.args[0] === 'string') {
        const candidate = acc ? `${acc} ${call.args[0]}` : call.args[0];
        if (fullTitle.startsWith(candidate)) {
          acc = candidate;
          lineCalls.push(call);
        } else {
          break;
        }
      }
      i++;
    }
    expect(acc, 'title lines did not reconstruct the full title').toBe(fullTitle);
    const addPagesBetween = calls.slice(bulletIdx, i).filter((c) => c.method === 'addPage').length;
    return { bulletCall, lineCalls, addPagesBetween };
  }

  it('renders exactly one bullet for a title that wraps to 3+ lines, with continuations at the text column', async () => {
    instances.length = 0;
    const { conversation: conv, pairs: p } = conversationWithTitle(LONG_TITLE);
    const result = await new PdfExporter().export(conv, p, { ...options, format: 'pdf' });
    expect(result.success).toBe(true);

    const calls = instances[0]!.calls;
    const bulletCount = calls.filter((c) => c.method === 'text' && c.args[0] === '•').length;
    expect(bulletCount).toBe(1);

    const { bulletCall, lineCalls } = collectTitleRender(calls, LONG_TITLE);
    expect(lineCalls.length).toBeGreaterThanOrEqual(3);

    const textX = lineCalls[0]!.args[1];
    for (const c of lineCalls) {
      expect(c.args[1]).toBe(textX);
    }
    expect(bulletCall.args[1]).not.toBe(textX);
    expect(bulletCall.args[2]).toBe(lineCalls[0]!.args[2]); // bullet sits on the first line's baseline
  });

  it('keeps exactly one bullet and a consistent text column when the wrapped title crosses a page break', async () => {
    // A title long enough to need ~35+ lines, on a page shrunk to fit only a
    // handful of lines: wherever the title happens to start, it necessarily
    // straddles at least one page break — no need to guess the exact offset.
    const VERY_LONG_TITLE = Array.from({ length: 150 }, (_, i) => `Word${i}`).join(' ');
    setPageHeightForTest(60);
    try {
      instances.length = 0;
      const { conversation: conv, pairs: p } = conversationWithTitle(VERY_LONG_TITLE);
      const result = await new PdfExporter().export(conv, p, { ...options, format: 'pdf' });
      expect(result.success).toBe(true);

      const calls = instances[0]!.calls;
      const bulletCount = calls.filter((c) => c.method === 'text' && c.args[0] === '•').length;
      expect(bulletCount).toBe(1);

      const { lineCalls, addPagesBetween } = collectTitleRender(calls, VERY_LONG_TITLE);
      expect(addPagesBetween, 'expected the title render to straddle a page break').toBeGreaterThan(
        0
      );

      const textX = lineCalls[0]!.args[1];
      for (const c of lineCalls) {
        expect(c.args[1], 'continuation line drifted off the text column').toBe(textX);
      }
    } finally {
      setPageHeightForTest(297);
    }
  });
});
