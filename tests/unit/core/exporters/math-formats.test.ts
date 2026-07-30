/**
 * lo-320b (C-6): math was unrepresentable end to end — the parser flattened a
 * rendered KaTeX unit to an undelimited LaTeX string, `InlineContent` had no
 * math member, and no exporter knew a formula from prose. A reader could not
 * tell `E = mc^2` in an export from someone typing those characters.
 *
 * The fix keeps ONE canonical representation — delimited LaTeX source, `$…$`
 * inline and `$$…$$` display — produced once by the parser and carried in
 * `InlineContent.text`. This drives all six registered formats with a message
 * holding one inline and one display formula and asserts the source survives in
 * each. No format renders typeset math: that needs KaTeX/MathJax, and the
 * content script's eager bundle is held at 48.6 KB (PR #42).
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

const INLINE_TEX = '$E = mc^2$';
const DISPLAY_TEX = '$$\\sum_{i=1}^{3} i = 6$$';

// Exactly what BaseParser.cleanupElement emits for a KaTeX unit: a marker span
// carrying the delimited source, with the display mode on `data-math-display`.
// The display formula keeps KaTeX's own `.katex-display` wrapper, so this also
// pins that the wrapper does not swallow the marker.
const HTML_CONTENT = [
  `<p>Einstein wrote <span data-math-display="inline">${INLINE_TEX}</span> on the board.</p>`,
  `<span class="katex-display"><span data-math-display="block">${DISPLAY_TEX}</span></span>`,
].join('\n');

const pairs: QAPair[] = [
  {
    id: 'p1',
    index: 0,
    selected: true,
    question: {
      id: 'q1',
      role: 'user',
      content: 'Show me mass-energy equivalence and a sum',
      timestamp: new Date('2025-01-01T00:00:00Z'),
    },
    answer: {
      id: 'a1',
      role: 'assistant',
      content: `Einstein wrote ${INLINE_TEX} on the board. ${DISPLAY_TEX}`,
      htmlContent: HTML_CONTENT,
      timestamp: new Date('2025-01-01T00:00:01Z'),
    },
  },
] as unknown as QAPair[];

const conversation: Conversation = {
  id: 'c1',
  title: 'Math',
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

describe('math survives export in all six formats', () => {
  it('model: the marker becomes typed math inline content, not plain text', () => {
    const blocks = ConversationStructureService.toStructured(conversation).pairs[0]!.answer.blocks;
    const inline = blocks
      .filter((block) => block.type === 'paragraph')
      .flatMap((block) => block.content)
      .filter((item) => item.type === 'math');

    expect(inline).toEqual([
      { type: 'math', text: INLINE_TEX, display: 'inline' },
      { type: 'math', text: DISPLAY_TEX, display: 'block' },
    ]);
  });

  it('md: keeps the $…$ / $$…$$ delimiters markdown renderers expect', async () => {
    const result = await new StructuredMarkdownExporter().export(conversation, pairs, {
      ...options,
      format: 'md',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain(`Einstein wrote ${INLINE_TEX} on the board.`);
    expect(text).toContain(DISPLAY_TEX);
  });

  it('txt: keeps delimited LaTeX — a unicode approximation would be lossy', async () => {
    const result = await new TextExporter().export(conversation, pairs, {
      ...options,
      format: 'txt',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain(`Einstein wrote ${INLINE_TEX} on the board.`);
    expect(text).toContain(DISPLAY_TEX);
  });

  it('html: tags math semantically and stays self-contained (no remote asset)', async () => {
    const result = await new HtmlExporter().export(conversation, pairs, {
      ...options,
      format: 'html',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain(`<span class="math math-inline">${INLINE_TEX}</span>`);
    expect(text).toContain(`<span class="math math-display">${DISPLAY_TEX}</span>`);
    // PR #54 pins this for the whole document; re-asserted here because a
    // KaTeX stylesheet/font is the obvious way to "improve" this rendering.
    expect(text).not.toMatch(/<link[^>]+href="https?:/i);
    expect(text).not.toMatch(/<script[^>]+src="https?:/i);
  });

  it('json: carries the source verbatim in content and htmlContent', async () => {
    const result = await new JsonExporter().export(conversation, pairs, {
      ...options,
      format: 'json',
    });
    const parsed = JSON.parse(await blobToText(result.blob!)) as {
      pairs: { answer: { content: string; htmlContent: string } }[];
    };
    const answer = parsed.pairs[0]!.answer;
    expect(answer.content).toContain(INLINE_TEX);
    expect(answer.content).toContain(DISPLAY_TEX);
    expect(answer.htmlContent).toContain(INLINE_TEX);
    expect(answer.htmlContent).toContain(DISPLAY_TEX);
  });

  it('pdf: writes the delimited source — jsPDF cannot typeset math', async () => {
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
    expect(combined).toContain(`Einstein wrote ${INLINE_TEX} on the board.`);
    expect(combined).toContain(DISPLAY_TEX);
  });

  it('docx: writes the delimited source in the code font', async () => {
    const result = await new DocxExporter().export(conversation, pairs, {
      ...options,
      format: 'docx',
    });
    expect(result.success).toBe(true);

    const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
    expect(xml).toContain(INLINE_TEX);
    expect(xml).toContain(DISPLAY_TEX);
  });
});
