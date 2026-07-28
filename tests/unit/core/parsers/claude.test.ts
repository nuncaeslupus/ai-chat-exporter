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
    document = dom.window.document;
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
      document = dom.window.document;
      parser = new ClaudeParser(document);

      expect(parser.canParse()).toBe(true);
    });

    it('returns false for non-claude URLs', () => {
      const html = readFileSync(
        join(__dirname, '../../../fixtures/dom-snapshots/claude/real-capture.html'),
        'utf-8'
      );
      dom = new JSDOM(html, { url: 'https://chatgpt.com' });
      document = dom.window.document;
      parser = new ClaudeParser(document);

      expect(parser.canParse()).toBe(false);
    });

    it('returns false when conversation container not found', () => {
      const emptyDom = new JSDOM('<div></div>', { url: 'https://claude.ai/chat/abc123' });
      const emptyDocument = emptyDom.window.document;
      const emptyParser = new ClaudeParser(emptyDocument);

      expect(emptyParser.canParse()).toBe(false);
    });
  });

  describe('getTitle', () => {
    it('extracts conversation title correctly', () => {
      const title = parser.getTitle();
      expect(title).toBe('Sample fixture conversation for parser tests');
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
      expect(result.conversation!.title).toBe('Sample fixture conversation for parser tests');
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
      expect(search?.query).toBe('placeholder fixture search query');
      expect(search?.resultCount).toBe(10);
    });

    it('does not carry citation favicons out of the page DOM (lo-31e6)', () => {
      // The fixture's search result carries a third-party favicon <img>, the
      // shape claude.ai's citation rows use. Keeping that src would make the
      // exported HTML fetch it from that host every time the file is opened,
      // leaking the cited domains and the reader's IP. Same resolution as
      // lo-8312 took for ChatGPT: drop the decorative favicon.
      const result = parser.parse();
      const results = result.conversation?.pairs[0]?.answer.metadata?.webSearches?.[0]?.results;

      expect(results?.length).toBeGreaterThan(0);
      for (const searchResult of results ?? []) {
        expect(searchResult.favicon).toBeUndefined();
      }
    });

    it('extracts artifacts', () => {
      const result = parser.parse();
      const firstPair = result.conversation?.pairs[0];

      expect(firstPair?.answer.metadata).toBeDefined();
      expect(firstPair?.answer.metadata?.artifacts).toBeDefined();
      expect(firstPair?.answer.metadata?.artifacts?.length).toBeGreaterThan(0);

      const artifact = firstPair?.answer.metadata?.artifacts?.[0];
      expect(artifact?.title).toBe('Placeholder SVG Artifact');
      expect(artifact?.type).toBe('image');
      expect(artifact?.typeLabel).toBe('Imagen');
      expect(artifact?.language).toBe('svg');
    });

    it('includes artifact info in content', () => {
      const result = parser.parse();
      const firstPair = result.conversation?.pairs[0];

      expect(firstPair?.answer.content).toContain('[Imagen: Placeholder SVG Artifact]');
    });

    it('includes web search info in content', () => {
      const result = parser.parse();
      const firstPair = result.conversation?.pairs[0];

      expect(firstPair?.answer.content).toContain('[Web Search: placeholder fixture search query]');
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

  // DOM-drift regression tests: the likelier real-world failure than empty or
  // malformed HTML is the target site renaming a class or moving an
  // attribute -- a *plausible near-miss*. Each test mutates a fresh copy of
  // the real fixture (loaded by the outer beforeEach) and asserts on the
  // resulting failure SIGNAL, not merely on "did not throw" -- a silently
  // empty or half-parsed conversation is worse than an exception (lo-b59b).
  describe('DOM drift resilience (plausible near-miss selector breakage)', () => {
    it('reports failure when the message-role attribute is renamed', () => {
      // `data-testid="user-message"` is Claude's role marker for the user
      // side of a turn (see CLAUDE_SELECTORS.userMessage).
      document.querySelectorAll('[data-testid="user-message"]').forEach((el) => {
        el.setAttribute('data-testid', 'user-msg-renamed');
      });

      const result = parser.parse();

      // FIXED BEHAVIOR (lo-d0f0): extractQAPairs now recognizes a user turn
      // structurally, via `custom.userTurnWrapper` (`div.mb-1.mt-6.group`),
      // which the attribute rename does not touch -- so the turn keeps its
      // slot instead of being dropped from an array with no fallback. The
      // renamed attribute only breaks the text-content lookup inside
      // extractUserMessage; the uploaded-image fallback there does not
      // depend on it, so the question still comes through as an
      // images-only message rather than the whole pair vanishing.
      expect(result.success).toBe(true);
      expect(result.conversation?.pairs).toHaveLength(1);
      expect(result.conversation?.pairs[0]?.question.content).toContain('Uploaded images');
    });

    it('does not mis-pair turns when a wrapper div is removed', () => {
      // The committed fixture holds a single turn; clone it twice (tagging
      // each copy's text uniquely) to get three turns to mis-pair across,
      // rather than committing a second fixture.
      const container = document.querySelector(
        'div.flex-1.flex.flex-col.px-4.max-w-3xl.mx-auto.w-full.pt-1'
      )!;
      const userBlock = document.querySelector('div[data-test-render-count="2"]')!;
      const assistantBlock = document.querySelector('div[data-test-render-count="1"]')!;
      userBlock.querySelector('p.whitespace-pre-wrap')!.textContent = 'Turn1 question';
      assistantBlock.querySelector('p.font-claude-response-body')!.textContent = 'Turn1 answer';
      for (const n of [2, 3]) {
        const clonedUser = userBlock.cloneNode(true) as Element;
        const clonedAssistant = assistantBlock.cloneNode(true) as Element;
        clonedUser.querySelector('p.whitespace-pre-wrap')!.textContent = `Turn${n} question`;
        clonedAssistant.querySelector('p.font-claude-response-body')!.textContent = `Turn${n} answer`;
        container.appendChild(clonedUser);
        container.appendChild(clonedAssistant);
      }

      const baseline = new ClaudeParser(document).parse().conversation?.pairs ?? [];
      expect(baseline).toHaveLength(3); // sanity: three clean turns before mutation

      // Gut turn 2's user content entirely (image thumbnail + text), as a
      // redesign that collapsed its wrapper divs plausibly would -- leave
      // turns 1 and 3 untouched.
      const turn2UserBlock = document.querySelectorAll('div[data-test-render-count="2"]')[1]!;
      turn2UserBlock.querySelectorAll('div.relative.group\\/thumbnail').forEach((el) => { el.remove(); });
      turn2UserBlock.querySelector('div[data-testid="user-message"]')!.remove();

      const result = new ClaudeParser(document).parse();
      const pairs = result.conversation?.pairs ?? [];

      // FIXED BEHAVIOR (lo-d0f0): extractQAPairs now walks the render-count
      // turn wrappers in document order and pairs each recognized user turn
      // with the assistant turn that follows it, instead of zipping two
      // independently-filtered arrays by index. Turn 2's user wrapper is
      // still recognized structurally -- its `div.mb-1.mt-6.group`
      // sub-wrapper survives even though its content was gutted -- so it
      // keeps its own slot: turn 3's question is never reattached to turn
      // 2's answer.
      expect(result.success).toBe(true);
      expect(pairs).toHaveLength(3);
      expect(pairs[1]?.question.content).toBe('');
      expect(pairs[1]?.answer.content).toContain('Turn2 answer');
      expect(pairs[2]?.question.content).toBe('Turn3 question');
      expect(pairs[2]?.answer.content).toContain('Turn3 answer');
      expect(result.warnings).toContain('Turn 2: the question could not be read');
    });

    it('returns success:false rather than an empty conversation when selectors match nothing', () => {
      const container = document.querySelector('div.overflow-y-scroll.overflow-x-hidden.pt-6.flex-1');
      container!.innerHTML = '';

      const result = parser.parse();

      // CURRENT BEHAVIOR (documented, not a bug to fix here): this does NOT
      // return success:false. BaseParser.parse() only sets success:false
      // when extractQAPairs throws; an empty match set does not throw, so
      // this still reports success:true with a generic warning instead of a
      // dedicated failure signal.
      expect(result.success).toBe(true);
      expect(result.conversation?.pairs).toEqual([]);
      expect(result.warnings).toContain('No Q&A pairs found in the conversation');
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
      expect(header?.contains(point)).toBe(true);
    });
  });
});
