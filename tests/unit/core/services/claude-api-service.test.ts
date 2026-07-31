/**
 * Claude API Service Tests
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
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

/**
 * Content-block builders shaped like the LIVE API, verified 2026-07-31 against
 * a real 12-exchange conversation: `message.text` was `""` on all 24 messages
 * and the real content lived in `content[]` blocks — text, thinking, tool_use
 * and tool_result. The fixtures below must keep that shape, because a fixture
 * that populates `text` is exactly what let PAR-2's first attempt pass CI while
 * producing entirely blank exports against the real product.
 */
function textBlock(text: string): ClaudeApiChatMessage['content'][number] {
  return { type: 'text', text };
}

function thinkingBlock(thinking: string): ClaudeApiChatMessage['content'][number] {
  return { type: 'thinking', thinking };
}

function toolUseBlock(name: string): ClaudeApiChatMessage['content'][number] {
  return { type: 'tool_use', name, input: {} };
}

function toolResultBlock(content: unknown): ClaudeApiChatMessage['content'][number] {
  return { type: 'tool_result', content };
}

function makeApiMessage(
  uuid: string,
  index: number,
  sender: 'human' | 'assistant',
  content: ClaudeApiChatMessage['content'] = [],
  createdAt = '2026-01-01T00:00:00Z',
  text = ''
): ClaudeApiChatMessage {
  return {
    uuid,
    text,
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

  describe('extractIdsFromPage() — organization resolution (D-25)', () => {
    const url = 'https://claude.ai/chat/00000000-0000-4000-8000-000000000000';

    function makeBlankDocument(): Document {
      return document.implementation.createHTMLDocument('test');
    }

    /** `chrome.runtime.sendMessage`'s overloaded declaration makes `vi.mocked()`
     * infer a `void` return type from the callback-style overload; cast to the
     * plain `vi.fn()` mock it actually is (see `tests/setup/vitest.setup.ts`). */
    function mockSendMessage(): ReturnType<typeof vi.fn> {
      return chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;
    }

    /** A detached `createHTMLDocument()` document has no working cookie jar
     * in jsdom, so `document.cookie` is faked the same way `spyOnInnerHtmlAccess`
     * fakes `innerHTML` above. */
    function makeDocumentWithCookie(cookie: string): Document {
      const doc = makeBlankDocument();
      Object.defineProperty(doc, 'cookie', { configurable: true, value: cookie });
      return doc;
    }

    it('uses the lastActiveOrg cookie before ever calling the API', async () => {
      const doc = makeDocumentWithCookie(
        'sessionKeyLC=abc; lastActiveOrg=11111111-1111-4111-8111-111111111111'
      );

      const ids = await ClaudeApiService.extractIdsFromPage(url, doc);

      expect(ids).toEqual({
        organizationId: '11111111-1111-4111-8111-111111111111',
        conversationId: '00000000-0000-4000-8000-000000000000',
      });
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('extracts the uuid out of an encoded/prefixed cookie value rather than requiring an exact match', async () => {
      // Confirmed live the cookie is a bare uuid with no prefix/encoding, but
      // the extraction is defensive against a future format change: it
      // searches the decoded value for a uuid substring instead of assuming
      // the whole value is one.
      const doc = makeDocumentWithCookie(
        'lastActiveOrg=org%3A22222222-2222-4222-8222-222222222222'
      );

      const ids = await ClaudeApiService.extractIdsFromPage(url, doc);

      expect(ids?.organizationId).toBe('22222222-2222-4222-8222-222222222222');
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('falls through to the API when the cookie value contains no uuid', async () => {
      const doc = makeDocumentWithCookie('lastActiveOrg=not-a-uuid');
      mockSendMessage().mockResolvedValueOnce({
        success: true,
        data: [{ uuid: 'api-org-1' }],
      });

      const ids = await ClaudeApiService.extractIdsFromPage(url, doc);

      expect(ids?.organizationId).toBe('api-org-1');
    });

    it('uses the API-discovered organization id when the endpoint returns exactly one organization', async () => {
      const doc = makeBlankDocument();
      mockSendMessage().mockResolvedValueOnce({
        success: true,
        data: [{ uuid: 'api-org-1' }],
      });

      const ids = await ClaudeApiService.extractIdsFromPage(url, doc);

      expect(ids).toEqual({
        organizationId: 'api-org-1',
        conversationId: '00000000-0000-4000-8000-000000000000',
      });
    });

    it('never uses the numeric "id" field in place of "uuid" (id is a number, not the API uuid)', async () => {
      const doc = makeBlankDocument();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      // Only entry has a numeric `id`, no `uuid` — must not be mistaken for one.
      mockSendMessage().mockResolvedValueOnce({
        success: true,
        data: [{ id: 42 }],
      });

      const ids = await ClaudeApiService.extractIdsFromPage(url, doc);

      expect(ids).toBeNull();
      warnSpy.mockRestore();
    });

    it('prefers the organization the DOM scrape independently confirms when several are returned', async () => {
      const doc = makeDataAttributeDocument('api-org-2');
      mockSendMessage().mockResolvedValueOnce({
        success: true,
        data: [{ uuid: 'api-org-1' }, { uuid: 'api-org-2' }],
      });

      const ids = await ClaudeApiService.extractIdsFromPage(url, doc);

      expect(ids?.organizationId).toBe('api-org-2');
    });

    it('prefers the top-level organization (no parent_organization_uuid) when the DOM gives no signal', async () => {
      const doc = makeBlankDocument();
      mockSendMessage().mockResolvedValueOnce({
        success: true,
        data: [{ uuid: 'sub-org', parent_organization_uuid: 'root-org' }, { uuid: 'root-org' }],
      });

      const ids = await ClaudeApiService.extractIdsFromPage(url, doc);

      expect(ids?.organizationId).toBe('root-org');
    });

    it('falls back to the first organization when several are returned and none can be disambiguated', async () => {
      const doc = makeBlankDocument();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      mockSendMessage().mockResolvedValueOnce({
        success: true,
        data: [{ uuid: 'api-org-1' }, { uuid: 'api-org-2' }],
      });

      const ids = await ClaudeApiService.extractIdsFromPage(url, doc);

      expect(ids?.organizationId).toBe('api-org-1');
      warnSpy.mockRestore();
    });

    it('falls back to the DOM scrape when the API call fails', async () => {
      const doc = makeNextDataDocument('dom-org-1');
      mockSendMessage().mockRejectedValueOnce(new Error('network error'));

      const ids = await ClaudeApiService.extractIdsFromPage(url, doc);

      expect(ids?.organizationId).toBe('dom-org-1');
    });

    it('falls back to the DOM scrape when the API returns no organizations', async () => {
      const doc = makeNextDataDocument('dom-org-2');
      mockSendMessage().mockResolvedValueOnce({ success: true, data: [] });

      const ids = await ClaudeApiService.extractIdsFromPage(url, doc);

      expect(ids?.organizationId).toBe('dom-org-2');
    });

    it('returns null and warns when the cookie, the API, and every DOM strategy all fail', async () => {
      const doc = makeBlankDocument();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      mockSendMessage().mockResolvedValueOnce({ success: false });

      const ids = await ClaudeApiService.extractIdsFromPage(url, doc);

      expect(ids).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Organization ID not found'));
      warnSpy.mockRestore();
    });

    it('does not re-hit the organizations endpoint for a second export in the same document/session', async () => {
      const doc = makeBlankDocument();
      const sendMessageMock = mockSendMessage().mockResolvedValue({
        success: true,
        data: [{ uuid: 'api-org-1' }],
      });

      await ClaudeApiService.extractIdsFromPage(url, doc);
      await ClaudeApiService.extractIdsFromPage(url, doc);

      expect(sendMessageMock).toHaveBeenCalledTimes(1);
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
      // PAR-2: the warning must describe the real, measured consequence
      // (artifacts/times missing for pairs that couldn't be matched) and
      // must not claim a specific cause or a fix that isn't guaranteed —
      // "edited/regenerated/deleted" and "reload and export again" were
      // both unverifiable claims the fix removes.
      expect(result.warning).not.toContain('edited, regenerated or deleted');
      expect(result.warning).not.toContain('Reload the conversation');
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

  describe('enrichConversation() — artifact type label locale (I18N-1)', () => {
    const originalChrome = globalThis.chrome;
    afterEach(() => {
      globalThis.chrome = originalChrome;
    });

    it('resolves the artifact typeLabel through the locale bundle instead of a hardcoded English word', () => {
      const de = JSON.parse(
        readFileSync(resolve(__dirname, '../../../../_locales/de/messages.json'), 'utf-8')
      ) as Record<string, { message: string }>;
      globalThis.chrome = {
        ...originalChrome,
        i18n: {
          getUILanguage: () => 'de',
          getMessage: (key: string) => de[key]?.message ?? '',
        },
      } as unknown as typeof chrome;

      const conversation = makeConversation([makePair(0, 'Q1', 'A1')]);
      const apiData: ClaudeApiConversationResponse = {
        uuid: 'conv-1',
        name: 'Test',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        chat_messages: [
          makeApiMessage('u1', 0, 'human'),
          makeApiMessage('a1', 1, 'assistant', [artifactContent('Doc', 'content')]),
        ],
      };

      const { conversation: enriched } = ClaudeApiService.enrichConversation(conversation, apiData);

      expect(enriched.pairs[0]?.answer.metadata?.artifacts?.[0]?.typeLabel).toBe(
        de.artifactTypeDocument!.message
      );
      expect(enriched.pairs[0]?.answer.metadata?.artifacts?.[0]?.typeLabel).not.toBe('Document');
    });
  });

  describe('enrichConversation — virtual-scroll windowing (PAR-2)', () => {
    it('rebuilds the conversation from the API when the DOM only captured a virtual-scroll window', () => {
      // claude.ai's virtual list only ever mounts ~4 turns; a long
      // conversation's DOM scrape can be as short as 1 pair while the API
      // reports the true, full count. The API is authoritative here.
      const conversation = makeConversation([makePair(0, 'Q1', 'A1')]);

      // Real shape: `text` is EMPTY on every message; content is in blocks.
      const chatMessages: ClaudeApiChatMessage[] = [];
      for (let i = 0; i < 11; i++) {
        chatMessages.push(
          makeApiMessage(
            `u${String(i)}`,
            i * 2,
            'human',
            [textBlock(`Question ${String(i)}`)],
            '2026-01-01T00:00:00Z',
            '' // live API leaves this empty
          )
        );
        chatMessages.push(
          makeApiMessage(
            `a${String(i)}`,
            i * 2 + 1,
            'assistant',
            [
              thinkingBlock(`SECRET REASONING ${String(i)} must not be exported`),
              toolUseBlock('web_search'),
              toolResultBlock({ raw: `tool output ${String(i)} must not be exported` }),
              textBlock(`Answer ${String(i)}`),
              ...(i === 5 ? [artifactContent('Doc', 'artifact content')] : []),
            ],
            '2026-01-01T00:01:00Z',
            '' // live API leaves this empty
          )
        );
      }

      const apiData: ClaudeApiConversationResponse = {
        uuid: 'conv-1',
        name: 'Test',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        chat_messages: chatMessages,
      };

      const { conversation: enriched, warning } = ClaudeApiService.enrichConversation(
        conversation,
        apiData
      );

      expect(warning).toBeUndefined();
      expect(enriched.pairs).toHaveLength(11);
      enriched.pairs.forEach((pair, i) => {
        expect(pair.question.content).toBe(`Question ${String(i)}`);
        expect(pair.answer.content).toBe(`Answer ${String(i)}`);
        // thinking and tool blocks are NOT turn narration and must never leak
        // into an export.
        expect(pair.answer.content).not.toContain('SECRET REASONING');
        expect(pair.answer.content).not.toContain('tool output');
      });
      // Artifact recovered for the pair whose assistant message carried one.
      expect(enriched.pairs[5]?.answer.metadata?.artifacts?.[0]?.content).toBe('artifact content');
      expect(enriched.pairs[0]?.answer.metadata?.artifacts).toBeUndefined();
    });

    it('gives a turn with only non-text blocks empty content rather than fabricating any', () => {
      // The live capture had exactly this: an assistant turn whose four blocks
      // were all thinking/tool_use/tool_result, with no text at all.
      const conversation = makeConversation([makePair(0, 'Q1', 'A1')]);
      const chatMessages: ClaudeApiChatMessage[] = [];
      for (let i = 0; i < 2; i++) {
        chatMessages.push(makeApiMessage(`u${String(i)}`, i * 2, 'human', [textBlock('Q')]));
        chatMessages.push(
          makeApiMessage(
            `a${String(i)}`,
            i * 2 + 1,
            'assistant',
            i === 1
              ? [thinkingBlock('only reasoning'), toolUseBlock('repl'), toolResultBlock('out')]
              : [textBlock('A')]
          )
        );
      }

      const { conversation: enriched } = ClaudeApiService.enrichConversation(conversation, {
        uuid: 'conv-1',
        name: 'Test',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        chat_messages: chatMessages,
      });

      expect(enriched.pairs).toHaveLength(2);
      expect(enriched.pairs[1]?.answer.content).toBe('');
      expect(enriched.pairs[1]?.answer.content).not.toContain('only reasoning');
    });

    it('still uses message.text when a payload does populate it', () => {
      // `text` remains the documented field; it is a fallback, not dead code.
      const conversation = makeConversation([makePair(0, 'Q1', 'A1')]);
      const chatMessages: ClaudeApiChatMessage[] = [];
      for (let i = 0; i < 2; i++) {
        chatMessages.push(
          makeApiMessage(`u${String(i)}`, i * 2, 'human', [], '2026-01-01T00:00:00Z', 'from text')
        );
        chatMessages.push(
          makeApiMessage(
            `a${String(i)}`,
            i * 2 + 1,
            'assistant',
            [],
            '2026-01-01T00:00:00Z',
            'answer from text'
          )
        );
      }

      const { conversation: enriched } = ClaudeApiService.enrichConversation(conversation, {
        uuid: 'conv-1',
        name: 'Test',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        chat_messages: chatMessages,
      });

      expect(enriched.pairs).toHaveLength(2);
      expect(enriched.pairs[0]?.question.content).toBe('from text');
      expect(enriched.pairs[0]?.answer.content).toBe('answer from text');
    });

    it('does not fabricate a timestamp for an API message with no created_at', () => {
      const conversation = makeConversation([makePair(0, 'Q1', 'A1')]);
      const apiData: ClaudeApiConversationResponse = {
        uuid: 'conv-1',
        name: 'Test',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        chat_messages: [
          makeApiMessage('u1', 0, 'human', [], '', 'Q1'),
          makeApiMessage('a1', 1, 'assistant', [], '2026-01-01T00:02:00Z', 'A1'),
          makeApiMessage('u2', 2, 'human', [], '2026-01-01T00:03:00Z', 'Q2'),
          makeApiMessage('a2', 3, 'assistant', [], '2026-01-01T00:04:00Z', 'A2'),
        ],
      };

      const { conversation: enriched } = ClaudeApiService.enrichConversation(conversation, apiData);

      expect(enriched.pairs).toHaveLength(2);
      expect(enriched.pairs[0]?.question.timestamp).toBeUndefined();
      expect(enriched.pairs[0]?.answer.timestamp).toEqual(new Date('2026-01-01T00:02:00Z'));
    });

    it('leaves the DOM-parsed pairs untouched when the API count does not exceed the DOM count', () => {
      // Regression guard: rebuilding must only fire when the API genuinely
      // has more turns than the DOM captured, never when they already agree.
      const conversation = makeConversation([makePair(0, 'DOM question', 'DOM answer')]);
      const apiData: ClaudeApiConversationResponse = {
        uuid: 'conv-1',
        name: 'Test',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        chat_messages: [
          makeApiMessage('u1', 0, 'human', [], '2026-01-01T00:00:00Z', 'API question'),
          makeApiMessage('a1', 1, 'assistant', [], '2026-01-01T00:01:00Z', 'API answer'),
        ],
      };

      const { conversation: enriched } = ClaudeApiService.enrichConversation(conversation, apiData);

      expect(enriched.pairs).toHaveLength(1);
      // Content still comes from the DOM scrape — only timestamps/artifacts
      // are merged in when counts already agree.
      expect(enriched.pairs[0]?.question.content).toBe('DOM question');
      expect(enriched.pairs[0]?.answer.content).toBe('DOM answer');
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
      expect(warning).not.toContain('edited, regenerated or deleted');
      expect(warning).not.toContain('Reload the conversation');
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
