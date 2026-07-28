/**
 * DOCX Exporter Tests
 */

import { describe, it, expect } from 'vitest';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { extractDocxEntry } from '../../../utils/docx-helpers';

/**
 * A pair whose answer carries a heading and a code block via htmlContent, so
 * ConversationStructureService parses real 'heading' and 'code' blocks
 * instead of a single flattened paragraph.
 */
function buildStructuredPair(): QAPair {
  return {
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
      content: 'Section Heading Some text function foo() { return 1; }',
      htmlContent:
        '<h2>Section Heading</h2><p>Some text</p><pre><code class="language-js">function foo() { return 1; }</code></pre>',
      timestamp: new Date('2025-01-01T12:00:00Z'),
    },
  } as unknown as QAPair;
}

function buildStructuredConversation(pair: QAPair): Conversation {
  return {
    id: 'test-conversation',
    title: 'DOCX Structure Test',
    platform: 'claude',
    model: 'claude-3',
    pairs: [pair],
    url: 'https://claude.ai/chat/docx-structure-test',
    createdAt: new Date('2025-01-01T12:00:00Z'),
  } as unknown as Conversation;
}

describe('DocxExporter', () => {
  describe('export() code blocks', () => {
    it('preserves line breaks in DOCX code blocks', async () => {
      const code = 'function foo() {\n  return 1;\n}\n// done';
      const newlineCount = (code.match(/\n/g) ?? []).length;

      const pair: QAPair = {
        id: 'pair-0',
        index: 0,
        question: {
          id: 'q-0',
          role: 'user',
          content: 'show me some code',
          timestamp: new Date('2025-01-01T12:00:00Z'),
        },
        answer: {
          id: 'a-0',
          role: 'assistant',
          content: code,
          htmlContent: `<pre><code class="language-js">${code}</code></pre>`,
          timestamp: new Date('2025-01-01T12:00:00Z'),
        },
        selected: true,
      };

      const conversation: Conversation = {
        id: 'test-conversation',
        title: 'Test Conversation',
        platform: 'chatgpt',
        model: 'gpt-4',
        pairs: [pair],
        url: 'https://chatgpt.com/c/test',
        createdAt: new Date('2025-01-01T12:00:00Z'),
      };

      const exporter = new DocxExporter();
      const result = await exporter.export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: false,
      });

      expect(result.success).toBe(true);
      const documentXml = await extractDocxEntry(result.blob!, 'word/document.xml');
      const breakCount = (documentXml.match(/<w:br\/>/g) ?? []).length;

      expect(breakCount).toBe(newlineCount);
    });
  });

  describe('export() structural contract', () => {
    it('produces a non-empty Blob', async () => {
      const pair = buildStructuredPair();
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: false,
      });

      expect(result.success).toBe(true);
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob!.size).toBeGreaterThan(0);
    });

    it('maps a heading block to a Word heading style, distinct from body paragraphs', async () => {
      const pair = buildStructuredPair();
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: false,
      });
      const xml = await extractDocxEntry(result.blob!, 'word/document.xml');

      // The heading block must be styled as a Word heading (docx maps content
      // heading levels onto HeadingLevel.HEADING_3+), distinguishing it from
      // the plain-paragraph "Some text" that follows it.
      expect(xml).toContain('Section Heading');
      expect(xml).toMatch(/w:pStyle w:val="Heading\d+"/);
    });

    it('renders the code block in a monospace font distinct from body text', async () => {
      const pair = buildStructuredPair();
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: false,
      });
      const xml = await extractDocxEntry(result.blob!, 'word/document.xml');

      expect(xml).toContain('function foo() { return 1; }');
      expect(xml).toContain('Courier New');
    });

    it('keeps metadata, message order, heading, and code in document order', async () => {
      const pair = buildStructuredPair();
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: false,
      });
      const xml = await extractDocxEntry(result.blob!, 'word/document.xml');

      const idx = (s: string) => xml.indexOf(s);
      expect(idx(conversation.url)).toBeGreaterThan(-1); // metadata rendered
      expect(idx(conversation.url)).toBeLessThan(idx('plain question')); // metadata before body
      expect(idx('plain question')).toBeLessThan(idx('Section Heading')); // question before answer
      expect(idx('Section Heading')).toBeLessThan(idx('Some text')); // heading before paragraph
      expect(idx('Some text')).toBeLessThan(idx('function foo() { return 1; }')); // paragraph before code
    });
  });
});
