/**
 * OutputSanity: the half of drift detection that catches a parse which
 * *succeeded* and produced structurally well-formed garbage. The ChatGPT Deep
 * Research case is the reference: nothing errored, nothing missed, and the
 * answer came out as the 13-character sr-only label "ChatGPT said:".
 */
import { describe, it, expect } from 'vitest';
import { checkOutputSanity } from '../../../../src/core/drift/output-sanity';
import type { QAPair } from '../../../../src/core/types';

function pair(question: string, answer: string, index = 0): QAPair {
  return {
    index,
    question: { id: `q${index}`, role: 'user', content: question, timestamp: new Date(0) },
    answer: { id: `a${index}`, role: 'assistant', content: answer, timestamp: new Date(0) },
  } as QAPair;
}

const chrome = ['ChatGPT said:', 'You said:'];

describe('checkOutputSanity', () => {
  it('fires no-pairs when the DOM had turns but nothing was extracted', () => {
    const findings = checkOutputSanity({
      pairs: [],
      turnCount: 6,
      turnTextLengths: [],
      chromeStrings: chrome,
    });
    expect(findings.map((f) => f.rule)).toContain('no-pairs');
  });

  it('does not fire no-pairs on a page with no turns at all', () => {
    const findings = checkOutputSanity({
      pairs: [],
      turnCount: 0,
      turnTextLengths: [],
      chromeStrings: chrome,
    });
    expect(findings).toEqual([]);
  });

  it('fires chrome-as-content when the answer is a UI label', () => {
    const findings = checkOutputSanity({
      pairs: [pair('What is X?', 'ChatGPT said:')],
      turnCount: 1,
      turnTextLengths: [529],
      chromeStrings: chrome,
    });
    expect(findings.map((f) => f.rule)).toContain('chrome-as-content');
  });

  it('fires content-shortfall when a long turn yields almost nothing', () => {
    const findings = checkOutputSanity({
      pairs: [pair('What is X?', 'ChatGPT said:')],
      turnCount: 1,
      turnTextLengths: [529],
      chromeStrings: chrome,
    });
    expect(findings.map((f) => f.rule)).toContain('content-shortfall');
  });

  it('does NOT fire content-shortfall on a legitimately terse answer', () => {
    // "Yes." from a 40-character turn is a real answer, not drift. This is the
    // regression that killed the original "under 20 characters" rule.
    const findings = checkOutputSanity({
      pairs: [pair('Is X true?', 'Yes.')],
      turnCount: 1,
      turnTextLengths: [40],
      chromeStrings: chrome,
    });
    expect(findings).toEqual([]);
  });

  it('fires empty-answer only on empty or whitespace content', () => {
    const findings = checkOutputSanity({
      pairs: [pair('Q', '   ')],
      turnCount: 1,
      turnTextLengths: [-1],
      chromeStrings: chrome,
    });
    expect(findings.map((f) => f.rule)).toContain('empty-answer');
  });

  it('fires no-question when a pair is half-formed', () => {
    const findings = checkOutputSanity({
      pairs: [pair('', 'A real answer with plenty of text in it.')],
      turnCount: 1,
      turnTextLengths: [-1],
      chromeStrings: chrome,
    });
    expect(findings.map((f) => f.rule)).toContain('no-question');
  });

  it('fires turns-dropped when the DOM held more turns than the pairs account for (PAR-1)', () => {
    // Three turn containers (e.g. a custom-GPT greeting, a question, an
    // answer) but only one pair came out: the greeting was silently dropped.
    const findings = checkOutputSanity({
      pairs: [pair('question two', 'answer two')],
      turnCount: 3,
      turnTextLengths: [-1],
      chromeStrings: chrome,
    });
    expect(findings.map((f) => f.rule)).toContain('turns-dropped');
  });

  it('does NOT fire turns-dropped on a healthy 1-pair-per-2-turns conversation', () => {
    const findings = checkOutputSanity({
      pairs: [pair('What is X?', 'X is Y.')],
      turnCount: 2,
      turnTextLengths: [-1],
      chromeStrings: chrome,
    });
    expect(findings.map((f) => f.rule)).not.toContain('turns-dropped');
  });

  it('returns nothing for a healthy conversation', () => {
    const findings = checkOutputSanity({
      pairs: [
        pair('What is the capital of France?', 'Paris is the capital of France.', 0),
        pair('And of Spain?', 'Madrid is the capital of Spain.', 1),
      ],
      turnCount: 2,
      turnTextLengths: [40, 38],
      chromeStrings: chrome,
    });
    expect(findings).toEqual([]);
  });

  it('suppresses content-shortfall when the turn length is unknown', () => {
    const findings = checkOutputSanity({
      pairs: [pair('Q', 'A')],
      turnCount: 1,
      turnTextLengths: [-1],
      chromeStrings: chrome,
    });
    expect(findings.map((f) => f.rule)).not.toContain('content-shortfall');
  });
});
