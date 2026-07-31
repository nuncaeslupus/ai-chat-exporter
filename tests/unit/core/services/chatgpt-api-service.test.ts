/**
 * ChatGPT API Service Tests
 *
 * D-18 (#141): a fabricated timestamp is worse than none. Every failure path
 * below (no id, fetch failure, count mismatch, missing/unparseable
 * create_time) must leave `Message.timestamp` unset, never a guessed value.
 */

import { describe, it, expect, vi } from 'vitest';
import { ChatGPTApiService } from '../../../../src/core/services/chatgpt-api-service';
import type { Conversation, QAPair, Message } from '../../../../src/core/types';
import type { ChatGPTApiConversationResponse, ChatGPTApiMessage } from '../../../../src/core/types';

function makeMessage(role: 'user' | 'assistant', text: string): Message {
  return {
    id: `dom-${Math.random().toString(36).slice(2)}`,
    role,
    content: text,
  };
}

function makePair(index: number, question: string, answer: string): QAPair {
  return {
    id: `pair-${String(index)}`,
    index,
    question: makeMessage('user', question),
    answer: makeMessage('assistant', answer),
    selected: true,
  };
}

function makeConversation(pairs: QAPair[]): Conversation {
  return {
    id: 'conv-1',
    title: 'Test conversation',
    platform: 'chatgpt',
    pairs,
    url: 'https://chatgpt.com/c/00000000-0000-4000-8000-000000000000',
  };
}

function makeApiMessage(
  id: string,
  role: 'user' | 'assistant' | 'system' | 'tool',
  createTime: number | null = 1721990472
): ChatGPTApiMessage {
  return {
    id,
    author: { role },
    create_time: createTime,
    content: { content_type: 'text', parts: [''] },
  };
}

/**
 * Builds a `mapping` as a straight-line chain root -> ... -> leaf, matching
 * `nodes` order, and sets `current_node` to the last one. This is the common
 * (no branching) shape; branch-divergence tests build their own mapping.
 */
function makeMapping(nodes: ChatGPTApiMessage[]): ChatGPTApiConversationResponse {
  const mapping: ChatGPTApiConversationResponse['mapping'] = {};
  let parent: string | null = null;
  nodes.forEach((message, i) => {
    const nodeId = `node-${String(i)}`;
    mapping[nodeId] = { id: nodeId, message, parent, children: [] };
    parent = nodeId;
  });
  return {
    title: 'Test',
    mapping,
    current_node: `node-${String(nodes.length - 1)}`,
  };
}

