/**
 * D-18: two guarantees an export must hold.
 *
 * 1. The "Exported: …" line (the one genuinely real timestamp,
 *    `conversation.createdAt`) renders in the reader's local time, not UTC.
 *    Before this fix `formatTimestamp`/`formatTime` always called
 *    `toISOString()`, so a reader in UTC+2 read a time two hours off.
 * 2. A conversation whose messages carry no real timestamp (every parser
 *    today, since no platform exposes one in the DOM) gets no date range and
 *    no day separators — not a range/separator computed off the fabricated
 *    capture time.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type {
  ChatGPTApiConversationResponse,
  ChatGPTApiMessage,
  Conversation,
  ExportOptions,
  QAPair,
} from '../../../../src/core/types';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { ChatGPTApiService } from '../../../../src/core/services/chatgpt-api-service';
import { blobToText } from '../../../utils/exporter-helpers';

const ORIGINAL_TZ = process.env.TZ;
const originalChrome = globalThis.chrome;

// #219 (I18N-1) routed role/metadata labels through chrome.i18n.getMessage();
// without a real chrome.i18n mock, getMessage() falls back to returning the
// bare locale key (see src/shared/i18n.ts), and a platform-specific role name
// like "ChatGPT" additionally falls back all the way to the generic
// "Assistant" (no per-platform key resolves). Installing the real 'en' bundle
// here — same pattern as tests/unit/core/exporters/section-labels-i18n.test.ts
// and media-label-i18n.test.ts — means the assertions below check the actual
// localized output, not a guess about the no-i18n fallback shape.
function installEnglishLocale(): void {
  const bundle = JSON.parse(
    readFileSync(resolve(__dirname, '../../../../_locales/en/messages.json'), 'utf-8')
  ) as Record<string, { message: string }>;
  globalThis.chrome = {
    ...originalChrome,
    i18n: {
      getUILanguage: () => 'en',
      getMessage: (key: string) => bundle[key]?.message ?? '',
    },
  } as unknown as typeof chrome;
}

beforeEach(() => {
  installEnglishLocale();
});

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
  globalThis.chrome = originalChrome;
});

function pairWithoutTimestamps(index: number): QAPair {
  return {
    id: `p${index}`,
    index,
    selected: true,
    question: { id: `q${index}`, role: 'user', content: `Question ${index}` },
    answer: { id: `a${index}`, role: 'assistant', content: `Answer ${index}` },
  } as unknown as QAPair;
}

function conversationOf(pairs: QAPair[]): Conversation {
  return {
    id: 'c1',
    title: 'Lighthouse notes',
    platform: 'chatgpt',
    url: 'https://chatgpt.com/c/1',
    createdAt: new Date('2025-06-01T12:00:00Z'),
    pairs,
  } as unknown as Conversation;
}

const options: ExportOptions = {
  format: 'txt',
  filename: 'test',
  showMetaInfo: true,
};

async function renderTxt(conversation: Conversation): Promise<string> {
  const result = await new TextExporter().export(conversation, conversation.pairs, {
    ...options,
    format: 'txt',
  });
  expect(result.success).toBe(true);
  return blobToText(result.blob!);
}

describe('the export moment renders in local time, not UTC', () => {
  it('shifts the displayed hour with the local timezone', async () => {
    const conversation = conversationOf([pairWithoutTimestamps(0)]);

    process.env.TZ = 'America/New_York'; // UTC-4 in June (DST)
    const nyText = await renderTxt(conversation);

    process.env.TZ = 'Asia/Kolkata'; // UTC+5:30
    const kolkataText = await renderTxt(conversation);

    expect(nyText).toContain('Exported: 2025-06-01 08:00:00');
    expect(kolkataText).toContain('Exported: 2025-06-01 17:30:00');
  });
});

describe('no fabricated per-message time is ever shown', () => {
  // `conversationOf` builds a `platform: 'chatgpt'` conversation, so this is
  // already the ChatGPT case: no DOM timestamp exists, and (lo-08d3) every
  // failure path of ChatGPTApiService's backend-endpoint enrichment --
  // endpoint unreachable, id unreadable, response fetched but empty --
  // resolves to exactly this shape (pairs with `timestamp` left unset), never
  // a guessed date.
  it('a conversation with no real per-message timestamps gets no date range and no day separator', async () => {
    process.env.TZ = 'UTC';
    const conversation = conversationOf([pairWithoutTimestamps(0), pairWithoutTimestamps(1)]);

    const text = await renderTxt(conversation);

    expect(text).not.toContain('Date range');
    expect(text).not.toContain('—');
    // The only timestamp anywhere is the real export moment.
    expect(text).toContain('Exported: 2025-06-01');
  });
});

describe('the ChatGPT backend endpoint (lo-08d3), end to end through the exporter', () => {
  function apiMessage(
    id: string,
    role: 'user' | 'assistant',
    createTime: number | null
  ): ChatGPTApiMessage {
    return { id, author: { role }, create_time: createTime, content: { content_type: 'text' } };
  }

  /** A straight-line mapping root -> user -> assistant, `current_node` at the leaf. */
  function mappingOf(
    userCreateTime: number | null,
    assistantCreateTime: number | null
  ): ChatGPTApiConversationResponse {
    return {
      mapping: {
        n0: {
          id: 'n0',
          message: apiMessage('u0', 'user', userCreateTime),
          parent: null,
          children: ['n1'],
        },
        n1: {
          id: 'n1',
          message: apiMessage('a0', 'assistant', assistantCreateTime),
          parent: 'n0',
          children: [],
        },
      },
      current_node: 'n1',
    };
  }

  it('when the endpoint returns real create_time values, the export shows a real date range instead of none', async () => {
    process.env.TZ = 'UTC';
    const conversation = conversationOf([pairWithoutTimestamps(0)]);
    const apiData = mappingOf(1717243200, 1717243260); // 2024-06-01T12:00:00Z / 12:01:00Z

    const { conversation: enriched, warning } = ChatGPTApiService.enrichConversation(
      conversation,
      apiData
    );
    expect(warning).toBeUndefined();

    const text = await renderTxt(enriched);

    // The 'en' locale is installed above, so `roleChatGPT` ("ChatGPT",
    // upper-cased to "CHATGPT" by roleLabel()) resolves for real here rather
    // than falling back to the generic "Assistant" (see installEnglishLocale).
    expect(text).toContain('Jun 1, 2024');
    expect(text).toContain('USER · 12:00');
    expect(text).toContain('CHATGPT · 12:01');
  });

  it('when the endpoint has no create_time for a turn, that turn still gets no fabricated time', async () => {
    process.env.TZ = 'UTC';
    const conversation = conversationOf([pairWithoutTimestamps(0)]);
    const apiData = mappingOf(null, 1717243260);

    const { conversation: enriched } = ChatGPTApiService.enrichConversation(conversation, apiData);

    expect(enriched.pairs[0]?.question.timestamp).toBeUndefined();
    expect(enriched.pairs[0]?.answer.timestamp).toEqual(new Date(1717243260 * 1000));
  });
});
