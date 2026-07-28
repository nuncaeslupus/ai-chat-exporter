/**
 * JSON Exporter Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { JsonExporter } from '../../../../src/core/exporters/json-exporter';
import {
  blobToText,
  createTestQAPair,
  createTestConversation,
} from '../../../utils/exporter-helpers';

describe('JsonExporter', () => {
  let exporter: JsonExporter;
  let conversation: Conversation;
  let selectedPairs: QAPair[];

  beforeEach(() => {
    exporter = new JsonExporter();
    const pairs = [
      createTestQAPair(0, 'What is TypeScript?', 'TypeScript is a typed superset of JavaScript.'),
      createTestQAPair(1, 'How do I use it?', 'You can install it with npm.'),
    ];
    conversation = createTestConversation(pairs);
    selectedPairs = pairs;
  });

  describe('format property', () => {
    it('returns "json"', () => {
      expect(exporter.format).toBe('json');
    });
  });

  describe('extension property', () => {
    it('returns "json"', () => {
      expect(exporter.extension).toBe('json');
    });
  });

  describe('mimeType property', () => {
    it('returns "application/json"', () => {
      expect(exporter.mimeType).toBe('application/json');
    });
  });

  describe('export()', () => {
    it('returns success with valid blob', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'json',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: true,
      });
      expect(result.success).toBe(true);
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toBe('test.json');
    });

    it('outputs valid JSON', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'json',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: true,
      });
      const text = await blobToText(result.blob!);
      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('includes conversation metadata', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'json',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: true,
      });
      const text = await blobToText(result.blob!);
      const parsed = JSON.parse(text);
      expect(parsed.title).toBe('Test Conversation');
      expect(parsed.platform).toBe('chatgpt');
      expect(parsed.model).toBe('gpt-4');
    });

    it('includes messages in pairs', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'json',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: true,
      });
      const text = await blobToText(result.blob!);
      const parsed = JSON.parse(text);
      expect(parsed.pairs).toHaveLength(2);
      expect(parsed.pairs[0].question.content).toBe('What is TypeScript?');
      expect(parsed.pairs[0].answer.content).toBe('TypeScript is a typed superset of JavaScript.');
    });

    it('formats output with indentation', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'json',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: true,
      });
      const text = await blobToText(result.blob!);
      expect(text).toContain('\n'); // Has newlines (formatted)
      expect(text).toMatch(/^\s+"/m); // Has indentation
    });
  });

  describe('includeMetadata gating', () => {
    it('omits title/platform/url/model/createdAt when includeMetadata is false', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'json',
        filename: 'test',
        includeMetadata: false,
        includeTimestamps: true,
      });
      const text = await blobToText(result.blob!);
      const parsed = JSON.parse(text);
      expect(parsed.title).toBeUndefined();
      expect(parsed.platform).toBeUndefined();
      expect(parsed.url).toBeUndefined();
      expect(parsed.model).toBeUndefined();
      expect(parsed.createdAt).toBeUndefined();
    });

    it('includes title/platform/url/model/createdAt when includeMetadata is true', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'json',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: true,
      });
      const text = await blobToText(result.blob!);
      const parsed = JSON.parse(text);
      expect(parsed.title).toBe('Test Conversation');
      expect(parsed.platform).toBe('chatgpt');
      expect(parsed.url).toBe('https://chatgpt.com/c/test');
      expect(parsed.model).toBe('gpt-4');
      expect(parsed.createdAt).toBeDefined();
    });
  });

  describe('validateOptions()', () => {
    it('returns true for valid options', () => {
      const valid = exporter.validateOptions({
        format: 'json',
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
