/**
 * PdfExporter's image-render catch block logs with an inconsistent prefix:
 * `renderCodeBlock`'s font-loading warning at pdf-exporter.ts:219 is tagged
 * `[PDF Exporter]`, but the image-render catch was not, unlike every other
 * cross-file exporter log in the codebase (service-worker.ts, txt/docx
 * loggers) which are consistently prefixed. This asserts the property that
 * was violated -- a console.error from PdfExporter is identifiable as coming
 * from PdfExporter -- not the literal string, so the test still fails if the
 * prefix is dropped again in a different shape.
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
    addImage() {
      // The scenario under test: jsPDF rejects the image (bad data URL,
      // unsupported format, ...). PdfExporter catches this and falls back
      // to placeholder text, but still logs it.
      throw new Error('jsPDF: unsupported image format');
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

// One real, already-loaded image, so PdfExporter reaches the `doc.addImage`
// call (and its surrounding try/catch) instead of the "never loaded" branch.
vi.mock('../../../../src/core/utils/image-loader', () => ({
  loadImagesParallel: async () =>
    new Map([
      [
        'https://example.com/pic.png',
        { dataUrl: 'data:image/png;base64,AAAA', format: 'PNG', width: 100, height: 100 },
      ],
    ]),
}));

function buildConversationWithImage(): { conversation: Conversation; pairs: QAPair[] } {
  const pair: QAPair = {
    id: 'pair-img',
    index: 0,
    selected: true,
    question: {
      id: 'q-img',
      role: 'user',
      content: 'question',
      timestamp: new Date('2025-01-01T12:00:00Z'),
    },
    answer: {
      id: 'a-img',
      role: 'assistant',
      content: 'fallback',
      htmlContent: '<p><img src="https://example.com/pic.png" alt="A diagram"></p>',
      timestamp: new Date('2025-01-01T12:00:00Z'),
    },
  };
  const conversation: Conversation = {
    id: 'test-conversation-img-error',
    title: 'Image Error Test',
    platform: 'claude',
    model: 'claude-3',
    pairs: [pair],
    url: 'https://claude.ai/chat/image-error-test',
    createdAt: new Date('2025-01-01T12:00:00Z'),
  };
  return { conversation, pairs: [pair] };
}

describe('PdfExporter image-render error logging', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('tags the image-render failure log with the same [PDF Exporter] prefix as its other logs', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { conversation, pairs } = buildConversationWithImage();

    const result = await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: false,
    });

    // The failure is recovered internally (falls back to placeholder text),
    // so the export itself still succeeds.
    expect(result.success).toBe(true);

    const relevantCalls = errorSpy.mock.calls.filter((call) =>
      String(call[0]).includes('add image')
    );
    expect(relevantCalls.length).toBeGreaterThan(0);
    for (const call of relevantCalls) {
      expect(String(call[0])).toMatch(/^\[PDF Exporter\]/);
    }

    errorSpy.mockRestore();
  });
});
