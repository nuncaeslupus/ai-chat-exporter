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
  /**
   * Pairs whose QUESTION the parser synthesised because the conversation
   * genuinely had no message for it, rather than because reading one failed.
   * Each listed pair spends its own `no-question` finding and nobody else's.
   *
   * Pair indexes rather than a count, because a count is fungible: a
   * synthesised question early in the list would buy silence for a genuine
   * read failure later on, which is the one thing this allowance must never
   * do. Only answers are never listed -- a user turn still awaiting its reply
   * is skipped as pending, so an empty answer is always a read failure.
   *
   * Only the parser knows the difference, so only the parser may claim it;
   * this defaults to empty, which keeps the rule at full strength everywhere
   * that does not override `BaseParser.synthesizedQuestions`.
   */
  synthesizedQuestions?: readonly number[];
}

export function checkOutputSanity(input: SanityInput): SanityFinding[] {
  const findings: SanityFinding[] = [];
  const { pairs, turnCount, turnTextLengths, chromeStrings } = input;
  const synthesized = input.synthesizedQuestions ?? [];

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

  // At least one pair came out, but the DOM held more turns than two per pair
  // account for: some turn was skipped mid-walk (an orphan assistant turn, an
  // unrecognized role, a second consecutive assistant turn) with no pair, no
  // warning, and nothing else to notice. `no-pairs` above only ever catches
  // the all-or-nothing case.
  if (turnCount > 0 && pairs.length * 2 < turnCount) {
    findings.push({
      rule: 'turns-dropped',
      detail: `${pairs.length} pair(s) from ${turnCount} turn container(s)`,
    });
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
      // The allowance covers this pair's question and nothing else: an empty
      // answer never spends it, and neither does another pair's missing
      // question.
      if (question.length > 0 || !synthesized.includes(i)) {
        findings.push({
          rule: 'no-question',
          detail: question.length === 0 ? `pair ${i}: no question` : `pair ${i}: no answer`,
        });
      }
    }
  });

  return findings;
}
