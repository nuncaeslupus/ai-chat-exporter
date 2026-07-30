/**
 * lo-8e3d: two `ImageBlock` fields the coverage matrix (PR #112) found stranded.
 *
 * 1. `url` was dropped by txt and docx — both emitted a bare `[Image: alt]`, so
 *    those exports lost every picture with no pointer left to it. They now match
 *    the `media` case in the same switch: `[Image: alt] <url>`.
 * 2. `linkUrl` (the href of a wrapping <a>, set by HtmlContentParser) was
 *    written by the parser and read by no exporter. Decision: render it. HTML is
 *    the only format that can put the image back inside its anchor, so that is
 *    where it is read — this test locks it there.
 */

import { describe, it, expect } from 'vitest';
import type { Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';
import { ConversationStructureService } from '../../../../src/core/services/conversation-structure-service';
import { blobToText } from '../../../utils/exporter-helpers';
import { extractDocxEntry } from '../../../utils/docx-helpers';

const IMAGE_URL = 'https://example.test/generated/diagram.png';
const LINK_URL = 'https://example.test/source-article';

const pairs: QAPair[] = [
  {
    id: 'p1',
    index: 0,
    selected: true,
    question: {
      id: 'q1',
      role: 'user',
      content: 'Show me the diagram',
      timestamp: new Date('2025-01-01T00:00:00Z'),
    },
    answer: {
      id: 'a1',
      role: 'assistant',
      content: 'Here it is.',
      htmlContent: `<p><a href="${LINK_URL}"><img src="${IMAGE_URL}" alt="Flow diagram"></a></p>`,
      timestamp: new Date('2025-01-01T00:00:01Z'),
    },
  },
] as unknown as QAPair[];

const conversation: Conversation = {
  id: 'c1',
  title: 'Linked image',
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

describe('image url and linkUrl reach an export format', () => {
  it('model: the anchor-wrapped image keeps both url and linkUrl', () => {
    const blocks = ConversationStructureService.toStructured(conversation).pairs[0]!.answer.blocks;
    expect(blocks.find((b) => b.type === 'image')).toMatchObject({
      url: IMAGE_URL,
      alt: 'Flow diagram',
      linkUrl: LINK_URL,
    });
  });

  it('txt: labels the image and keeps the URL', async () => {
    const result = await new TextExporter().export(conversation, pairs, {
      ...options,
      format: 'txt',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain(`[Image: Flow diagram] ${IMAGE_URL}`);
  });

  it('docx: labels the image and keeps the URL', async () => {
    const result = await new DocxExporter().export(conversation, pairs, {
      ...options,
      format: 'docx',
    });
    expect(result.success).toBe(true);

    const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
    expect(xml).toContain(`[Image: Flow diagram] ${IMAGE_URL}`);
  });

  it('md: embeds the image with its URL', async () => {
    const result = await new StructuredMarkdownExporter().export(conversation, pairs, {
      ...options,
      format: 'md',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain(IMAGE_URL);
  });

  it('html: wraps the image in its link', async () => {
    const result = await new HtmlExporter().export(conversation, pairs, {
      ...options,
      format: 'html',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain(
      `<a href="${LINK_URL}" target="_blank" rel="noopener noreferrer"><img src="${IMAGE_URL}" alt="Flow diagram"></a>`
    );
  });

  it('html: an unlinked image stays a bare <img>', async () => {
    const plainPairs = [
      {
        ...pairs[0],
        answer: {
          ...pairs[0]!.answer,
          htmlContent: `<p><img src="${IMAGE_URL}" alt="Flow diagram"></p>`,
        },
      },
    ] as unknown as QAPair[];
    const result = await new HtmlExporter().export(
      { ...conversation, pairs: plainPairs },
      plainPairs,
      { ...options, format: 'html' }
    );
    const text = await blobToText(result.blob!);
    expect(text).toContain(`<img src="${IMAGE_URL}" alt="Flow diagram">`);
    expect(text).not.toContain('<a href="https://example.test/source-article"');
  });
});
