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
    // R-4: hours and minutes after a middot, not a parenthesised HH:MM:SS.
    expect(text).toContain('· 12:00');
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

describe('R-4: Markdown composition', () => {
  const answerWithRichBody = (): QAPair =>
    ({
      id: 'pair-0',
      index: 0,
      selected: true,
      question: {
        id: 'q-0',
        role: 'user',
        content: 'first line\n\nsecond line',
        htmlContent: '<p>first line</p><p>second line</p>',
        timestamp: new Date('2025-01-01T12:04:37Z'),
      },
      answer: {
        id: 'a-0',
        role: 'assistant',
        content: 'Alpha body',
        htmlContent:
          '<h1>Alpha</h1><p>body</p><img src="https://example.com/equity.png" alt="equity curve">',
        timestamp: new Date('2025-01-01T12:05:02Z'),
      },
    }) as unknown as QAPair;

  async function render(pair: QAPair, includeTimestamps = true): Promise<string> {
    const conversation = buildConversation(pair);
    const result = await new StructuredMarkdownExporter().export(conversation, [pair], {
      format: 'md',
      filename: 'test',
      includeMetadata: true,
      includeTimestamps,
    });
    return blobToText(result.blob!);
  }

  it('renders the role label as bold text with a middot and no seconds', async () => {
    const text = await render(answerWithRichBody());

    expect(text).toContain('**User** · 12:04');
    // The assistant's name comes from i18n, which this harness does not provide,
    // so assert the shape rather than the resolved word.
    expect(text).toMatch(/^\*\*\w+\*\* · 12:05$/m);
    // No seconds on a per-message time, and no heading or emoji form.
    expect(text).not.toContain('12:04:37');
    expect(text).not.toMatch(/^#+ .*(User|ChatGPT)/m);
    expect(text).not.toMatch(/[👤🤖]/u);
  });

  it('drops the middot entirely when there is no time to show', async () => {
    const text = await render(answerWithRichBody(), false);

    expect(text).toContain('**User**');
    expect(text).not.toContain('·');
  });

  it('renders the question as a blockquote', async () => {
    const text = await render(answerWithRichBody());

    expect(text).toContain('> first line');
    expect(text).toContain('> second line');
    // The answer is not quoted — the quote is what distinguishes the voices.
    expect(text).not.toContain('> body');
  });

  it('renders a content image with native Markdown, not a sized img tag', async () => {
    const text = await render(answerWithRichBody());

    expect(text).toContain('![equity curve](https://example.com/equity.png)');
    // The 200px "webchat thumbnail" scaling is gone for good.
    expect(text).not.toContain('max-width: 200px');
    expect(text).not.toMatch(/<img[^>]*equity\.png/);
  });

  it('keeps the metadata block as a table', async () => {
    const text = await render(answerWithRichBody());

    expect(text).toMatch(/^\|---\|---\|$/m);
    expect(text).toContain('https://chatgpt.com/c/test');
  });
});

describe('R-4: the question quote is a closed block', () => {
  it('separates the quote from the next role label with an unquoted blank line', async () => {
    const pair = {
      id: 'p',
      index: 0,
      selected: true,
      question: { id: 'q', role: 'user', content: 'asked', timestamp: undefined },
      answer: { id: 'a', role: 'assistant', content: 'answered', timestamp: undefined },
    } as unknown as QAPair;
    const result = await new StructuredMarkdownExporter().export(
      buildConversation(pair),
      [pair],
      { format: 'md', filename: 't', includeMetadata: false, includeTimestamps: false }
    );
    const text = await blobToText(result.blob!);

    // A quote ending on '>' would let Markdown's lazy continuation swallow the
    // assistant's label into the user's question.
    expect(text).not.toMatch(/^>\n\*\*/m);
    expect(text).toMatch(/^> asked\n\n\*\*/m);
  });
});
