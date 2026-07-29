/**
 * BaseParser wiring: a parse attaches a DriftReport when something is wrong,
 * attaches nothing when the page is healthy, and NEVER fails because the
 * safety net threw.
 */
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { BaseParser } from '../../../../src/core/parsers/base-parser';
import type { ParserConfig, PlatformInfo, QAPair, SelectorSet } from '../../../../src/core/types';

const SELECTORS: SelectorSet = {
  conversationContainer: 'main',
  messageElement: '[data-turn]',
  userMessage: '[data-turn="user"]',
  assistantMessage: '[data-turn="assistant"]',
  messageContent: '.content',
};

function makePair(question: string, answer: string, index = 0): QAPair {
  return {
    index,
    question: { id: `q${index}`, role: 'user', content: question, timestamp: new Date(0) },
    answer: { id: `a${index}`, role: 'assistant', content: answer, timestamp: new Date(0) },
  } as QAPair;
}

class TestParser extends BaseParser {
  readonly platformInfo = { id: 'chatgpt', name: 'Test' } as PlatformInfo;
  readonly selectors = SELECTORS;
  pairsToReturn: QAPair[] = [];

  canParse(): boolean {
    return true;
  }
  getTitle(): string {
    return 'Test';
  }
  getModel(): string | null {
    return null;
  }
  getButtonInjectionPoint(): HTMLElement | null {
    return null;
  }
  protected extractQAPairs(_config: ParserConfig): QAPair[] {
    return this.pairsToReturn;
  }
  protected override get chromeStrings(): readonly string[] {
    return ['ChatGPT said:'];
  }
}

function parserFor(html: string): TestParser {
  return new TestParser(new JSDOM(html).window.document);
}

describe('BaseParser drift detection', () => {
  it('attaches no drift report to a healthy parse', () => {
    const parser = parserFor(
      '<main><div data-turn="user"><span class="content">hi</span></div>' +
        '<div data-turn="assistant"><span class="content">hello</span></div></main>'
    );
    parser.pairsToReturn = [makePair('hi', 'hello there, this is a real answer')];
    const result = parser.parse();
    expect(result.success).toBe(true);
    expect(result.drift).toBeUndefined();
  });

  it('attaches a drift report when a required selector matches nothing', () => {
    const parser = parserFor('<main><div class="totally-different"></div></main>');
    parser.pairsToReturn = [makePair('hi', 'hello there, this is a real answer')];
    const result = parser.parse();
    expect(result.drift).toBeDefined();
    expect(
      result.drift?.selectorFindings.some((f) => f.key === 'messageElement' && f.matched === 0)
    ).toBe(true);
  });

  it('attaches a drift report when a sanity rule fires', () => {
    const parser = parserFor(
      '<main><div data-turn="user"><span class="content">hi</span></div>' +
        '<div data-turn="assistant"><span class="content">x</span></div></main>'
    );
    parser.pairsToReturn = [makePair('hi', 'ChatGPT said:')];
    const result = parser.parse();
    expect(result.drift?.sanityFindings.map((f) => f.rule)).toContain('chrome-as-content');
  });

  it('carries a fingerprint, platform and ISO date', () => {
    const parser = parserFor('<main></main>');
    parser.pairsToReturn = [];
    const drift = parser.parse().drift;
    expect(drift?.fingerprint).toMatch(/^[0-9a-z]+$/);
    expect(drift?.platform).toBe('chatgpt');
    expect(drift?.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('never breaks the export when detection throws', () => {
    const parser = parserFor('<main><div data-turn="user"></div></main>');
    parser.pairsToReturn = [makePair('hi', 'a real answer here')];
    // Force the detector to blow up.
    vi.spyOn(
      parser as unknown as { detectDriftUnsafe: () => void },
      'detectDriftUnsafe'
    ).mockImplementation(() => {
      throw new Error('boom');
    });
    const result = parser.parse();
    expect(result.success).toBe(true);
    expect(result.conversation).toBeDefined();
    expect(result.drift).toBeUndefined();
  });
});
