/**
 * DOCX Exporter Tests
 */

import { describe, it, expect } from 'vitest';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { blobToBuffer, extractDocxEntry } from '../../../utils/docx-helpers';

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
      const buffer = await blobToBuffer(result.blob!);
      const documentXml = extractDocxEntry(buffer, 'word/document.xml');
      const breakCount = (documentXml.match(/<w:br\/>/g) ?? []).length;

      expect(breakCount).toBe(newlineCount);
    });
  });
});
