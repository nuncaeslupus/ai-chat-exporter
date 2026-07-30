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

import { describe, it, expect, afterEach } from 'vitest';
import type { Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { blobToText } from '../../../utils/exporter-helpers';

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
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
