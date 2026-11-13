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
import {
  parseAllTurns,
  MAX_SCROLL_STEPS,
  SETTLE_MS,
} from '../../../../src/extension/content/scroll-to-load';

/** Scroller viewport height, in fixture pixels. */
const VIEWPORT = 1000;
/** Height of one turn, so a viewport holds three of them (and two pairs). */
const TURN_HEIGHT = 400;

const PAGE = `<!DOCTYPE html><html><body>
  <div class="overflow-y-auto overflow-x-hidden pt-6 flex-1" id="scroller"><div id="inner"></div></div>
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
function buildVirtualized(total: number): { doc: Document; scroller: HTMLElement } {
  return buildScroller({
    contentHeight: total * TURN_HEIGHT,
    mount: (scrollTop) => {
      const first = Math.floor(scrollTop / TURN_HEIGHT);
      const last = Math.floor((scrollTop + VIEWPORT - 1) / TURN_HEIGHT);
      return Array.from({ length: total }, (_, index) => index)
        .filter((index) => index >= first && index <= last)
        .map(turnHtml)
        .join('');
    },
  });
}

/** Drive the pass to completion under fake timers. */
async function run(parser: ClaudeParser, doc: Document) {
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

  it('stops once the turn count stops growing', async () => {
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

  it('stops at the step cap when the turn count keeps growing', async () => {
    vi.useFakeTimers();
    // Effectively infinite content, and a fresh pair at every scroll position,
    // so only the cap can end the pass.
    const { doc } = buildScroller({
      contentHeight: 1_000_000,
      mount: (scrollTop) =>
        `<div data-test-render-count="1"><div class="mb-1 mt-6 group"><div data-testid="user-message">
           <p class="whitespace-pre-wrap break-words">question ${scrollTop}</p></div></div></div>
         <div data-test-render-count="1"><div data-is-streaming="false"><div class="font-claude-response">
           <div class="standard-markdown"><p>answer ${scrollTop}</p></div></div></div></div>`,
    });
    const parser = new ClaudeParser(doc);
    const parse = vi.spyOn(parser, 'parse');

    const result = await run(parser, doc);

    // One baseline parse, one at the bottom, then one per capped step.
    expect(parse).toHaveBeenCalledTimes(MAX_SCROLL_STEPS + 2);
    expect(result.conversation?.pairs).toHaveLength(MAX_SCROLL_STEPS + 1);
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
