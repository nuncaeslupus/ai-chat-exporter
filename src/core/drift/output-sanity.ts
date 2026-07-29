/**
 * Sanity rules over the *parsed result*, for the drift case that selector
 * health cannot see: a parse that succeeded and produced well-formed garbage.
 *
 * The reference case is ChatGPT Deep Research — nothing errored, nothing
 * missed, and the answer came out as the sr-only label "ChatGPT said:".
 */

import type { QAPair } from '../types';
import type { SanityFinding } from './types';

/** An answer under this share of its turn's text is a shortfall. */
export const CONTENT_SHORTFALL_RATIO = 0.05;
/** ...but only when the turn itself held more than this much text. */
export const CONTENT_SHORTFALL_MIN_TURN_CHARS = 200;

export interface SanityInput {
  pairs: QAPair[];
  /** Turn containers present in the DOM, however many pairs came out. */
  turnCount: number;
  /** textContent.length of each pair's source turn; -1 means unknown. */
  turnTextLengths: number[];
  /** Platform UI labels that must never be answer content. */
  chromeStrings: readonly string[];
}

export function checkOutputSanity(input: SanityInput): SanityFinding[] {
  const findings: SanityFinding[] = [];
  const { pairs, turnCount, turnTextLengths, chromeStrings } = input;

  // The DOM had turns and we produced nothing: the extractor is broken, not
  // the page. An empty page (turnCount 0) is just an empty page.
  if (pairs.length === 0) {
    if (turnCount > 0) {
      findings.push({
        rule: 'no-pairs',
        detail: `0 pairs extracted from ${turnCount} turn container(s)`,
      });
    }
    return findings;
  }

  pairs.forEach((pair, i) => {
    const answer = pair.answer?.content?.trim() ?? '';
    const question = pair.question?.content?.trim() ?? '';

    if (answer.length === 0) {
      findings.push({ rule: 'empty-answer', detail: `pair ${i}: answer is empty` });
    }

    if (chromeStrings.some((label) => answer === label)) {
      findings.push({
        rule: 'chrome-as-content',
        detail: `pair ${i}: answer is the UI label "${answer}"`,
      });
    }

    const turnChars = turnTextLengths[i] ?? -1;
    if (
      turnChars > CONTENT_SHORTFALL_MIN_TURN_CHARS &&
      answer.length < turnChars * CONTENT_SHORTFALL_RATIO
    ) {
      findings.push({
        rule: 'content-shortfall',
        detail: `pair ${i}: extracted ${answer.length} of ${turnChars} chars`,
      });
    }

    if ((answer.length === 0) !== (question.length === 0)) {
      findings.push({
        rule: 'no-question',
        detail: question.length === 0 ? `pair ${i}: no question` : `pair ${i}: no answer`,
      });
    }
  });

  return findings;
}
