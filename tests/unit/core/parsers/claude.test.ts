import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ClaudeParser } from '../../../../src/core/parsers/claude/parser';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('ClaudeParser', () => {
  let parser: ClaudeParser;
  let dom: JSDOM;
  let document: Document;

  beforeEach(() => {
    // Load captured DOM fixture
    const html = readFileSync(
      join(__dirname, '../../../fixtures/dom-snapshots/claude/real-capture.html'),
      'utf-8'
    );
    dom = new JSDOM(html, { url: 'https://claude.ai/chat/abc123' });
    document = dom.window.document as unknown as Document;
    parser = new ClaudeParser(document);
  });

  describe('canParse', () => {
    it('returns true for claude.ai URLs', () => {
      // URL is already set in beforeEach to https://claude.ai/chat/abc123
      expect(parser.canParse()).toBe(true);
    });

    it('returns true for www.claude.ai URLs', () => {
      const html = readFileSync(
        join(__dirname, '../../../fixtures/dom-snapshots/claude/real-capture.html'),
        'utf-8'
      );
      dom = new JSDOM(html, { url: 'https://www.claude.ai/chat/abc123' });
      document = dom.window.document as unknown as Document;
      parser = new ClaudeParser(document);

      expect(parser.canParse()).toBe(true);
    });

    it('returns false for non-claude URLs', () => {
      const html = readFileSync(
        join(__dirname, '../../../fixtures/dom-snapshots/claude/real-capture.html'),
        'utf-8'
      );
      dom = new JSDOM(html, { url: 'https://chatgpt.com' });
      document = dom.window.document as unknown as Document;
      parser = new ClaudeParser(document);

      expect(parser.canParse()).toBe(false);
    });

    it('returns false when conversation container not found', () => {
      const emptyDom = new JSDOM('<div></div>', { url: 'https://claude.ai/chat/abc123' });
      const emptyDocument = emptyDom.window.document as unknown as Document;
      const emptyParser = new ClaudeParser(emptyDocument);

      expect(emptyParser.canParse()).toBe(false);
    });
  });

  describe('getTitle', () => {
    it('extracts conversation title correctly', () => {
      const title = parser.getTitle();
      expect(title).toBe('Sample conversation title');
    });

    it('returns default title when element not found', () => {
      document.querySelector('[data-testid="chat-title-button"]')?.remove();
      // Also remove page title to test the final fallback
      const titleEl = document.querySelector('title');
      if (titleEl) titleEl.textContent = '';

      const title = parser.getTitle();
      expect(title).toBe('Claude Conversation');
    });

    it('handles empty title element', () => {
      const titleEl = document.querySelector('[data-testid="chat-title-button"] div.truncate');
      if (titleEl) titleEl.textContent = '   ';

      // Also clear page title to test fallback to default
      const pageTitleEl = document.querySelector('title');
      if (pageTitleEl) pageTitleEl.textContent = '';

      const title = parser.getTitle();
      expect(title).toBe('Claude Conversation');
    });
  });

  describe('getModel', () => {
    it('extracts model name correctly', () => {
      const model = parser.getModel();
      expect(model).toBe('Claude Sonnet 4.5');
    });

    it('returns null when model indicator not found', () => {
      document.querySelector('[data-testid="model-selector-dropdown"]')?.remove();
      expect(parser.getModel()).toBeNull();
    });

    it('handles model without "Claude" prefix', () => {
      const modelEl = document.querySelector('[data-testid="model-selector-dropdown"] div.whitespace-nowrap');
      if (modelEl) modelEl.textContent = 'Opus 4';

      const model = parser.getModel();
      expect(model).toBe('Claude Opus 4');
    });
  });

  describe('parse', () => {
    it('successfully parses conversation', () => {
      const result = parser.parse();

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.conversation).toBeDefined();
    });

    it('extracts correct number of Q&A pairs', () => {
      const result = parser.parse();

      expect(result.conversation).toBeDefined();
      expect(result.conversation!.pairs.length).toBe(1);
    });

    it('sets platform correctly', () => {
      const result = parser.parse();
      expect(result.conversation!.platform).toBe('claude');
    });

    it('sets conversation title', () => {
      const result = parser.parse();
      expect(result.conversation!.title).toBe('Sample conversation title');
    });

    it('sets conversation URL', () => {
      const result = parser.parse();
      expect(result.conversation!.url).toBe('https://claude.ai/chat/abc123');
    });

    it('sets model', () => {
      const result = parser.parse();
      expect(result.conversation!.model).toBe('Claude Sonnet 4.5');
    });

    it('identifies user messages correctly', () => {
      const result = parser.parse();
      const pairs = result.conversation!.pairs;

      expect(pairs.length).toBeGreaterThan(0);
      pairs.forEach(pair => {
        expect(pair.question.role).toBe('user');
        expect(pair.question.content).toBeTruthy();
      });
    });

    it('identifies assistant messages correctly', () => {
      const result = parser.parse();
      const pairs = result.conversation!.pairs;

      expect(pairs.length).toBeGreaterThan(0);
      pairs.forEach(pair => {
        expect(pair.answer.role).toBe('assistant');
        expect(pair.answer.content).toBeTruthy();
      });
    });

    it('groups messages into Q&A pairs correctly', () => {
      const result = parser.parse();
      const pairs = result.conversation!.pairs;

      pairs.forEach((pair, index) => {
        expect(pair.index).toBe(index);
        expect(pair.question).toBeDefined();
        expect(pair.answer).toBeDefined();
        expect(pair.selected).toBe(true);
      });
    });

    it('extracts user uploaded images', () => {
      const result = parser.parse();
      const firstPair = result.conversation?.pairs[0];

      expect(firstPair?.question.metadata).toBeDefined();
      expect(firstPair?.question.metadata?.images).toBeDefined();
      expect(firstPair?.question.metadata?.images?.length).toBeGreaterThan(0);

      const image = firstPair?.question.metadata?.images?.[0];
      expect(image?.src).toContain('/api/');
      expect(image?.alt).toBe('sample_sketch_placeholder.png');
    });

    it('extracts web search results', () => {
      const result = parser.parse();
      const firstPair = result.conversation?.pairs[0];

      expect(firstPair?.answer.metadata).toBeDefined();
      expect(firstPair?.answer.metadata?.webSearches).toBeDefined();
      expect(firstPair?.answer.metadata?.webSearches?.length).toBeGreaterThan(0);

      const search = firstPair?.answer.metadata?.webSearches?.[0];
      expect(search?.query).toBe('pixel art character black hair big eyes peachy skin');
      expect(search?.resultCount).toBe(10);
    });

    it('extracts artifacts', () => {
      const result = parser.parse();
      const firstPair = result.conversation?.pairs[0];

      expect(firstPair?.answer.metadata).toBeDefined();
      expect(firstPair?.answer.metadata?.artifacts).toBeDefined();
      expect(firstPair?.answer.metadata?.artifacts?.length).toBeGreaterThan(0);

      const artifact = firstPair?.answer.metadata?.artifacts?.[0];
      expect(artifact?.title).toBe('Pixel Art Character Recreation');
      expect(artifact?.type).toBe('image');
      expect(artifact?.typeLabel).toBe('Imagen');
      expect(artifact?.language).toBe('svg');
    });

    it('includes artifact info in content', () => {
      const result = parser.parse();
      const firstPair = result.conversation?.pairs[0];

      expect(firstPair?.answer.content).toContain('[Imagen: Pixel Art Character Recreation]');
    });

    it('includes web search info in content', () => {
      const result = parser.parse();
      const firstPair = result.conversation?.pairs[0];

      expect(firstPair?.answer.content).toContain('[Web Search: pixel art character black hair big eyes peachy skin]');
    });

    it('preserves HTML content when available', () => {
      const result = parser.parse();
      const pairs = result.conversation?.pairs;

      if (pairs && pairs.length > 0) {
        const firstAnswer = pairs[0]?.answer;
        expect(firstAnswer?.htmlContent).toBeDefined();
        expect(firstAnswer?.htmlContent?.length).toBeGreaterThan(0);
      }
    });

    it('extracts timestamps', () => {
      const result = parser.parse();
      const firstPair = result.conversation?.pairs[0];

      expect(firstPair?.question.timestamp).toBeDefined();
      expect(firstPair?.question.timestamp).toBeInstanceOf(Date);

      const time = firstPair?.question.timestamp;
      expect(time?.getHours()).toBe(18);
      expect(time?.getMinutes()).toBe(40);
    });

    it('handles empty conversation', () => {
      const container = document.querySelector('div.overflow-y-scroll.overflow-x-hidden.pt-6.flex-1');
      if (container) {
        container.innerHTML = '';
      }

      const result = parser.parse();

      expect(result.success).toBe(true);
      expect(result.conversation!.pairs).toHaveLength(0);
    });
  });

  describe('image encoding cache', () => {
    it('draws each image to canvas at most once across repeated parses', () => {
      // content-script.ts creates a fresh parser instance for every
      // export_conversation / print_conversation / get_conversation message,
      // so the cache must survive across ClaudeParser instances, not just
      // across calls on the same instance.
      // Spy on the JSDOM instance's own HTMLCanvasElement (dom.window), not the
      // global one — this test's `document` comes from a standalone `new JSDOM(...)`,
      // a separate realm from vitest's global jsdom environment.
      const canvasElementCtor = dom.window.HTMLCanvasElement as unknown as {
        prototype: HTMLCanvasElement;
      };
      const getContextSpy = vi
        .spyOn(canvasElementCtor.prototype, 'getContext')
        .mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
      const toDataURLSpy = vi
        .spyOn(canvasElementCtor.prototype, 'toDataURL')
        .mockReturnValue('data:image/png;base64,mockdata');

      try {
        const firstResult = new ClaudeParser(document).parse();
        const secondResult = new ClaudeParser(document).parse();

        expect(toDataURLSpy).toHaveBeenCalledTimes(1);

        const firstImage = firstResult.conversation?.pairs[0]?.question.metadata?.images?.[0];
        const secondImage = secondResult.conversation?.pairs[0]?.question.metadata?.images?.[0];
        expect(firstImage?.src).toBe('data:image/png;base64,mockdata');
        expect(secondImage?.src).toBe('data:image/png;base64,mockdata');
      } finally {
        getContextSpy.mockRestore();
        toDataURLSpy.mockRestore();
      }
    });
  });

  describe('getButtonInjectionPoint', () => {
    it('returns a valid HTML element', () => {
      const point = parser.getButtonInjectionPoint();

      expect(point).not.toBeNull();
      expect(point).toBeTruthy();
      expect(point).toHaveProperty('tagName');
    });

    it('returns element in header', () => {
      const point = parser.getButtonInjectionPoint();

      expect(point).not.toBeNull();
      const header = document.querySelector('header[data-testid="page-header"]');
      expect(header?.contains(point!)).toBe(true);
    });
  });
});
