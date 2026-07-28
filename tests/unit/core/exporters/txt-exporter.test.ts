/**
 * Plain Text Exporter Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import {
  blobToText,
  createTestQAPair,
  createTestConversation,
} from '../../../utils/exporter-helpers';

describe('TextExporter', () => {
  let exporter: TextExporter;
  let conversation: Conversation;
  let selectedPairs: QAPair[];

  beforeEach(() => {
    exporter = new TextExporter();
    const pairs = [
      createTestQAPair(0, 'What is TypeScript?', 'TypeScript is a typed superset of JavaScript.'),
      createTestQAPair(1, 'How do I use it?', 'You can install it with npm.'),
    ];
    conversation = createTestConversation(pairs);
    selectedPairs = pairs;
  });

  describe('format property', () => {
    it('returns "txt"', () => {
      expect(exporter.format).toBe('txt');
    });
  });

  describe('extension property', () => {
    it('returns "txt"', () => {
      expect(exporter.extension).toBe('txt');
    });
  });

  describe('mimeType property', () => {
    it('returns "text/plain"', () => {
      expect(exporter.mimeType).toBe('text/plain');
    });
  });

  describe('export()', () => {
    it('returns success with valid blob', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'txt',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: false,
      });
      expect(result.success).toBe(true);
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toBe('test.txt');
    });

    it('formats as plain text without markdown', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'txt',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).not.toContain('##'); // No markdown headings
      expect(text).not.toContain('**'); // No bold
      expect(text).toContain('User:');
      expect(text).toContain('ChatGPT:'); // Platform-specific assistant name
    });

    it('separates messages with separators', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'txt',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).toMatch(/\n-{20,}/); // Has separator lines
    });

    it('includes conversation title', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'txt',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).toContain('Test Conversation');
    });

    it('omits the metadata block when the metadata option is off', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'txt',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).not.toContain('Platform:');
      expect(text).not.toContain('URL:');
    });

    it('includes the metadata block when the metadata option is on', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'txt',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).toContain('Platform:');
      expect(text).toContain('URL:');
    });
  });

  describe('link rendering', () => {
    function buildLinkPair(href: string, linkText: string): QAPair {
      return {
        id: 'pair-link',
        index: 0,
        selected: true,
        question: {
          id: 'q-link',
          role: 'user',
          content: 'question',
          timestamp: new Date('2025-01-01T12:00:00Z'),
        },
        answer: {
          id: 'a-link',
          role: 'assistant',
          content: 'fallback',
          htmlContent: `<p>See <a href="${href}">${linkText}</a> for details.</p>`,
          timestamp: new Date('2025-01-01T12:00:00Z'),
        },
      };
    }

    it('renders both the anchor text and its destination URL', async () => {
      const pair = buildLinkPair('https://example.com/source', 'the source');
      const conversation = createTestConversation([pair]);
      const result = await exporter.export(conversation, [pair], {
        format: 'txt',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).toContain('the source');
      expect(text).toContain('https://example.com/source');
    });

    it('omits the redundant URL suffix when the link text is the URL itself', async () => {
      const pair = buildLinkPair('https://example.com/', 'https://example.com/');
      const conversation = createTestConversation([pair]);
      const result = await exporter.export(conversation, [pair], {
        format: 'txt',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).toContain('https://example.com/');
      expect(text).not.toContain('https://example.com/ (https://example.com/)');
    });
  });

  describe('validateOptions()', () => {
    it('returns true for valid options', () => {
      const valid = exporter.validateOptions({
        format: 'txt',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: false,
      });
      expect(valid).toBe(true);
    });

    it('returns false for wrong format', () => {
      const valid = exporter.validateOptions({
        format: 'pdf',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: false,
      });
      expect(valid).toBe(false);
    });
  });
});
