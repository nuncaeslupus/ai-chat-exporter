/**
 * Conversation Structure Service Tests
 *
 * Regression coverage for lo-3005: a message carrying web-search or artifact
 * metadata used to discard htmlContent entirely and flatten to one paragraph,
 * destroying lists/tables/headings/code blocks.
 */

import { describe, it, expect } from 'vitest';
import { ConversationStructureService } from '../../../../src/core/services/conversation-structure-service';
import type { Conversation, StructuredContentBlock } from '../../../../src/core/types';

function isMarkerParagraph(block: StructuredContentBlock, text: string): boolean {
  return (
    block.type === 'paragraph' &&
    block.content[0]?.type === 'text' &&
    block.content[0].text === text
  );
}

function buildConversation(answerOverrides: Record<string, unknown>): Conversation {
  return {
    id: 'c1',
    title: 'Test',
    platform: 'claude',
    url: 'https://claude.ai/chat/1',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    pairs: [
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
          ...answerOverrides,
        },
      },
    ],
  } as unknown as Conversation;
}

describe('ConversationStructureService', () => {
  it('keeps the parsed list intact when the message has a web search', () => {
    const conversation = buildConversation({
      metadata: { webSearches: [{ query: 'first two points', resultCount: 2 }] },
    });

    const structured = ConversationStructureService.toStructured(conversation);
    const blocks = structured.pairs[0]!.answer.blocks;

    const listBlock = blocks.find((b) => b.type === 'list');

    expect(listBlock).toBeDefined();
    expect(listBlock!.ordered).toBe(true);
    expect(listBlock!.items).toHaveLength(2);
    expect(listBlock!.items[0]!.content[0]!.text).toBe('First point');
    expect(listBlock!.items[1]!.content[0]!.text).toBe('Second point');
  });

  it('appends the web search marker as its own block instead of replacing the list', () => {
    const conversation = buildConversation({
      metadata: { webSearches: [{ query: 'first two points', resultCount: 2 }] },
    });

    const structured = ConversationStructureService.toStructured(conversation);
    const blocks = structured.pairs[0]!.answer.blocks;

    const markerBlock = blocks.find((b) => isMarkerParagraph(b, '[Web Search: first two points]'));
    expect(markerBlock).toBeDefined();
  });

  it('keeps the parsed list intact when the message has an artifact', () => {
    const conversation = buildConversation({
      content: '[Document: My Doc]\n\nFirst pointSecond point',
      metadata: { artifacts: [{ type: 'document', typeLabel: 'Document', title: 'My Doc' }] },
    });

    const structured = ConversationStructureService.toStructured(conversation);
    const blocks = structured.pairs[0]!.answer.blocks;

    const listBlock = blocks.find((b) => b.type === 'list');
    expect(listBlock).toBeDefined();

    const markerBlock = blocks.find((b) => isMarkerParagraph(b, '[Document: My Doc]'));
    expect(markerBlock).toBeDefined();
  });
});
