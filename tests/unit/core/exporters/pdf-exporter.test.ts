/**
 * PDF Exporter Tests
 *
 * jsPDF does not run under jsdom (it draws to a canvas-like surface), so
 * instead of inspecting rendered bytes these tests mock the jsPDF module and
 * assert on the structured calls PdfExporter makes against it -- the
 * "structured input handed to jsPDF". Assertions are written against the
 * same shared contract the other formats are tested against (heading
 * levels, code-block handling, message ordering, metadata placement) so they
 * keep working if the visual styling changes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { PdfExporter } from '../../../../src/core/exporters/pdf-exporter';

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

    setFontSize(...args: unknown[]) { this.record('setFontSize', args); }
    setFont(...args: unknown[]) { this.record('setFont', args); }
    setTextColor(...args: unknown[]) { this.record('setTextColor', args); }
    setDrawColor(...args: unknown[]) { this.record('setDrawColor', args); }
    setFillColor(...args: unknown[]) { this.record('setFillColor', args); }
    setLineWidth(...args: unknown[]) { this.record('setLineWidth', args); }
    text(...args: unknown[]) { this.record('text', args); }
    line(...args: unknown[]) { this.record('line', args); }
    rect(...args: unknown[]) { this.record('rect', args); }
    roundedRect(...args: unknown[]) { this.record('roundedRect', args); }
    addPage(...args: unknown[]) { this.record('addPage', args); }
    addImage(...args: unknown[]) { this.record('addImage', args); }
    setPage(...args: unknown[]) { this.record('setPage', args); }
    getNumberOfPages() { return 1; }
    // No wrapping -- keeps the exact strings PdfExporter asked to render
    // visible to the assertions below instead of split into fragments.
    splitTextToSize(text: string) { return [text]; }
    output(type: string) {
      this.record('output', [type]);
      return new Blob(['%PDF-mock'], { type: 'application/pdf' });
    }
  }

  const instances: InstanceType<typeof MockJsPDF>[] = [];
  return { instances, MockJsPDF };
});

// vi.mock is hoisted above imports, so the dynamic `import('jspdf')` inside
// pdf-exporter.ts resolves to this mock.
vi.mock('jspdf', () => ({ jsPDF: MockJsPDF }));

function buildConversation(): { conversation: Conversation; pairs: QAPair[] } {
  const pair: QAPair = {
    id: 'pair-0',
    index: 0,
    selected: true,
    question: {
      id: 'q-0',
      role: 'user',
      content: 'plain question',
      timestamp: new Date('2025-01-01T12:00:00Z'),
    },
    answer: {
      id: 'a-0',
      role: 'assistant',
      content: 'Section Heading Some text function foo() {}',
      htmlContent:
        '<h2>Section Heading</h2><p>Some text</p><pre><code class="language-js">function foo() {}</code></pre>',
      timestamp: new Date('2025-01-01T12:00:00Z'),
    },
  };

  const conversation: Conversation = {
    id: 'test-conversation',
    title: 'PDF Structure Test',
    platform: 'claude',
    model: 'claude-3',
    pairs: [pair],
    url: 'https://claude.ai/chat/pdf-structure-test',
    createdAt: new Date('2025-01-01T12:00:00Z'),
  };

  return { conversation, pairs: [pair] };
}

function textCallsOf(instance: InstanceType<typeof MockJsPDF>): string[] {
  return instance.calls
    .filter((c) => c.method === 'text')
    .map((c) => c.args[0])
    .filter((t): t is string => typeof t === 'string');
}

/** The setFontSize value in effect when a given text string was rendered. */
function fontSizeBeforeText(instance: InstanceType<typeof MockJsPDF>, text: string): number | undefined {
  const idx = instance.calls.findIndex((c) => c.method === 'text' && c.args[0] === text);
  if (idx === -1) return undefined;
  for (let i = idx - 1; i >= 0; i--) {
    const call = instance.calls[i]!;
    if (call.method === 'setFontSize') return call.args[0] as number;
  }
  return undefined;
}

describe('PdfExporter', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('produces a non-empty blob and constructs jsPDF once', async () => {
    const { conversation, pairs } = buildConversation();
    const result = await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      includeMetadata: true,
      includeTimestamps: false,
    });

    expect(result.success).toBe(true);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(instances).toHaveLength(1);
  });

  it('feeds the title, metadata, and Q&A text to jsPDF in document order', async () => {
    const { conversation, pairs } = buildConversation();
    await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      includeMetadata: true,
      includeTimestamps: false,
    });

    const instance = instances[0]!;
    const rendered = textCallsOf(instance);
    const idx = (s: string) => rendered.findIndex((t) => t.includes(s));

    expect(rendered[0]).toBe('PDF Structure Test'); // title always renders first
    expect(idx(conversation.url)).toBeGreaterThan(-1); // metadata rendered
    expect(idx(conversation.url)).toBeLessThan(idx('plain question')); // metadata before body
    expect(idx('plain question')).toBeLessThan(idx('Section Heading')); // question before answer
    expect(idx('Section Heading')).toBeLessThan(idx('Some text')); // heading before paragraph
    expect(idx('Some text')).toBeLessThan(idx('function foo() {}')); // paragraph before code
  });

  it('renders the heading in a distinct (larger) font size than body text', async () => {
    const { conversation, pairs } = buildConversation();
    await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      includeMetadata: false,
      includeTimestamps: false,
    });

    const instance = instances[0]!;
    const headingSize = fontSizeBeforeText(instance, 'Section Heading');
    const paragraphSize = fontSizeBeforeText(instance, 'Some text');
    expect(headingSize).toBeGreaterThan(paragraphSize!);
  });

  it('switches to a monospace font for the code block', async () => {
    const { conversation, pairs } = buildConversation();
    await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      includeMetadata: false,
      includeTimestamps: false,
    });

    const instance = instances[0]!;
    const idx = instance.calls.findIndex((c) => c.method === 'text' && c.args[0] === 'function foo() {}');
    expect(idx).toBeGreaterThan(-1);
    const fontCallBefore = [...instance.calls.slice(0, idx)].reverse().find((c) => c.method === 'setFont');
    expect(fontCallBefore?.args[0]).toBe('courier');
  });
});
