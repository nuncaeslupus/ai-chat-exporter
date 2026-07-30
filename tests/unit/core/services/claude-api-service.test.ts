/**
 * Claude API Service Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { ClaudeApiService } from '../../../../src/core/services/claude-api-service';
import type { Conversation, QAPair, Message } from '../../../../src/core/types';
import type {
  ClaudeApiConversationResponse,
  ClaudeApiChatMessage,
} from '../../../../src/core/types';

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
    platform: 'claude',
    pairs,
    url: 'https://claude.ai/chat/00000000-0000-4000-8000-000000000000',
  };
}

function makeApiMessage(
  uuid: string,
  index: number,
  sender: 'human' | 'assistant',
  content: ClaudeApiChatMessage['content'] = [],
  createdAt = '2026-01-01T00:00:00Z'
): ClaudeApiChatMessage {
  return {
    uuid,
    text: '',
    sender,
    index,
    created_at: createdAt,
    updated_at: createdAt,
    content,
  };
}

function artifactContent(title: string, content: string, id = title) {
  return {
    type: 'tool_use' as const,
    name: 'artifacts',
    input: {
      id,
      type: 'text/markdown',
      title,
      content,
    },
  };
}

function makeNextDataDocument(organizationId: string): Document {
  const doc = document.implementation.createHTMLDocument('test');
  const script = doc.createElement('script');
  script.id = '__NEXT_DATA__';
  script.textContent = JSON.stringify({ props: { pageProps: { organizationId } } });
  doc.body.appendChild(script);
  return doc;
}

/** No __NEXT_DATA__/localStorage hit, only a `data-organization-id` element —
 * a source that must resolve without ever falling through to the full-page
 * HTML scrape. */
function makeDataAttributeDocument(organizationId: string): Document {
  const doc = document.implementation.createHTMLDocument('test');
  const el = doc.createElement('div');
  el.setAttribute('data-organization-id', organizationId);
  doc.body.appendChild(el);
  return doc;
}

/** Replaces `documentElement.innerHTML` with a getter that records access,
 * so a test can assert the full document was (or was not) serialized. */
function spyOnInnerHtmlAccess(doc: Document): { wasAccessed: () => boolean } {
  let accessed = false;
  Object.defineProperty(doc.documentElement, 'innerHTML', {
    configurable: true,
    get() {
      accessed = true;
      return '';
    },
  });
  return { wasAccessed: () => accessed };
}

