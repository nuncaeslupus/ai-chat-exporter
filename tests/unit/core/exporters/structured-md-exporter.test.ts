/**
 * Structured Markdown Exporter Tests
 */

import { describe, it, expect } from 'vitest';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { blobToText } from '../../../utils/exporter-helpers';

function buildPair(withTimestamp: boolean): QAPair {
  return {
    id: 'pair-0',
    index: 0,
    selected: true,
    question: {
      id: 'q-0',
      role: 'user',
      content: 'plain question',
      timestamp: withTimestamp ? new Date('2025-01-01T12:00:00Z') : undefined,
    },
    answer: {
      id: 'a-0',
      role: 'assistant',
      content: 'plain answer',
      timestamp: withTimestamp ? new Date('2025-01-01T12:00:00Z') : undefined,
    },
  } as unknown as QAPair;
}

function buildConversation(pair: QAPair): Conversation {
  return {
    id: 'test-conversation',
    title: 'Test Conversation',
    platform: 'chatgpt',
    model: 'gpt-4',
    pairs: [pair],
    url: 'https://chatgpt.com/c/test',
    createdAt: new Date('2025-01-01T12:00:00Z'),
  } as unknown as Conversation;
}

describe('StructuredMarkdownExporter timestamps', () => {
  it('renders a per-message timestamp when includeTimestamps is on', async () => {
    const pair = buildPair(true);
    const conversation = buildConversation(pair);
    const result = await new StructuredMarkdownExporter().export(conversation, [pair], {
      format: 'md',
      filename: 'test',
      includeMetadata: false,
      includeTimestamps: true,
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain('(12:00:00)');
    // The day is announced once by a day separator, not repeated per message.
    expect(text).not.toContain('2025-01-01 12:00:00');
  });

  it('omits the timestamp when includeTimestamps is off', async () => {
    const pair = buildPair(true);
    const conversation = buildConversation(pair);
    const result = await new StructuredMarkdownExporter().export(conversation, [pair], {
      format: 'md',
      filename: 'test',
      includeMetadata: false,
      includeTimestamps: false,
    });
    const text = await blobToText(result.blob!);
    expect(text).not.toContain('12:00:00');
  });

  it('emits no stray label or "undefined" when a message has no timestamp', async () => {
    const pair = buildPair(false);
    const conversation = buildConversation(pair);
    const result = await new StructuredMarkdownExporter().export(conversation, [pair], {
      format: 'md',
      filename: 'test',
      includeMetadata: false,
      includeTimestamps: true,
    });
    const text = await blobToText(result.blob!);
    expect(text).not.toContain('undefined');
    expect(text).not.toMatch(/\(\s*\)/); // no empty "()" left behind
  });
});
