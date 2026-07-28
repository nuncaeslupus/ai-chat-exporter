/**
 * Filename Service Tests
 */

import { describe, it, expect } from 'vitest';
import { FilenameService } from '../../../../src/core/services/filename-service';
import type { FilenameVariables } from '../../../../src/core/types/config';

describe('FilenameService', () => {
  describe('generateFilename()', () => {
    it('replaces all template variables', () => {
      const variables: FilenameVariables = {
        platform: 'ChatGPT',
        title: 'My Conversation',
        date: '2025-01-01',
        time: '14-30',
        datetime: '2025-01-01_14-30',
        model: 'gpt-4',
      };
      const template = '{platform}_{title}_{datetime}_{model}';
      const result = FilenameService.generateFilename(template, variables);
      expect(result).toBe('ChatGPT_My-Conversation_2025-01-01_14-30_gpt-4');
    });

    it('handles default template correctly', () => {
      const variables: FilenameVariables = {
        platform: 'ChatGPT',
        title: 'Test',
        date: '2025-01-01',
        time: '14-30',
        datetime: '2025-01-01_14-30',
      };
      const template = '{platform}_{title}_{datetime}';
      const result = FilenameService.generateFilename(template, variables);
      expect(result).toBe('ChatGPT_Test_2025-01-01_14-30');
    });

    it('handles template with only title', () => {
      const variables: FilenameVariables = {
        platform: 'ChatGPT',
        title: 'Simple Title',
        date: '2025-01-01',
        time: '14-30',
        datetime: '2025-01-01_14-30',
      };
      const template = '{title}';
      const result = FilenameService.generateFilename(template, variables);
      expect(result).toBe('Simple-Title');
    });

    it('handles template with date and time separately', () => {
      const variables: FilenameVariables = {
        platform: 'ChatGPT',
        title: 'Test',
        date: '2025-01-01',
        time: '14-30',
        datetime: '2025-01-01_14-30',
      };
      const template = '{date}_{time}_{title}';
      const result = FilenameService.generateFilename(template, variables);
      expect(result).toBe('2025-01-01_14-30_Test');
    });

    it('handles missing optional model variable', () => {
      const variables: FilenameVariables = {
        platform: 'ChatGPT',
        title: 'Test',
        date: '2025-01-01',
        time: '14-30',
        datetime: '2025-01-01_14-30',
      };
      const template = '{platform}_{title}_{model}';
      const result = FilenameService.generateFilename(template, variables);
      expect(result).toBe('ChatGPT_Test');
    });

    it('sanitizes special characters in title', () => {
      const variables: FilenameVariables = {
        platform: 'ChatGPT',
        title: 'Test/File\\Name:With*Special?Chars',
        date: '2025-01-01',
        time: '14-30',
        datetime: '2025-01-01_14-30',
      };
      const template = '{title}';
      const result = FilenameService.generateFilename(template, variables);
      expect(result).not.toContain('/');
      expect(result).not.toContain('\\');
      expect(result).not.toContain(':');
      expect(result).not.toContain('*');
      expect(result).not.toContain('?');
    });

    it('replaces spaces with hyphens', () => {
      const variables: FilenameVariables = {
        platform: 'ChatGPT',
        title: 'My Test Conversation',
        date: '2025-01-01',
        time: '14-30',
        datetime: '2025-01-01_14-30',
      };
      const template = '{title}';
      const result = FilenameService.generateFilename(template, variables);
      expect(result).toBe('My-Test-Conversation');
    });

    it('removes multiple consecutive hyphens', () => {
      const variables: FilenameVariables = {
        platform: 'ChatGPT',
        title: 'Test  --  Conversation',
        date: '2025-01-01',
        time: '14-30',
        datetime: '2025-01-01_14-30',
      };
      const template = '{title}';
      const result = FilenameService.generateFilename(template, variables);
      expect(result).not.toContain('--');
      expect(result).not.toContain('---');
    });

    it('trims leading and trailing hyphens', () => {
      const variables: FilenameVariables = {
        platform: 'ChatGPT',
        title: '  Test Conversation  ',
        date: '2025-01-01',
        time: '14-30',
        datetime: '2025-01-01_14-30',
      };
      const template = '{title}';
      const result = FilenameService.generateFilename(template, variables);
      expect(result).toBe('Test-Conversation');
      expect(result.startsWith('-')).toBe(false);
      expect(result.endsWith('-')).toBe(false);
    });

    it('handles long titles by truncating', () => {
      const variables: FilenameVariables = {
        platform: 'ChatGPT',
        title: 'A'.repeat(300),
        date: '2025-01-01',
        time: '14-30',
        datetime: '2025-01-01_14-30',
      };
      const template = '{title}';
      const result = FilenameService.generateFilename(template, variables);
      expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(255);
      expect(result.length).toBeLessThan(300);
    });

    it('handles Unicode characters correctly', () => {
      const variables: FilenameVariables = {
        platform: 'ChatGPT',
        title: 'Test 测试 テスト тест',
        date: '2025-01-01',
        time: '14-30',
        datetime: '2025-01-01_14-30',
      };
      const template = '{title}';
      const result = FilenameService.generateFilename(template, variables);
      expect(result).toContain('测试');
      expect(result).toContain('テスト');
      expect(result).toContain('тест');
    });

    it('handles empty title gracefully', () => {
      const variables: FilenameVariables = {
        platform: 'ChatGPT',
        title: '',
        date: '2025-01-01',
        time: '14-30',
        datetime: '2025-01-01_14-30',
      };
      const template = '{title}_{date}';
      const result = FilenameService.generateFilename(template, variables);
      expect(result).toBe('2025-01-01');
    });

    it('handles template with no variables', () => {
      const variables: FilenameVariables = {
        platform: 'ChatGPT',
        title: 'Test',
        date: '2025-01-01',
        time: '14-30',
        datetime: '2025-01-01_14-30',
      };
      const template = 'static-filename';
      const result = FilenameService.generateFilename(template, variables);
      expect(result).toBe('static-filename');
    });
  });

  describe('sanitizeFilename()', () => {
    it('removes forbidden characters', () => {
      const filename = 'test/file\\name:with*special?chars<>"pipe|';
      const result = FilenameService.sanitizeFilename(filename);
      expect(result).not.toContain('/');
      expect(result).not.toContain('\\');
      expect(result).not.toContain(':');
      expect(result).not.toContain('*');
      expect(result).not.toContain('?');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).not.toContain('"');
      expect(result).not.toContain('|');
    });

    it('replaces spaces with hyphens', () => {
      const filename = 'test file name';
      const result = FilenameService.sanitizeFilename(filename);
      expect(result).toBe('test-file-name');
    });

    it('removes multiple consecutive hyphens', () => {
      const filename = 'test---file--name';
      const result = FilenameService.sanitizeFilename(filename);
      expect(result).toBe('test-file-name');
    });

    it('trims leading and trailing hyphens', () => {
      const filename = '---test---';
      const result = FilenameService.sanitizeFilename(filename);
      expect(result).toBe('test');
    });

    it('preserves allowed characters', () => {
      const filename = 'test_file-name.2025';
      const result = FilenameService.sanitizeFilename(filename);
      expect(result).toBe('test_file-name.2025');
    });

    it('handles empty string', () => {
      const filename = '';
      const result = FilenameService.sanitizeFilename(filename);
      expect(result).toBe('');
    });

    it('handles string with only forbidden characters', () => {
      const filename = '///:::***';
      const result = FilenameService.sanitizeFilename(filename);
      expect(result).toBe('');
    });

    it('truncates to max length (plain ASCII, no regression)', () => {
      const filename = 'A'.repeat(300);
      const result = FilenameService.sanitizeFilename(filename);
      expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(255);
      expect(result.length).toBeLessThan(300);
    });

    it('truncates a long CJK title by UTF-8 byte length, not UTF-16 length', () => {
      // Each CJK char is 1 UTF-16 code unit but 3 UTF-8 bytes.
      const filename = '测'.repeat(200);
      const result = FilenameService.sanitizeFilename(filename);
      const byteLength = new TextEncoder().encode(result).length;
      // Leaves room for a caller-appended extension within the 255-byte ceiling.
      expect(byteLength).toBeLessThanOrEqual(255 - 10);
      // Proves truncation actually happened on byte count, not code-unit count.
      expect(result.length).toBeLessThan(200);
    });

    it('truncates an emoji title without splitting a surrogate pair', () => {
      // Each emoji here is a single surrogate-pair code point (2 UTF-16 units, 4 UTF-8 bytes).
      const filename = '😀'.repeat(150);
      const result = FilenameService.sanitizeFilename(filename);
      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(255 - 10);
      // No lone/unpaired surrogate anywhere in the result.
      const loneHighSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
      const loneLowSurrogate = /(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
      expect(loneHighSurrogate.test(result)).toBe(false);
      expect(loneLowSurrogate.test(result)).toBe(false);
    });

    it('truncates a title with combining marks and stays within the byte ceiling', () => {
      // Base letter + combining acute accent (U+0301), 3 UTF-8 bytes per pair.
      const filename = 'á'.repeat(150);
      const result = FilenameService.sanitizeFilename(filename);
      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(255 - 10);
    });
  });

  describe('getVariablesFromConversation()', () => {
    it('generates all variables correctly', () => {
      const conversation = {
        id: '123',
        title: 'Test Conversation',
        platform: 'chatgpt' as const,
        model: 'gpt-4',
        pairs: [],
        url: 'https://chatgpt.com',
        createdAt: new Date('2025-01-01T14:30:00'),
      };
      const variables = FilenameService.getVariablesFromConversation(conversation);
      expect(variables.platform).toBe('ChatGPT');
      expect(variables.title).toBe('Test Conversation');
      expect(variables.date).toBe('2025-01-01');
      expect(variables.time).toBe('14-30');
      expect(variables.datetime).toBe('2025-01-01_14-30');
      expect(variables.model).toBe('gpt-4');
    });

    it('handles different platforms correctly', () => {
      const conversation = {
        id: '123',
        title: 'Test',
        platform: 'claude' as const,
        pairs: [],
        url: 'https://claude.ai',
      };
      const variables = FilenameService.getVariablesFromConversation(conversation);
      expect(variables.platform).toBe('Claude');
    });

    it('handles missing model', () => {
      const conversation = {
        id: '123',
        title: 'Test',
        platform: 'chatgpt' as const,
        pairs: [],
        url: 'https://chatgpt.com',
      };
      const variables = FilenameService.getVariablesFromConversation(conversation);
      expect(variables.model).toBeUndefined();
    });

    it('handles missing createdAt with current time', () => {
      const conversation = {
        id: '123',
        title: 'Test',
        platform: 'chatgpt' as const,
        pairs: [],
        url: 'https://chatgpt.com',
      };
      const variables = FilenameService.getVariablesFromConversation(conversation);
      expect(variables.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(variables.time).toMatch(/^\d{2}-\d{2}$/);
      expect(variables.datetime).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/);
    });
  });

  describe('addExtension()', () => {
    it('adds extension to filename without extension', () => {
      const result = FilenameService.addExtension('test-file', 'pdf');
      expect(result).toBe('test-file.pdf');
    });

    it('replaces existing extension', () => {
      const result = FilenameService.addExtension('test-file.txt', 'pdf');
      expect(result).toBe('test-file.pdf');
    });

    it('handles multiple dots in filename', () => {
      const result = FilenameService.addExtension('test.file.name.txt', 'pdf');
      expect(result).toBe('test.file.name.pdf');
    });

    it('handles extension with dot', () => {
      const result = FilenameService.addExtension('test-file', '.pdf');
      expect(result).toBe('test-file.pdf');
    });

    it('handles empty filename', () => {
      const result = FilenameService.addExtension('', 'pdf');
      expect(result).toBe('.pdf');
    });
  });
});
