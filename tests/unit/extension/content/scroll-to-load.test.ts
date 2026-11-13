/**
 * Scroll-to-load tests (t-339c7d74).
 *
 * chatgpt.com and claude.ai virtualize conversation turns: nodes are mounted
 * and unmounted as the viewport moves, so a single parse only ever sees the
 * rendered window and the export silently drops the rest. Measured live on
 * 2026-11-13: 4 of 6 ChatGPT message units in the DOM at rest, 2 of 6 scrolled
 * to the top.
 *
 * The fixture below is that behaviour in miniature -- a scroller that mounts
 * only the turns intersecting its viewport and unmounts everything else -- so
 * the first test fails on an un-scrolled parse by construction.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { ClaudeParser } from '../../../../src/core/parsers/claude';
import { ChatGPTParser } from '../../../../src/core/parsers/chatgpt';
import type { IParser } from '../../../../src/core/types';
import {
  parseAllTurns,
  MAX_SCROLL_STEPS,
  SETTLE_MS,
} from '../../../../src/extension/content/scroll-to-load';

/** Scroller viewport height, in fixture pixels. */
const VIEWPORT = 1000;
/** Height of one turn, so a viewport holds three of them (and two pairs). */
const TURN_HEIGHT = 400;

// One scroller carrying both platforms' `custom.scrollContainer` classes, and a
// `<main>` so ChatGPT's `conversationContainer` resolves. `findScroller` reads
// the selector off the parser it is given, so neither platform sees the other's.
const PAGE = `<!DOCTYPE html><html><body>
  <div class="overflow-y-auto overflow-x-hidden pt-6 flex-1 thread-scroll-container" id="scroller">
    <main><div id="inner"></div></main>
  </div>
</body></html>`;

function turnHtml(index: number): string {
  const pair = Math.floor(index / 2);
  return index % 2 === 0
    ? `<div data-test-render-count="1"><div class="mb-1 mt-6 group"><div data-testid="user-message">
         <p class="whitespace-pre-wrap break-words">question ${pair}</p></div></div></div>`
    : `<div data-test-render-count="1"><div data-is-streaming="false"><div class="font-claude-response">
         <div class="standard-markdown"><p>answer ${pair}</p></div></div></div></div>`;
}

/**
 * One ChatGPT message unit, mountable on its own.
 *
 * ChatGPT unmounts message UNITS, not whole `[data-turn-key]` exchanges (4 of 6
 * units in the DOM at rest, measured live), so a window's top edge lands
 * between a question and its answer rather than between exchanges. Two units
 * of the same exchange carry the same turn key, as the live page does.
 */
function chatgptUnitHtml(index: number): string {
  const pair = Math.floor(index / 2);
  return index % 2 === 0
    ? `<div data-turn-key="t-${pair}"><div data-content-search-unit-key="t-${pair}:0:user">
         <div data-user-message-bubble=""><div class="whitespace-pre-wrap">question ${pair}</div>
       </div></div></div>`
    : `<div data-turn-key="t-${pair}"><div data-content-search-unit-key="t-${pair}:2:assistant">
         <div data-chatgpt-selection-message-id="a${pair}"><div data-markdown-text-style="">
         <p>answer ${pair}</p></div></div></div></div>`;
}

/**
 * A scroller that mounts only the turns intersecting its viewport.
 *
 * `mount` decides what the `scrollTop` getter's current value renders, so a
 * test can swap virtualization for "always the same turn" (termination) or
 * "a brand new turn every step" (the cap).
 */
function buildScroller(
  options: { contentHeight: number; mount: (scrollTop: number) => string },
  url = 'https://claude.ai/chat/abc123'
): { doc: Document; scroller: HTMLElement } {
  const dom = new JSDOM(PAGE, { url });
  const doc = dom.window.document;
  const scroller = doc.getElementById('scroller')!;
  const inner = doc.getElementById('inner')!;
  const maxScrollTop = Math.max(0, options.contentHeight - VIEWPORT);
  let scrollTop = 0;
  const render = (): void => {
    inner.innerHTML = options.mount(scrollTop);
  };
  Object.defineProperty(scroller, 'clientHeight', { value: VIEWPORT, configurable: true });
  Object.defineProperty(scroller, 'scrollHeight', {
    value: options.contentHeight,
    configurable: true,
  });
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = Math.min(Math.max(next, 0), maxScrollTop);
      render();
    },
  });
  render();
  return { doc, scroller };
}

