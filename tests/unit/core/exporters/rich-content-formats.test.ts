/**
 * Regression coverage for lo-3005: a message with web-search metadata used to
 * discard htmlContent and flatten to one paragraph, destroying lists in every
 * export format. This drives all six registered formats end-to-end with a
 * message carrying a web search + a numbered list.
 */

import { describe, it, expect } from 'vitest';
import type { Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { JsonExporter } from '../../../../src/core/exporters/json-exporter';
import { PdfExporter } from '../../../../src/core/exporters/pdf-exporter';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';
import { ConversationStructureService } from '../../../../src/core/services/conversation-structure-service';
import { blobToText } from '../../../utils/exporter-helpers';

const pairs: QAPair[] = [
  {
    id: 'p1',
    index: 0,
    selected: true,
    question: {
      id: 'q1',
      role: 'user',
      content: 'What are the first two points?',
      timestamp: new Date('2025-01-01T00:00:00Z'),
    },
    answer: {
      id: 'a1',
      role: 'assistant',
      content: '[Web Search: first two points]\n\nFirst pointSecond point',
      htmlContent: '<ol><li>First point</li><li>Second point</li></ol>',
      timestamp: new Date('2025-01-01T00:00:01Z'),
      metadata: { webSearches: [{ query: 'first two points', resultCount: 2 }] },
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
  showMetaInfo: false,
};

describe('rich content survives export in all six formats', () => {
  it('md: renders the numbered list', async () => {
    const result = await new StructuredMarkdownExporter().export(conversation, pairs, {
      ...options,
      format: 'md',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain('1. First point');
    expect(text).toContain('2. Second point');
    expect(text).toContain('[Web Search: first two points]');
  });

  it('txt: renders the numbered list', async () => {
    const result = await new TextExporter().export(conversation, pairs, {
      ...options,
      format: 'txt',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain('1. First point');
    expect(text).toContain('2. Second point');
    expect(text).toContain('[Web Search: first two points]');
  });

  it('html: renders the numbered list as <ol><li>', async () => {
    const result = await new HtmlExporter().export(conversation, pairs, {
      ...options,
      format: 'html',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain('<li>First point</li>');
    expect(text).toContain('<li>Second point</li>');
  });

  it('json: preserves the raw htmlContent list markup', async () => {
    const result = await new JsonExporter().export(conversation, pairs, {
      ...options,
      format: 'json',
    });
    const text = await blobToText(result.blob!);
    const parsed = JSON.parse(text) as { pairs: { answer: { htmlContent: string } }[] };
    expect(parsed.pairs[0]!.answer.htmlContent).toContain('<li>First point</li>');
    expect(parsed.pairs[0]!.answer.htmlContent).toContain('<li>Second point</li>');
  });

  it('pdf: the structured blocks fed to the renderer keep the list, and export succeeds', async () => {
    const structured = ConversationStructureService.toStructured(conversation);
    const blocks = structured.pairs[0]!.answer.blocks;
    expect(blocks.some((b) => b.type === 'list')).toBe(true);

    const result = await new PdfExporter().export(conversation, pairs, {
      ...options,
      format: 'pdf',
    });
    expect(result.success).toBe(true);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob!.size).toBeGreaterThan(0);
  });

  it('docx: the structured blocks fed to the renderer keep the list, and export succeeds', async () => {
    const structured = ConversationStructureService.toStructured(conversation);
    const blocks = structured.pairs[0]!.answer.blocks;
    expect(blocks.some((b) => b.type === 'list')).toBe(true);

    const result = await new DocxExporter().export(conversation, pairs, {
      ...options,
      format: 'docx',
    });
    expect(result.success).toBe(true);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob!.size).toBeGreaterThan(0);
  });
});
