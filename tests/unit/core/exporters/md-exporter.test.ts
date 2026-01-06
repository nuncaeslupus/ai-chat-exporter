/**
 * Markdown Exporter Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { MarkdownExporter } from '../../../../src/core/exporters/md-exporter';
import {
  blobToText,
  createTestQAPair,
  createTestConversation,
} from '../../../utils/exporter-helpers';

describe('MarkdownExporter', () => {
  let exporter: MarkdownExporter;
  let conversation: Conversation;
  let selectedPairs: QAPair[];

  beforeEach(() => {
    exporter = new MarkdownExporter();
    const pairs = [
      createTestQAPair(0, 'What is TypeScript?', 'TypeScript is a typed superset of JavaScript.'),
      createTestQAPair(1, 'How do I use it?', 'You can install it with npm: `npm install typescript`'),
      createTestQAPair(2, 'Thanks!', 'You are welcome!', false), // Not selected
    ];
    conversation = createTestConversation(pairs);
    selectedPairs = pairs.filter((p) => p.selected);
  });

  describe('format property', () => {
    it('returns "md"', () => {
      expect(exporter.format).toBe('md');
    });
  });

  describe('extension property', () => {
    it('returns "md"', () => {
      expect(exporter.extension).toBe('md');
    });
  });

  describe('mimeType property', () => {
    it('returns "text/markdown"', () => {
      expect(exporter.mimeType).toBe('text/markdown');
    });
  });

  describe('export()', () => {
    it('returns success with valid blob', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'md',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: false,
      });
      expect(result.success).toBe(true);
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toBe('test.md');
      expect(result.mimeType).toBe('text/markdown');
    });

    it('includes title in output', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'md',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).toContain('# Test Conversation');
    });

    it('includes metadata when requested', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'md',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).toContain('**Platform:** ChatGPT');
      expect(text).toContain('**Model:** gpt-4');
    });

    it('excludes metadata when not requested', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'md',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).not.toContain('Platform:');
    });

    it('formats Q&A pairs correctly', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'md',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).toContain('## User');
      expect(text).toContain('What is TypeScript?');
      expect(text).toContain('## Assistant');
      expect(text).toContain('TypeScript is a typed superset of JavaScript.');
    });

    it('only includes selected pairs', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'md',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).toContain('What is TypeScript?');
      expect(text).toContain('How do I use it?');
      expect(text).not.toContain('Thanks!'); // Not selected
    });

    it('handles empty selected pairs', async () => {
      const result = await exporter.export(conversation, [], {
        format: 'md',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: false,
      });
      expect(result.success).toBe(true);
      const text = await blobToText(result.blob!);
      expect(text).toContain('# Test Conversation');
    });

    it('includes timestamps when requested', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'md',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: true,
      });
      const text = await blobToText(result.blob!);
      expect(text).toMatch(/\d{4}-\d{2}-\d{2}/); // Date format
    });
  });

  describe('validateOptions()', () => {
    it('returns true for valid options', () => {
      const valid = exporter.validateOptions({
        format: 'md',
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

    it('returns false for empty filename', () => {
      const valid = exporter.validateOptions({
        format: 'md',
        filename: '',
        includeMetadata: true,
        includeTimestamps: false,
      });
      expect(valid).toBe(false);
    });
  });
});