/** The virtualized conversation: `total` turns, only the visible ones mounted. */
function buildVirtualized(
  total: number,
  html: (index: number) => string = turnHtml,
  url?: string
): { doc: Document; scroller: HTMLElement } {
  return buildScroller(
    {
      contentHeight: total * TURN_HEIGHT,
      mount: (scrollTop) => {
        const first = Math.floor(scrollTop / TURN_HEIGHT);
        const last = Math.floor((scrollTop + VIEWPORT - 1) / TURN_HEIGHT);
        return Array.from({ length: total }, (_, index) => index)
          .filter((index) => index >= first && index <= last)
          .map(html)
          .join('');
      },
    },
    url
  );
}

/** Drive the pass to completion under fake timers. */
async function run(parser: IParser, doc: Document) {
  const pending = parseAllTurns(parser, doc);
  await vi.advanceTimersByTimeAsync(SETTLE_MS * (MAX_SCROLL_STEPS + 5));
  return pending;
}

describe('scroll-to-load', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('collects turns that were never simultaneously mounted', async () => {
    vi.useFakeTimers();
    const { doc, scroller } = buildVirtualized(6);
    const parser = new ClaudeParser(doc);

    // The bug, pinned: at rest only part of the conversation is in the DOM,
    // and no scroll position holds all six turns at once.
    expect(doc.querySelectorAll('div[data-test-render-count]').length).toBeLessThan(6);
    expect(parser.parse().conversation?.pairs.length).toBeLessThan(3);
    expect(scroller.scrollTop).toBe(0);

    const result = await run(parser, doc);

    expect(result.conversation?.pairs.map((pair) => pair.question.content)).toEqual([
      'question 0',
      'question 1',
      'question 2',
    ]);
    expect(result.conversation?.pairs.map((pair) => pair.answer.content)).toEqual([
      'answer 0',
      'answer 1',
      'answer 2',
    ]);
    expect(result.conversation?.pairs.map((pair) => pair.index)).toEqual([0, 1, 2]);
  });

  it('restores the scroll position the user was at', async () => {
    vi.useFakeTimers();
    const { doc, scroller } = buildVirtualized(6);
    scroller.scrollTop = 400;
    const parser = new ClaudeParser(doc);

    await run(parser, doc);

    expect(scroller.scrollTop).toBe(400);
  });

  it('stops when it reaches the top', async () => {
    vi.useFakeTimers();
    // Scrollable, but the same single pair whatever the scroll position: every
    // step after the first harvests nothing new.
    const { doc } = buildScroller({
      contentHeight: 10_000,
      mount: () => turnHtml(0) + turnHtml(1),
    });
    const parser = new ClaudeParser(doc);
    const parse = vi.spyOn(parser, 'parse');

    const result = await run(parser, doc);

    expect(parse.mock.calls.length).toBeLessThan(MAX_SCROLL_STEPS);
    expect(result.conversation?.pairs).toHaveLength(1);
  });

  it('falls back to the plain parse when the cap stops it short of the user', async () => {
    vi.useFakeTimers();
    // Effectively infinite content, and a fresh pair at every scroll position,
    // so the cap ends the walk long before it reaches scrollTop 0 -- where the
    // user is, and where the plain parse read the pairs in front of them.
    const { doc } = buildScroller({
      contentHeight: 1_000_000,
      mount: (scrollTop) =>
        `<div data-test-render-count="1"><div class="mb-1 mt-6 group"><div data-testid="user-message">
           <p class="whitespace-pre-wrap break-words">question ${scrollTop}</p></div></div></div>
         <div data-test-render-count="1"><div data-is-streaming="false"><div class="font-claude-response">
           <div class="standard-markdown"><p>answer ${scrollTop}</p></div></div></div></div>`,
    });
    const parser = new ClaudeParser(doc);

    const result = await run(parser, doc);

    // A walk that never reached the user's own window must not hand back a
    // conversation missing the exchanges they can see: never worse than the
    // plain parse.
    expect(result.conversation?.pairs).toHaveLength(1);
    expect(result.conversation?.pairs[0]?.question.content).toBe('question 0');
  });

  it('keeps a pair that straddles a window boundary', async () => {
    vi.useFakeTimers();
    // Eight turns: with whole-viewport steps the sampled windows never mount
    // both halves of pair 1, and it vanishes from the export. Windows have to
    // overlap for a pair sitting on a boundary to be seen whole anywhere.
    const { doc } = buildVirtualized(8);
    const parser = new ClaudeParser(doc);

    const result = await run(parser, doc);

    expect(result.conversation?.pairs.map((pair) => pair.question.content)).toEqual([
      'question 0',
      'question 1',
      'question 2',
      'question 3',
    ]);
  });

  it('keeps two distinct exchanges that have identical text', async () => {
    vi.useFakeTimers();
    // "thanks" / "you're welcome", twice in one conversation. Keyed by content
    // alone the second one disappears; the windows have to be stitched by
    // sequence position instead.
    const { doc } = buildScroller({
      contentHeight: 6 * TURN_HEIGHT,
      mount: (scrollTop) => {
        const first = Math.floor(scrollTop / TURN_HEIGHT);
        const last = Math.floor((scrollTop + VIEWPORT - 1) / TURN_HEIGHT);
        return (
          Array.from({ length: 6 }, (_, index) => index)
            .filter((index) => index >= first && index <= last)
            // Turns 0-1 and 4-5 are the same exchange; 2-3 is a different one.
            .map((index) => turnHtml(index < 2 || index > 3 ? index % 2 : index))
            .join('')
        );
      },
    });
    const parser = new ClaudeParser(doc);

    const result = await run(parser, doc);

    expect(result.conversation?.pairs.map((pair) => pair.question.content)).toEqual([
      'question 0',
      'question 1',
      'question 0',
    ]);
  });

  it('runs one pass at a time so concurrent exports cannot interleave', async () => {
    vi.useFakeTimers();
    // Export and print can be in flight together (lo-08b0). Two walks sharing
    // a scroller would restore each other's stale position.
    const { doc, scroller } = buildVirtualized(6);
    scroller.scrollTop = 400;
    const parser = new ClaudeParser(doc);

    const first = parseAllTurns(parser, doc);
    const second = parseAllTurns(parser, doc);
    await vi.advanceTimersByTimeAsync(SETTLE_MS * (MAX_SCROLL_STEPS + 5) * 2);
    const results = await Promise.all([first, second]);

    expect(scroller.scrollTop).toBe(400);
    for (const result of results) {
      expect(result.conversation?.pairs.map((pair) => pair.question.content)).toEqual([
        'question 0',
        'question 1',
        'question 2',
      ]);
    }
  });

  it('keeps warnings raised by the windows it walked through', async () => {
    vi.useFakeTimers();
    const { doc } = buildVirtualized(6);
    const parser = new ClaudeParser(doc);
    const real = parser.parse.bind(parser);
    let call = 0;
    vi.spyOn(parser, 'parse').mockImplementation(() => {
      call += 1;
      const result = real();
      return call === 2 ? { ...result, warnings: ['a turn failed to read'] } : result;
    });

    const result = await run(parser, doc);

    expect(result.warnings).toContain('a turn failed to read');
  });

  it('stitches ChatGPT windows that cut between a question and its answer', async () => {
    vi.useFakeTimers();
    // ChatGPT keeps an assistant unit that has no question before it -- that is
    // what makes a scheduled task export at all. But at a window's LEADING edge
    // that orphan is half of an exchange the next window up produces whole, and
    // the two cannot be stitched: `pairKey` sees ("", answer) against
    // (question, answer), the join fails, and both survive. Three exchanges came
    // out as five pairs with two answers printed twice.
    const { doc } = buildVirtualized(6, chatgptUnitHtml, 'https://chatgpt.com/c/abc123');
    const parser = new ChatGPTParser(doc);

    expect(parser.parse().conversation?.pairs.length).toBeLessThan(3);

    const result = await run(parser, doc);

    expect(result.conversation?.pairs.map((pair) => pair.question.content)).toEqual([
      'question 0',
      'question 1',
      'question 2',
    ]);
    expect(result.conversation?.pairs.map((pair) => pair.answer.content)).toEqual([
      'answer 0',
      'answer 1',
      'answer 2',
    ]);
  });

  it('leaves a streaming conversation alone', async () => {
    vi.useFakeTimers();
    const { doc, scroller } = buildVirtualized(6);
    const streaming = doc.createElement('div');
    streaming.setAttribute('data-is-streaming', 'true');
    doc.body.appendChild(streaming);
    const parser = new ClaudeParser(doc);
    const parse = vi.spyOn(parser, 'parse');

    const result = await run(parser, doc);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTop).toBe(0);
    expect(result.conversation?.pairs.length).toBeLessThan(3);
  });
});
