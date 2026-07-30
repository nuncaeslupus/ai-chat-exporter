/**
 * Regression coverage for lo-45b2: an artifact used to render twice in every
 * export format -- once as the "[Type: Title]" marker paragraph that
 * ConversationStructureService appends to the answer's blocks, and again as
 * the title heading of the full "Artifacts" section every exporter renders
 * for any artifact that carries `content`. This drives all six registered
 * formats end-to-end with a message carrying an artifact with content, and
 * asserts the artifact's title appears exactly once in each rendered output.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { JsonExporter } from '../../../../src/core/exporters/json-exporter';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';
import { blobToText } from '../../../utils/exporter-helpers';
import { extractDocxEntry } from '../../../utils/docx-helpers';

const ARTIFACT_TITLE = 'My Doc';

const pairs: QAPair[] = [
  {
    id: 'p1',
    index: 0,
    selected: true,
    question: {
      id: 'q1',
      role: 'user',
      content: 'Can you write me a document?',
      timestamp: new Date('2025-01-01T00:00:00Z'),
    },
    answer: {
      id: 'a1',
      role: 'assistant',
      content: 'Sure, here it is.',
      timestamp: new Date('2025-01-01T00:00:01Z'),
      metadata: {
        artifacts: [
          {
            type: 'document',
            typeLabel: 'Document',
            title: ARTIFACT_TITLE,
            content: 'Full artifact body text.',
          },
        ],
      },
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
  includeMetadata: false,
  includeTimestamps: false,
};

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('an artifact with content renders exactly once per export format', () => {
  it('md: title appears exactly once', async () => {
    const result = await new StructuredMarkdownExporter().export(conversation, pairs, {
      ...options,
      format: 'md',
    });
    const text = await blobToText(result.blob!);
    expect(countOccurrences(text, ARTIFACT_TITLE)).toBe(1);
  });

  it('txt: title appears exactly once', async () => {
    const result = await new TextExporter().export(conversation, pairs, {
      ...options,
      format: 'txt',
    });
    const text = await blobToText(result.blob!);
    expect(countOccurrences(text, ARTIFACT_TITLE)).toBe(1);
  });

  it('html: title appears exactly once', async () => {
    const result = await new HtmlExporter().export(conversation, pairs, {
      ...options,
      format: 'html',
    });
    const text = await blobToText(result.blob!);
    expect(countOccurrences(text, ARTIFACT_TITLE)).toBe(1);
  });

  it('docx: title appears exactly once', async () => {
    const result = await new DocxExporter().export(conversation, pairs, {
      ...options,
      format: 'docx',
    });
    const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
    expect(countOccurrences(xml, ARTIFACT_TITLE)).toBe(1);
  });

  it('json: title appears exactly once', async () => {
    const result = await new JsonExporter().export(conversation, pairs, {
      ...options,
      format: 'json',
    });
    const text = await blobToText(result.blob!);
    expect(countOccurrences(text, ARTIFACT_TITLE)).toBe(1);
  });

  describe('pdf', () => {
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

    beforeEach(() => {
      instances.length = 0;
    });

    it('title appears exactly once across all text() calls', async () => {
      const { PdfExporter } = await import('../../../../src/core/exporters/pdf-exporter');
      const result = await new PdfExporter().export(conversation, pairs, {
        ...options,
        format: 'pdf',
      });
      expect(result.success).toBe(true);

      const doc = instances[0]!;
      const textArgs = doc.calls.filter((c) => c.method === 'text').map((c) => String(c.args[0]));
      const occurrences = textArgs.filter((s) => s.includes(ARTIFACT_TITLE)).length;
      expect(occurrences).toBe(1);
    });
  });
});
