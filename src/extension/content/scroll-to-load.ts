/**
 * Scroll-to-load: parse every turn of a virtualized conversation, not just the
 * window that happens to be rendered.
 *
 * chatgpt.com and claude.ai both virtualize conversation turns -- nodes are
 * mounted and unmounted as the viewport moves, not merely hidden with
 * `content-visibility` -- so a single parse sees one window of the chat.
 * Measured live on 2026-11-13: a 3-exchange ChatGPT conversation had 4 of its 6
 * message units in the DOM at rest and only 2 of 6 scrolled to the top. The
 * export silently lost the rest, and when the rendered window held no complete
 * user+assistant pair the popup reported "no conversation" on a page whose
 * selectors were all healthy.
 *
 * Because the turns are *unmounted* rather than hidden, no scroll position
 * leaves them all in the DOM at once: scrolling and then parsing once would
 * still see a window. So the pass walks the scroller from the bottom upwards
 * and stitches each window's pairs onto the ones already collected. Walking
 * upwards also gives the page the chance to fetch older turns it had not
 * loaded at all.
 *
 * The contract is "never worse than the plain parse": the walk's result is
 * used only when it contains everything `parser.parse()` already saw (see
 * `containsAll`). A pass that is cut short by the step cap before it reaches
 * the user's own position therefore falls back rather than returning a
 * conversation missing the turns in front of them.
 */

import type { IParser, ParseResult, QAPair } from '../../core/types';

/**
 * Hard cap on scroll steps, each `STEP_FRACTION` of a viewport. An export must
 * finish even on a conversation that keeps loading older turns forever.
 */
export const MAX_SCROLL_STEPS = 100;

/** How long to let the page mount newly revealed turns after each scroll. */
export const SETTLE_MS = 150;

/**
 * How far to scroll per step, as a fraction of the viewport.
 *
 * Successive windows must *overlap*: a pair is only harvested where its
 * question and its answer are mounted at the same time, so stepping by a whole
 * viewport drops any pair that straddles a window boundary. Half a viewport
 * guarantees every pair shorter than that is wholly inside some window.
 */
const STEP_FRACTION = 0.5;

/**
 * How much taller than its viewport a candidate must be to count as *the*
 * scroller. A conversation page has several nested scroll boxes that are a few
 * pixels over their content; the one holding the chat is far taller.
 */
const SCROLLABLE_MARGIN_PX = 200;

/**
 * The first candidate of `custom.scrollContainer` that is actually scrollable.
 *
 * ChatGPT names its scroller (`.thread-scroll-container`); Claude's selector is
 * a loose candidate list, because the live scroller is an inner element whose
 * utility classes churn. No `scrollContainer` -- Gemini, which was not observed
 * virtualizing -- means no pass.
 */
function findScroller(parser: IParser, doc: Document): HTMLElement | null {
  const selector = parser.selectors.custom?.scrollContainer;
  if (!selector) {
    return null;
  }
  for (const candidate of doc.querySelectorAll<HTMLElement>(selector)) {
    if (candidate.scrollHeight > candidate.clientHeight + SCROLLABLE_MARGIN_PX) {
      return candidate;
    }
  }
  return null;
}

/** Whether a response is still being written: never scroll a live turn away. */
function isStreaming(parser: IParser, doc: Document): boolean {
  const selector = parser.selectors.custom?.streamingTurn;
  return !!selector && doc.querySelector(selector) !== null;
}

/**
 * Identity of a pair across windows. `pair.id` is regenerated on every parse
 * and `pair.index` is a position within one window, so the content is the only
 * thing that identifies the same exchange seen twice.
 *
 * ponytail: content keying drops one of two *adjacent* exchanges whose question
 * and answer text are both byte-identical, when the two are together taller
 * than a step so that no window mounts both. The walk then sees windows `[A]`,
 * `[A]` and cannot tell "the same pair again" from "the next pair, identical" --
 * they are the same observation. `overlapLength` reads it as the former and
 * `containsAll` passes it, since the baseline window holds neither copy.
 *
 * The upgrade path is per-message identity that survives unmounting, and it is
 * not available today: a virtualizer remounts a turn as a *fresh node*, so no
 * DOM-node identity carries over, and only the app's own id attribute does.
 * ChatGPT has one (`custom.messageIdAttr`, `data-message-id`); Claude's DOM
 * carries no per-message id at all (its turns expose only `data-testid`,
 * `data-test-render-count` and `data-is-streaming`). Keying on `message.id`
 * regardless would be worse, not better: both parsers fall back to
 * `generateId()` per element when the attribute is missing, and a generated id
 * never matches across windows, so every such pair would be re-prepended at
 * every one of the up-to-100 steps -- trading a rare silent drop for frequent
 * silent duplication.
 *
 * Fix it when a platform exposes a stable id for every message, or when the
 * merge is rebuilt on turn geometry rather than on parsed text.
 */