describe('ClaudeApiService', () => {
  describe('extractOrganizationId()', () => {
    it('does not serialize the whole document when a cheap source (data-organization-id attribute) resolves the org id', () => {
      // Regression guard for the full-page-serialization bug: the org id here
      // is only discoverable via the data-attribute check, which used to run
      // *after* the expensive innerHTML scrape. If that scrape still ran
      // first, this would fail.
      const doc = makeDataAttributeDocument('33333333-3333-4333-8333-333333333333');
      const innerHtml = spyOnInnerHtmlAccess(doc);

      const orgId = ClaudeApiService.extractOrganizationId(doc);

      expect(orgId).toBe('33333333-3333-4333-8333-333333333333');
      expect(innerHtml.wasAccessed()).toBe(false);
    });

    it('caches the resolved organization id so a second call does not re-scan the document', () => {
      const doc = makeNextDataDocument('22222222-2222-4222-8222-222222222222');
      const getElementByIdSpy = vi.spyOn(doc, 'getElementById');

      const first = ClaudeApiService.extractOrganizationId(doc);
      const second = ClaudeApiService.extractOrganizationId(doc);

      expect(first).toBe('22222222-2222-4222-8222-222222222222');
      expect(second).toBe(first);
      expect(getElementByIdSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('enrichConversation()', () => {
    it('attributes an artifact to its matching pair when DOM and API shapes agree', () => {
      const conversation = makeConversation([makePair(0, 'Q1', 'A1'), makePair(1, 'Q2', 'A2')]);

      const apiData: ClaudeApiConversationResponse = {
        uuid: 'conv-1',
        name: 'Test',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        chat_messages: [
          makeApiMessage('u1', 0, 'human'),
          makeApiMessage('a1', 1, 'assistant'),
          makeApiMessage('u2', 2, 'human'),
          makeApiMessage('a2', 3, 'assistant', [artifactContent('Doc', 'second content')]),
        ],
      };

      const { conversation: enriched, warning } = ClaudeApiService.enrichConversation(
        conversation,
        apiData
      );

      expect(enriched.pairs[0]?.answer.metadata?.artifacts ?? []).toHaveLength(0);
      expect(enriched.pairs[1]?.answer.metadata?.artifacts).toHaveLength(1);
      expect(enriched.pairs[1]?.answer.metadata?.artifacts?.[0]?.content).toBe('second content');
      expect(warning).toBeUndefined();
    });

    it('does not misattribute artifacts when the DOM pair count and API assistant-message count diverge (edited/regenerated turn)', () => {
      // DOM scraped 2 pairs, but the API reports 3 assistant messages
      // (e.g. a regenerated turn). There is no stable id shared between
      // the DOM scrape and the API response, so this must not guess.
      const conversation = makeConversation([makePair(0, 'Q1', 'A1'), makePair(1, 'Q2', 'A2')]);

      const apiData: ClaudeApiConversationResponse = {
        uuid: 'conv-1',
        name: 'Test',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        chat_messages: [
          makeApiMessage('u1', 0, 'human'),
          makeApiMessage('a1', 1, 'assistant', [artifactContent('Doc A', 'content A')]),
          makeApiMessage('u2', 2, 'human'),
          makeApiMessage('a2', 3, 'assistant'),
          makeApiMessage('a2-regenerated', 4, 'assistant', [artifactContent('Doc B', 'content B')]),
        ],
      };

      const result = ClaudeApiService.enrichConversation(conversation, apiData);

      // Enrichment must be skipped entirely rather than mis-pairing —
      // a wrong-but-confident attribution is worse than a visible failure.
      expect(result.conversation.pairs[0]?.answer.metadata?.artifacts ?? []).toHaveLength(0);
      expect(result.conversation.pairs[1]?.answer.metadata?.artifacts ?? []).toHaveLength(0);

      // ...and the skip must be reported back to the caller so the user can be
      // told, rather than only reaching a console.warn nobody reads (lo-872a).
      expect(result.warning).toEqual(expect.stringContaining('Artifact'));
    });

    it('correctly attributes two artifacts that share the same title in one message', () => {
      const conversation = makeConversation([makePair(0, 'Q1', 'A1')]);

      const apiData: ClaudeApiConversationResponse = {
        uuid: 'conv-1',
        name: 'Test',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        chat_messages: [
          makeApiMessage('u1', 0, 'human'),
          makeApiMessage('a1', 1, 'assistant', [
            artifactContent('Untitled', 'first version', 'artifact-id-1'),
            artifactContent('Untitled', 'second version', 'artifact-id-2'),
          ]),
        ],
      };

      const { conversation: enriched } = ClaudeApiService.enrichConversation(conversation, apiData);
      const artifacts = enriched.pairs[0]?.answer.metadata?.artifacts ?? [];

      expect(artifacts).toHaveLength(2);
      expect(artifacts.map((a) => a.content)).toEqual(['first version', 'second version']);
    });

    it('adds no artifacts (but still stamps timestamps) when the API response has none', () => {
      const conversation = makeConversation([makePair(0, 'Q1', 'A1')]);

      const apiData: ClaudeApiConversationResponse = {
        uuid: 'conv-1',
        name: 'Test',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        chat_messages: [makeApiMessage('u1', 0, 'human'), makeApiMessage('a1', 1, 'assistant')],
      };

      const result = ClaudeApiService.enrichConversation(conversation, apiData);
      expect(result.conversation.pairs[0]?.answer.metadata?.artifacts).toBeUndefined();
      expect(result.conversation.pairs[0]?.question.timestamp).toEqual(
        new Date('2026-01-01T00:00:00Z')
      );
      expect(result.conversation.pairs[0]?.answer.timestamp).toEqual(
        new Date('2026-01-01T00:00:00Z')
      );
      expect(result.warning).toBeUndefined();
    });
  });

  describe('enrichConversation — timestamps', () => {
    it('stamps both messages of a pair even when the conversation has no artifacts', () => {
      const conversation = makeConversation([makePair(0, 'Q', 'A')]);
      const apiData = {
        uuid: 'conv-1',
        name: 'Test conversation',
        created_at: '2026-07-26T09:31:12Z',
        updated_at: '2026-07-29T15:02:47Z',
        chat_messages: [
          makeApiMessage('u1', 0, 'human', [], '2026-07-26T09:31:12Z'),
          makeApiMessage('a1', 1, 'assistant', [], '2026-07-26T09:32:40Z'),
        ],
      } as ClaudeApiConversationResponse;

      const { conversation: enriched, warning } = ClaudeApiService.enrichConversation(
        conversation,
        apiData
      );

      expect(warning).toBeUndefined();
      expect(enriched.pairs[0]?.question.timestamp).toEqual(new Date('2026-07-26T09:31:12Z'));
      expect(enriched.pairs[0]?.answer.timestamp).toEqual(new Date('2026-07-26T09:32:40Z'));
    });

    it('leaves the conversation untouched when the human count disagrees with the pairs', () => {
      const conversation = makeConversation([makePair(0, 'Q', 'A'), makePair(1, 'Q2', 'A2')]);
      const apiData = {
        uuid: 'conv-1',
        name: 'Test conversation',
        created_at: '2026-07-26T09:31:12Z',
        updated_at: '2026-07-26T09:31:12Z',
        chat_messages: [
          makeApiMessage('u1', 0, 'human'),
          makeApiMessage('a1', 1, 'assistant'),
          makeApiMessage('a2', 2, 'assistant'),
        ],
      } as ClaudeApiConversationResponse;

      const { conversation: enriched, warning } = ClaudeApiService.enrichConversation(
        conversation,
        apiData
      );

      expect(warning).toBeDefined();
      expect(enriched.pairs[0]?.question.timestamp).toBeUndefined();
      // Only the human count actually diverges here (1 human vs. 2 assistant vs.
      // 2 pairs) — the message must report that, not claim both sides are equal.
      expect(warning).toContain('1 human message');
      expect(warning).toContain('2 assistant messages');
    });

    it('ignores an unparseable created_at instead of stamping an Invalid Date', () => {
      const conversation = makeConversation([makePair(0, 'Q', 'A')]);
      const apiData = {
        uuid: 'conv-1',
        name: 'Test conversation',
        created_at: '2026-07-26T09:31:12Z',
        updated_at: '2026-07-26T09:31:12Z',
        chat_messages: [
          makeApiMessage('u1', 0, 'human', [], 'not-a-date'),
          makeApiMessage('a1', 1, 'assistant', [], '2026-07-26T09:32:40Z'),
        ],
      } as ClaudeApiConversationResponse;

      const { conversation: enriched } = ClaudeApiService.enrichConversation(conversation, apiData);

      expect(enriched.pairs[0]?.question.timestamp).toBeUndefined();
      expect(enriched.pairs[0]?.answer.timestamp).toEqual(new Date('2026-07-26T09:32:40Z'));
    });
  });
});
