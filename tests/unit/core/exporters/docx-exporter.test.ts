/**
 * DOCX Exporter Tests
 */

import { describe, it, expect } from 'vitest';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { COLOR, hexToDocxColor } from '../../../../src/core/exporters/style-tokens';
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

  describe('export() table headers', () => {
    function buildTablePair(): QAPair {
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
          content: 'Name Age Alice 30',
          htmlContent:
            '<table><thead><tr><th>Name</th><th>Age</th></tr></thead><tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>',
          timestamp: new Date('2025-01-01T12:00:00Z'),
        },
      } as unknown as QAPair;
    }

    it('renders header row runs bold and body row runs not bold', async () => {
      const pair = buildTablePair();
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: false,
      });
      const xml = await extractDocxEntry(result.blob!, 'word/document.xml');

      // Table rows are plain <w:tr> (no attributes); split them out so the
      // bold check is scoped to the header row vs. the body row.
      const rows = xml.split('<w:tr>').slice(1).map((r) => r.split('</w:tr>')[0]!);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain('Name');
      expect(rows[0]).toContain('<w:b/>');
      expect(rows[1]).toContain('Alice');
      expect(rows[1]).not.toContain('<w:b/>');
    });
  });

  describe('per-message timestamps', () => {
    it('renders a per-message timestamp when includeTimestamps is on', async () => {
      const pair = buildStructuredPair();
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: true,
      });
      const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
      expect(xml).toContain('(12:00:00)');
      // The day is announced once by a day separator, not repeated per message.
      expect(xml).not.toContain('2025-01-01 12:00:00');
    });

    it('omits the timestamp when includeTimestamps is off', async () => {
      const pair = buildStructuredPair();
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: false,
      });
      const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
      expect(xml).not.toContain('12:00:00');
    });

    it('emits no stray label or "undefined" when a message has no timestamp', async () => {
      const pair: QAPair = {
        id: 'pair-no-ts',
        index: 0,
        selected: true,
        question: {
          id: 'q-no-ts',
          role: 'user',
          content: 'question',
        },
        answer: {
          id: 'a-no-ts',
          role: 'assistant',
          content: 'answer',
        },
      } as unknown as QAPair;
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: true,
      });
      const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
      expect(xml).not.toContain('undefined');
      expect(xml).not.toMatch(/\(\s*\)/);
    });
  });

  describe('export() platform brand colour', () => {
    async function roleHeadingXml(platform: string): Promise<string> {
      const pair = buildStructuredPair();
      // `platform` is deliberately widened to string: one case exercises an
      // id outside the Platform union (the clean-fallback path).
      const conversation = {
        ...buildStructuredConversation(pair),
        platform,
      } as unknown as Conversation;
      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: false,
      });
      return extractDocxEntry(result.blob!, 'word/document.xml');
    }

    it.each([
      ['chatgpt', COLOR.brandTextOnLight.chatgpt],
      ['claude', COLOR.brandTextOnLight.claude],
      ['gemini', COLOR.brandTextOnLight.gemini],
    ])('colours the %s assistant role label with its brand colour', async (platform, hex) => {
      const xml = await roleHeadingXml(platform);
      expect(xml).toContain(`<w:color w:val="${hexToDocxColor(hex)}"/>`);
    });

    it('falls back to the neutral default for an unknown platform', async () => {
      const xml = await roleHeadingXml('some-new-bot');
      expect(xml).toContain(`<w:color w:val="${hexToDocxColor(COLOR.brandTextOnLight.default)}"/>`);
      // no empty / undefined colour attribute anywhere
      expect(xml).not.toMatch(/<w:color w:val="(?:|undefined)"\s*\/>/);
    });

    it('gives each platform a distinct role-label colour', async () => {
      const hexes = [
        COLOR.brandTextOnLight.chatgpt,
        COLOR.brandTextOnLight.claude,
        COLOR.brandTextOnLight.gemini,
        COLOR.brandTextOnLight.default,
      ];
      expect(new Set(hexes).size).toBe(hexes.length);
    });
  });
});