function pairKey(pair: QAPair): string {
  return `${pair.question.content}\u0000${pair.answer.content}`;
}

/**
 * How many of `incoming`'s trailing pairs are already the leading pairs of
 * `collected` -- i.e. where the two overlapping windows join.
 *
 * Matching runs of pairs rather than individual pairs is what keeps two
 * genuinely distinct exchanges that happen to have identical text ("thanks" /
 * "you're welcome", twice in one chat) from collapsing into one: they are told
 * apart by their position in the sequence, not by their content.
 */
function overlapLength(incoming: QAPair[], collected: QAPair[]): number {
  const keys = (list: QAPair[]): string => list.map(pairKey).join('\u0001');
  for (let length = Math.min(incoming.length, collected.length); length > 0; length -= 1) {
    if (keys(incoming.slice(incoming.length - length)) === keys(collected.slice(0, length))) {
      return length;
    }
  }
  return 0;
}

/** Whether `haystack` holds at least as many of each pair as `needles` does. */
function containsAll(haystack: QAPair[], needles: QAPair[]): boolean {
  const available = new Map<string, number>();
  for (const pair of haystack) {
    const key = pairKey(pair);
    available.set(key, (available.get(key) ?? 0) + 1);
  }
  for (const pair of needles) {
    const key = pairKey(pair);
    const left = available.get(key) ?? 0;
    if (left === 0) {
      return false;
    }
    available.set(key, left - 1);
  }
  return true;
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
}

async function walk(parser: IParser, doc: Document): Promise<ParseResult> {
  const base = parser.parse();
  const scroller = findScroller(parser, doc);
  if (!base.success || !base.conversation || !scroller || isStreaming(parser, doc)) {
    return base;
  }

  const originalScrollTop = scroller.scrollTop;
  const warnings = [...(base.warnings ?? [])];
  let pairs: QAPair[] = [];

  /** Stitch this window onto the front of what the lower windows gave us. */
  const harvest = (): void => {
    const result = parser.parse();
    const incoming = result.conversation?.pairs ?? [];
    warnings.push(...(result.warnings ?? []));
    pairs = [...incoming.slice(0, incoming.length - overlapLength(incoming, pairs)), ...pairs];
  };

  try {
    const step = Math.max(1, Math.round(scroller.clientHeight * STEP_FRACTION));
    scroller.scrollTop = scroller.scrollHeight;
    await settle();
    harvest();
    for (let i = 0; i < MAX_SCROLL_STEPS && scroller.scrollTop > 0; i += 1) {
      scroller.scrollTop -= step;
      await settle();
      harvest();
    }
  } finally {
    scroller.scrollTop = originalScrollTop;
  }

  // The "never worse than the plain parse" contract. A walk that resolved the
  // wrong element, or that ran out of steps before reaching the user's own
  // position, can hold *fewer* exchanges than they already had on screen.
  if (
    pairs.length <= base.conversation.pairs.length ||
    !containsAll(pairs, base.conversation.pairs)
  ) {
    return base;
  }

  return {
    ...base,
    ...(warnings.length > 0 ? { warnings: [...new Set(warnings)] } : {}),
    conversation: {
      ...base.conversation,
      pairs: pairs.map((pair, index) => ({ ...pair, index })),
    },
  };
}

/**
 * Passes run one at a time: export and print can be in flight together
 * (lo-08b0), and two walks sharing a scroller would interleave their scrolling
 * and restore each other's stale positions.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Parse the conversation, scrolling virtualized turns into the DOM first.
 *
 * Returns the plain `parser.parse()` result unchanged when there is nothing to
 * do: no scroll container for this platform, the page is not scrollable, a
 * response is streaming, or the walk did not improve on what was already there.
 */
export function parseAllTurns(parser: IParser, doc: Document = document): Promise<ParseResult> {
  const pass = queue.then(() => walk(parser, doc));
  queue = pass.catch(() => undefined);
  return pass;
}
