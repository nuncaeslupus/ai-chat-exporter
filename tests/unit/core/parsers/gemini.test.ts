import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GeminiParser } from '../../../../src/core/parsers/gemini/parser';
import { GEMINI_SELECTORS } from '../../../../src/core/parsers/gemini/selectors';

const FIXTURE = join(__dirname, '../../../fixtures/dom-snapshots/gemini/real-capture.html');
const GEMINI_URL = 'https://gemini.google.com/app/abc123';

function parserFor(html: string, url = GEMINI_URL): GeminiParser {
  const dom = new JSDOM(html, { url });
  return new GeminiParser(dom.window.document);
}

describe('GeminiParser', () => {
  let html: string;
  let parser: GeminiParser;

  beforeEach(() => {
    html = readFileSync(FIXTURE, 'utf-8');
    parser = parserFor(html);
  });

  describe('selectors', () => {
    // Guards against the failure mode where a selector silently matches
    // nothing after a redesign while every other test stays green.
    it('every GEMINI_SELECTORS entry matches the captured DOM', () => {
      const { document } = new JSDOM(html).window;
      const selectors = [
        GEMINI_SELECTORS.conversationContainer,
        GEMINI_SELECTORS.messageElement,
        GEMINI_SELECTORS.userMessage,
        GEMINI_SELECTORS.assistantMessage,
        GEMINI_SELECTORS.messageContent,
        GEMINI_SELECTORS.conversationTitle,
        GEMINI_SELECTORS.modelIndicator,
        ...Object.values(GEMINI_SELECTORS.custom ?? {}),
      ].filter((s): s is string => Boolean(s));

      for (const selector of selectors) {
        expect(document.querySelectorAll(selector).length, selector).toBeGreaterThan(0);
      }
    });
  });

  describe('canParse', () => {
    it('returns true for a Gemini URL with a conversation in the DOM', () => {
      expect(parser.canParse()).toBe(true);
    });

    it('returns false for a non-Gemini URL', () => {
      expect(parserFor(html, 'https://chatgpt.com/c/abc').canParse()).toBe(false);
    });

    it('returns false when the conversation container is missing', () => {
      expect(parserFor('<main></main>').canParse()).toBe(false);
    });
  });

  describe('getTitle', () => {
    it('reads the conversation title from the top bar', () => {
      expect(parser.getTitle()).toBe('Paper airplane aerodynamics');
    });

    it('falls back to a default title when no title element exists', () => {
      expect(parserFor('<main></main>').getTitle()).toBe('Gemini Conversation');
    });
  });

  describe('getModel', () => {
    it('reads the model label from the mode switcher', () => {
      expect(parser.getModel()).toBe('Gemini');
    });

    it('returns null when no model indicator exists', () => {
      expect(parserFor('<main></main>').getModel()).toBeNull();
    });
  });

  describe('getButtonInjectionPoint', () => {
    it('returns the top bar actions area', () => {
      const point = parser.getButtonInjectionPoint();
      expect(point).not.toBeNull();
      expect(point?.className).toContain('right-section');
    });

    it('returns null when the top bar is missing', () => {
      expect(parserFor('<main></main>').getButtonInjectionPoint()).toBeNull();
    });
  });

  describe('extractQAPairs', () => {
    it('pairs every question with the answer from the same container', () => {
      const result = parser.parse();
      expect(result.success).toBe(true);

      const pairs = result.conversation?.pairs ?? [];
      expect(pairs).toHaveLength(3);
      expect(pairs.map((p) => p.question.content)).toEqual([
        'How does a wing actually generate lift?',
        'Why does 100 GSM paper fly further than printer paper?',
        'Give me the HTML for a small infographic about it.',
      ]);
      pairs.forEach((pair, index) => {
        expect(pair.index).toBe(index);
        expect(pair.question.role).toBe('user');
        expect(pair.answer.role).toBe('assistant');
        expect(pair.answer.content.length).toBeGreaterThan(50);
      });
      expect(pairs[0]?.answer.content).toContain("Bernoulli");
    });

    it('keeps the model thinking panel out of the answer', () => {
      const pairs = parser.parse().conversation?.pairs ?? [];
      expect(pairs[0]?.answer.content).not.toContain('Show thinking');
    });

    it('keeps rendered maths in the answer text', () => {
      // Gemini ships only the aria-hidden `.katex-html` copy (no MathML, no
      // LaTeX annotation), so the shared cleanup must fall through to it.
      const pairs = parser.parse().conversation?.pairs ?? [];
      expect(pairs[1]?.answer.content).toMatch(/mv/);
    });

    it('preserves HTML for both sides when configured', () => {
      const pairs = parser.parse({ preserveHtml: true }).conversation?.pairs ?? [];
      expect(pairs[0]?.answer.htmlContent).toContain('<');
      expect(pairs[0]?.question.htmlContent).toBeTruthy();
    });

    it('returns no pairs for a document without a conversation', () => {
      const result = parserFor('<main></main>').parse();
      expect(result.conversation?.pairs).toHaveLength(0);
      expect(result.warnings).toContain('No Q&A pairs found in the conversation');
    });
  });
});

describe('parser registry', () => {
  it('registers gemini so detectParser can find it', async () => {
    const { parserRegistry } = await import('../../../../src/core/parsers/index');
    expect([...parserRegistry.keys()]).toContain('gemini');
  });

  it('detectParser selects GeminiParser on a gemini document', async () => {
    const { detectParser } = await import('../../../../src/core/parsers/index');
    const html = readFileSync(FIXTURE, 'utf-8');
    const dom = new JSDOM(html, { url: GEMINI_URL });
    expect(detectParser(dom.window.document)).toBeInstanceOf(GeminiParser);
  });
});
