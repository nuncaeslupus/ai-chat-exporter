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
 * and harvests each window's pairs as they mount, merging them into one
 * conversation. Walking upwards also gives the page the chance to fetch older
 * turns it had not loaded at all.
 *
 * Stepping by one viewport at a time is what makes the merge complete: every
 * question/answer boundary in the conversation falls inside some viewport
 * position, and a virtualizer mounts whole items that intersect the viewport,
 * so each pair is fully mounted -- and therefore paired by the parser -- in at
 * least one window, however tall its answer is.
 */

import type { IParser, ParseResult, QAPair } from '../../core/types';

/**
 * Hard cap on scroll steps. An export must finish even on a conversation that
 * keeps loading older turns forever; at `SETTLE_MS` per step this bounds the
 * pass at a few seconds.
 */
export const MAX_SCROLL_STEPS = 50;

/** How long to let the page mount newly revealed turns after each scroll. */
export const SETTLE_MS = 150;

/**
 * Consecutive steps that may harvest nothing before the pass gives up. One
 * barren step is not the top: a single answer can be taller than the viewport,
 * so a step can land inside one and reveal no turn that was not already seen.
 */
const BARREN_STEP_LIMIT = 2;

/**
 * How much taller than its viewport a candidate must be to count as *the*
 * scroller. A conversation page has several nested scroll boxes that are a few
 * pixels over their content; the one holding the chat is far taller.
 */
const SCROLLABLE_MARGIN_PX = 200;

/**
 * The first candidate of `custom.scrollContainer` that is actually scrollable.
 *
 * The selector is deliberately loose: the live scroller is an inner element
 * whose utility classes churn (and on ChatGPT is a `main` descendant rather
 * than `document.scrollingElement`), so it is identified by measurement rather
 * than by a class chain that goes stale. No `scrollContainer` -- Gemini, which
 * was not observed virtualizing -- means no pass.
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
 */
function pairKey(pair: QAPair): string {
  return `${pair.question.content}\u0000${pair.answer.content}`;
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
}

/**
 * Parse the conversation, scrolling virtualized turns into the DOM first.
 *
 * Returns the plain `parser.parse()` result unchanged when there is nothing to
 * do: no scroll container for this platform, the page is not scrollable, a
 * response is streaming, or the pass found no pair the plain parse had missed.
 */
export async function parseAllTurns(
  parser: IParser,
  doc: Document = document
): Promise<ParseResult> {
  const base = parser.parse();
  const scroller = findScroller(parser, doc);
  if (!base.success || !base.conversation || !scroller || isStreaming(parser, doc)) {
    return base;
  }

  const originalScrollTop = scroller.scrollTop;
  const seen = new Set<string>();
  const pairs: QAPair[] = [];

  /** Add this window's unseen pairs *above* what earlier windows gave us. */
  const harvest = (): number => {
    const fresh = (parser.parse().conversation?.pairs ?? []).filter(
      (pair) => !seen.has(pairKey(pair))
    );
    for (const pair of fresh) {
      seen.add(pairKey(pair));
    }
    pairs.unshift(...fresh);
    return fresh.length;
  };

  try {
    scroller.scrollTop = scroller.scrollHeight;
    await settle();
    harvest();
    let barren = 0;
    for (
      let step = 0;
      step < MAX_SCROLL_STEPS && scroller.scrollTop > 0 && barren < BARREN_STEP_LIMIT;
      step += 1
    ) {
      scroller.scrollTop -= scroller.clientHeight;
      await settle();
      barren = harvest() === 0 ? barren + 1 : 0;
    }
  } finally {
    scroller.scrollTop = originalScrollTop;
  }

  // ponytail: a pass that found no more than the plain parse did -- a
  // scrollContainer that resolved to the wrong element, say -- must never make
  // the export smaller than it was without it.
  if (pairs.length <= base.conversation.pairs.length) {
    return base;
  }

  return {
    ...base,
    conversation: {
      ...base.conversation,
      pairs: pairs.map((pair, index) => ({ ...pair, index })),
    },
  };
}
