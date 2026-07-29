/**
 * C-2: heading-level mapping must be consistent across every export format.
 *
 * The canonical document outline (see DOC_HEADING_LEVEL in style-tokens.ts):
 *
 *   level 1 = conversation title
 *   level 2 = role label (User / assistant name)
 *   level 3+ = body headings -> min(sourceLevel + 2, 6)
 *
 * So a source <h1> lands at document level 3 and a source <h3> at level 5 in
 * every format that has a heading-level surface, and never at or above the
 * role label's level.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { JsonExporter } from '../../../../src/core/exporters/json-exporter';
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
    output(type: string) {
      this.record('output', [type]);
      return new Blob(['%PDF-mock'], { type: 'application/pdf' });
    }
  }

  const instances: InstanceType<typeof MockJsPDF>[] = [];
  return { instances, MockJsPDF };
});

vi.mock('jspdf', () => ({ default: MockJsPDF, jsPDF: MockJsPDF }));

const pairs: QAPair[] = [
  {
    id: 'p1',
    index: 0,
    selected: true,
    question: {
      id: 'q1',
      role: 'user',
      content: 'question',
      timestamp: new Date('2025-01-01T00:00:00Z'),
    },
    answer: {
      id: 'a1',
      role: 'assistant',
      content: 'AlphaGammaBody text',
      htmlContent: '<h1>Alpha</h1><h3>Gamma</h3><p>Body text</p>',
      timestamp: new Date('2025-01-01T00:00:01Z'),
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

describe('heading levels are consistent across formats (C-2)', () => {
  it('html: title h1, role label h2, source h1 -> h3, source h3 -> h5', async () => {
    const result = await new HtmlExporter().export(conversation, pairs, {
      ...options,
      format: 'html',
    });
    const text = await blobToText(result.blob!);

    expect(text).toContain('<h1 class="title">Test Conversation</h1>');
    expect(text).toContain('<h2 class="message-role">');
    expect(text).toContain('<h3>Alpha</h3>');
    expect(text).toContain('<h5>Gamma</h5>');
  });

  it('md: title #, role label ##, source h1 -> ###, source h3 -> #####', async () => {
    const result = await new StructuredMarkdownExporter().export(conversation, pairs, {
      ...options,
      format: 'md',
    });
    const text = await blobToText(result.blob!);

    expect(text).toContain('# Test Conversation');
    expect(text).toMatch(/^## .*User/m);
    expect(text).toContain('### Alpha');
    expect(text).toContain('##### Gamma');
  });

  it('docx: title Heading1, role label Heading2, source h1 -> Heading3, source h3 -> Heading5', async () => {
    const result = await new DocxExporter().export(conversation, pairs, {
      ...options,
      format: 'docx',
    });
    const xml = await extractDocxEntry(result.blob!, 'word/document.xml');

    // Paragraph order: title, role label(s), then the body headings.
    const styles = [...xml.matchAll(/<w:pStyle w:val="(Heading\d)"\/>/g)].map((m) => m[1]);
    expect(styles[0]).toBe('Heading1'); // conversation title
    expect(styles[1]).toBe('Heading2'); // "User" role label
    expect(styles).toContain('Heading3'); // source h1
    expect(styles).toContain('Heading5'); // source h3

    const alphaLevel = headingStyleOf(xml, 'Alpha');
    const gammaLevel = headingStyleOf(xml, 'Gamma');
    expect(alphaLevel).toBe('Heading3');
    expect(gammaLevel).toBe('Heading5');
  });

  it('pdf: font sizes decrease monotonically title > role label > source h1 > source h3', async () => {
    instances.length = 0;
    const { PdfExporter } = await import('../../../../src/core/exporters/pdf-exporter');
    await new PdfExporter().export(conversation, pairs, { ...options, format: 'pdf' });
    const instance = instances[0]!;

    const titleSize = fontSizeBeforeText(instance, 'Test Conversation');
    const roleSize = fontSizeBeforeText(instance, 'Assistant:');
    const alphaSize = fontSizeBeforeText(instance, 'Alpha');
    const gammaSize = fontSizeBeforeText(instance, 'Gamma');

    expect(titleSize).toBeGreaterThan(roleSize!);
    expect(roleSize).toBeGreaterThan(alphaSize!);
    expect(alphaSize).toBeGreaterThan(gammaSize!);
  });

  it('txt: has no heading-level surface — every body heading renders identically', async () => {
    const result = await new TextExporter().export(conversation, pairs, {
      ...options,
      format: 'txt',
    });
    const text = await blobToText(result.blob!);

    expect(text).toContain('Alpha\n~~~~~');
    expect(text).toContain('Gamma\n~~~~~');
    // Body headings sit below the role label, which is the only chrome txt has.
    expect(text.indexOf('Alpha\n~~~~~')).toBeGreaterThan(text.indexOf('User'));
  });

  it('json: preserves the raw source heading levels losslessly', async () => {
    const result = await new JsonExporter().export(conversation, pairs, {
      ...options,
      format: 'json',
    });
    const parsed = JSON.parse(await blobToText(result.blob!)) as {
      pairs: { answer: { htmlContent?: string } }[];
    };

    expect(parsed.pairs[0]!.answer.htmlContent).toContain('<h1>Alpha</h1>');
    expect(parsed.pairs[0]!.answer.htmlContent).toContain('<h3>Gamma</h3>');
  });
});

/** The Heading style applied to the docx paragraph containing `text`. */
function headingStyleOf(xml: string, text: string): string | undefined {
  const paragraph = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
    .map((m) => m[0])
    .find((p) => p.includes(`>${text}</w:t>`));
  return paragraph?.match(/<w:pStyle w:val="(Heading\d)"\/>/)?.[1];
}

/** The setFontSize value in effect when a given text string was rendered. */
function fontSizeBeforeText(instance: { calls: Call[] }, needle: string): number | undefined {
  const index = instance.calls.findIndex(
    (call) =>
      call.method === 'text' && typeof call.args[0] === 'string' && call.args[0].includes(needle)
  );
  if (index === -1) return undefined;
  for (let i = index; i >= 0; i--) {
    const call = instance.calls[i]!;
    if (call.method === 'setFontSize') return call.args[0] as number;
  }
  return undefined;
}