describe('ChatGPTApiService', () => {
  describe('extractIdsFromPage()', () => {
    it('extracts the conversation id from a chatgpt.com URL', () => {
      const ids = ChatGPTApiService.extractIdsFromPage(
        'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111'
      );
      expect(ids).toEqual({ conversationId: '11111111-1111-4111-8111-111111111111' });
    });

    it('extracts the conversation id from the legacy chat.openai.com URL', () => {
      const ids = ChatGPTApiService.extractIdsFromPage(
        'https://chat.openai.com/c/22222222-2222-4222-8222-222222222222'
      );
      expect(ids).toEqual({ conversationId: '22222222-2222-4222-8222-222222222222' });
    });

    it('returns null and warns when the URL has no conversation id (e.g. the new-chat page)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const ids = ChatGPTApiService.extractIdsFromPage('https://chatgpt.com/');

      expect(ids).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not extract conversation ID'),
        expect.any(String)
      );
      warnSpy.mockRestore();
    });
  });

  describe('fetchConversationData()', () => {
    function mockSendMessage(): ReturnType<typeof vi.fn> {
      return chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;
    }

    it('returns null (never fabricates) when the background reports failure', async () => {
      mockSendMessage().mockResolvedValueOnce({ success: false, error: 'not signed in' });

      const data = await ChatGPTApiService.fetchConversationData({
        conversationId: '11111111-1111-4111-8111-111111111111',
      });

      expect(data).toBeNull();
    });

    it('returns null (never fabricates) when the message channel throws', async () => {
      mockSendMessage().mockRejectedValueOnce(new Error('extension context invalidated'));

      const data = await ChatGPTApiService.fetchConversationData({
        conversationId: '11111111-1111-4111-8111-111111111111',
      });

      expect(data).toBeNull();
    });

    it('returns the payload on success', async () => {
      const apiData = makeMapping([makeApiMessage('u1', 'user')]);
      mockSendMessage().mockResolvedValueOnce({ success: true, data: apiData });

      const data = await ChatGPTApiService.fetchConversationData({
        conversationId: '11111111-1111-4111-8111-111111111111',
      });

      expect(data).toEqual(apiData);
    });
  });

  describe('enrichConversation()', () => {
    it('stamps both messages of a pair from the linearized mapping', () => {
      const conversation = makeConversation([makePair(0, 'Q', 'A')]);
      const apiData = makeMapping([
        makeApiMessage('u1', 'user', 1721990472),
        makeApiMessage('a1', 'assistant', 1721990500),
      ]);

      const { conversation: enriched, warning } = ChatGPTApiService.enrichConversation(
        conversation,
        apiData
      );

      expect(warning).toBeUndefined();
      expect(enriched.pairs[0]?.question.timestamp).toEqual(new Date(1721990472 * 1000));
      expect(enriched.pairs[0]?.answer.timestamp).toEqual(new Date(1721990500 * 1000));
    });

    it('walks current_node back to the root, ignoring an abandoned regenerated branch', () => {
      // root -> user -> assistant(dead branch, older) and
      //               -> assistant(current, kept)
      const conversation = makeConversation([makePair(0, 'Q', 'A')]);
      const mapping: ChatGPTApiConversationResponse['mapping'] = {
        root: { id: 'root', message: null, parent: null, children: ['n-user'] },
        'n-user': {
          id: 'n-user',
          message: makeApiMessage('u1', 'user', 1000),
          parent: 'root',
          children: ['n-assistant-old', 'n-assistant-new'],
        },
        'n-assistant-old': {
          id: 'n-assistant-old',
          message: makeApiMessage('a-old', 'assistant', 2000),
          parent: 'n-user',
          children: [],
        },
        'n-assistant-new': {
          id: 'n-assistant-new',
          message: makeApiMessage('a-new', 'assistant', 3000),
          parent: 'n-user',
          children: [],
        },
      };
      const apiData: ChatGPTApiConversationResponse = {
        mapping,
        current_node: 'n-assistant-new',
      };

      const { conversation: enriched, warning } = ChatGPTApiService.enrichConversation(
        conversation,
        apiData
      );

      expect(warning).toBeUndefined();
      expect(enriched.pairs[0]?.answer.timestamp).toEqual(new Date(3000 * 1000));
    });

    it('skips system/tool nodes when linearizing so they do not desync the positional match', () => {
      const conversation = makeConversation([makePair(0, 'Q', 'A')]);
      const apiData = makeMapping([
        makeApiMessage('sys', 'system', 500),
        makeApiMessage('u1', 'user', 1000),
        makeApiMessage('tool1', 'tool', 1500),
        makeApiMessage('a1', 'assistant', 2000),
      ]);

      const { conversation: enriched, warning } = ChatGPTApiService.enrichConversation(
        conversation,
        apiData
      );

      expect(warning).toBeUndefined();
      expect(enriched.pairs[0]?.question.timestamp).toEqual(new Date(1000 * 1000));
      expect(enriched.pairs[0]?.answer.timestamp).toEqual(new Date(2000 * 1000));
    });

    it('never fabricates a timestamp: leaves it unset when create_time is null', () => {
      const conversation = makeConversation([makePair(0, 'Q', 'A')]);
      const apiData = makeMapping([
        makeApiMessage('u1', 'user', null),
        makeApiMessage('a1', 'assistant', 2000),
      ]);

      const { conversation: enriched } = ChatGPTApiService.enrichConversation(
        conversation,
        apiData
      );

      expect(enriched.pairs[0]?.question.timestamp).toBeUndefined();
      expect(enriched.pairs[0]?.answer.timestamp).toEqual(new Date(2000 * 1000));
    });

    it('never fabricates a timestamp: leaves it unset when create_time is NaN', () => {
      const conversation = makeConversation([makePair(0, 'Q', 'A')]);
      const apiData = makeMapping([
        makeApiMessage('u1', 'user', NaN),
        makeApiMessage('a1', 'assistant', 2000),
      ]);

      const { conversation: enriched } = ChatGPTApiService.enrichConversation(
        conversation,
        apiData
      );

      expect(enriched.pairs[0]?.question.timestamp).toBeUndefined();
    });

    it('never fabricates a timestamp: an edited/regenerated turn (count mismatch) leaves every timestamp unset', () => {
      // DOM scraped 2 pairs, but the linearized API path only has 1 user + 1
      // assistant message (e.g. the DOM saw a turn the API branch no longer
      // has current, or vice versa) -- must not guess a pairing.
      const conversation = makeConversation([makePair(0, 'Q1', 'A1'), makePair(1, 'Q2', 'A2')]);
      const apiData = makeMapping([
        makeApiMessage('u1', 'user'),
        makeApiMessage('a1', 'assistant'),
      ]);

      const result = ChatGPTApiService.enrichConversation(conversation, apiData);

      expect(result.conversation.pairs[0]?.question.timestamp).toBeUndefined();
      expect(result.conversation.pairs[0]?.answer.timestamp).toBeUndefined();
      expect(result.conversation.pairs[1]?.question.timestamp).toBeUndefined();
      expect(result.conversation.pairs[1]?.answer.timestamp).toBeUndefined();
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('1 user message');
      expect(result.warning).toContain('1 assistant message');
    });

    it('never fabricates a timestamp: an empty mapping (endpoint returned nothing usable) leaves every timestamp unset', () => {
      const conversation = makeConversation([makePair(0, 'Q', 'A')]);
      const apiData: ChatGPTApiConversationResponse = { mapping: {}, current_node: 'missing' };

      const result = ChatGPTApiService.enrichConversation(conversation, apiData);

      expect(result.conversation.pairs[0]?.question.timestamp).toBeUndefined();
      expect(result.conversation.pairs[0]?.answer.timestamp).toBeUndefined();
      expect(result.warning).toBeDefined();
    });
  });
});
