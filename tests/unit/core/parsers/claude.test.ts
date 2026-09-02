import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ClaudeParser } from '../../../../src/core/parsers/claude/parser';
import { CLAUDE_SELECTORS } from '../../../../src/core/parsers/claude/selectors';
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

    // The container selector is a utility-class chain over a layout div, so a
    // spacing tweak on claude.ai retires it without touching a single turn.
    // When that happens the page must still be claimed: a false canParse() is
    // not a degraded export but no export at all -- the popup calls the page
    // unsupported and never consults the (healthy) turn selectors. This is the
    // shape of the outage that prompted lo-2478, one layer up.
    it('still detects a conversation when the container class chain is stale', () => {
      const staleContainer = new JSDOM(
        `<div class="overflow-y-auto overflow-x-hidden pt-8 grow">
           <div data-test-render-count="1">
             <div data-user-message-bubble><p class="whitespace-pre-wrap">Hi</p></div>
           </div>
           <div data-test-render-count="2">
             <div data-is-streaming="false"><div class="standard-markdown"><p>Hello</p></div></div>
           </div>
         </div>`,
        { url: 'https://claude.ai/chat/abc123' }
      );
      const parserOnStale = new ClaudeParser(staleContainer.window.document);

      // None of the utility-class chains match this markup -- `pt-8 grow`
      // replaced `pt-6 flex-1` -- so detection rests on the structural variant,
      // which finds the container by the turn wrappers it holds.
      expect(
        staleContainer.window.document.querySelector(
          'div.overflow-y-auto.overflow-x-hidden.pt-6.flex-1, div.overflow-y-auto.overflow-x-hidden.flex-1'
        )
      ).toBeNull();
      expect(
        staleContainer.window.document.querySelector(CLAUDE_SELECTORS.conversationContainer)
      ).not.toBeNull();
      expect(parserOnStale.canParse()).toBe(true);
    });

    it('still detects a conversation when no container selector matches at all', () => {
      // The turn wrappers are nested one level deeper than the scroll box, so
      // even the structural `:has(> ...)` variant misses. Detection then rests
      // entirely on custom.conversationSignals, which keys off the turns
      // themselves rather than off anything about their container.
      const noContainer = new JSDOM(
        `<section>
           <span>
             <div data-test-render-count="1">
               <div data-user-message-bubble><p class="whitespace-pre-wrap">Hi</p></div>
             </div>
           </span>
         </section>`,
        { url: 'https://claude.ai/chat/abc123' }
      );
      const parserOnNoContainer = new ClaudeParser(noContainer.window.document);

      expect(
        noContainer.window.document.querySelector(CLAUDE_SELECTORS.conversationContainer)
      ).toBeNull();
      expect(parserOnNoContainer.canParse()).toBe(true);
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
      const modelEl = document.querySelector(
        '[data-testid="model-selector-dropdown"] div.whitespace-nowrap'
      );
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
      pairs.forEach((pair) => {
        expect(pair.question.role).toBe('user');
        expect(pair.question.content).toBeTruthy();
      });
    });

    it('identifies assistant messages correctly', () => {
      const result = parser.parse();
      const pairs = result.conversation!.pairs;

      expect(pairs.length).toBeGreaterThan(0);
      pairs.forEach((pair) => {
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

    it('never fabricates a timestamp from the DOM-only HH:MM label (PAR-1)', () => {
      // claude.ai's DOM exposes only a wall-clock HH:MM, never a date.
      // Stamping that onto today's date would fabricate history (D-18), so
      // no per-message timestamp is emitted from DOM parsing at all.
      const result = parser.parse();
      const firstPair = result.conversation?.pairs[0];

      expect(firstPair?.question.timestamp).toBeUndefined();
      expect(firstPair?.answer.timestamp).toBeUndefined();
    });

    it('signals content-shortfall when the answer is a sliver of the turn text (PAR-1)', () => {
      // turnTextLengthsFor was dead code (always -1) before this fix, so
      // content-shortfall never had a chance to fire for any platform.
      const html = `
        <html><body>
          <div class="overflow-y-scroll overflow-x-hidden pt-6 flex-1">
            <div data-test-render-count="1">
              <div data-user-message-bubble="true">
                <div data-testid="user-message"><p class="whitespace-pre-wrap">Summarize it</p></div>
              </div>
            </div>
            <div data-test-render-count="2">
              <div data-is-streaming="false">
                <span class="filler">${'A'.repeat(4000)}</span>
                <div class="standard-markdown">ok</div>
              </div>
            </div>
          </div>
        </body></html>
      `;
      const shortfallDom = new JSDOM(html, { url: 'https://claude.ai/chat/abc123' });
      const result = new ClaudeParser(shortfallDom.window.document).parse();

      expect(result.conversation?.pairs[0]?.answer.content).toBe('ok');
      expect(result.drift?.sanityFindings?.map((f) => f.rule)).toContain('content-shortfall');
    });

    it('handles empty conversation', () => {
      const container = document.querySelector(
        'div.overflow-y-scroll.overflow-x-hidden.pt-6.flex-1'
      );
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
        clonedAssistant.querySelector('p.font-claude-response-body')!.textContent =
          `Turn${n} answer`;
        container.appendChild(clonedUser);
        container.appendChild(clonedAssistant);
      }

      const baseline = new ClaudeParser(document).parse().conversation?.pairs ?? [];
      expect(baseline).toHaveLength(3); // sanity: three clean turns before mutation

      // Gut turn 2's user content entirely (image thumbnail + text), as a
      // redesign that collapsed its wrapper divs plausibly would -- leave
      // turns 1 and 3 untouched.
      const turn2UserBlock = document.querySelectorAll('div[data-test-render-count="2"]')[1]!;
      turn2UserBlock.querySelectorAll('div.relative.group\\/thumbnail').forEach((el) => {
        el.remove();
      });
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
      const container = document.querySelector(
        'div.overflow-y-scroll.overflow-x-hidden.pt-6.flex-1'
      );
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

    it('reads the result count via the declared webSearchResultCount selector, not a stale inline copy (PAR-1)', () => {
      // Before this fix extractWebSearches hardcoded 'p.text-text-500.font-small'
      // inline, a different (narrower) string than the declared
      // custom.webSearchResultCount ('p.relative.bottom-[0.5px].pl-1.text-text-500').
      // Both happen to match the committed fixture today, so drop the
      // `font-small` class -- a plausible redesign -- to tell them apart: only
      // the declared selector survives it.
      const countElement = document.querySelector('p.text-text-500.font-small');
      expect(countElement).not.toBeNull();
      countElement!.classList.remove('font-small');

      const result = parser.parse();
      const search = result.conversation?.pairs[0]?.answer.metadata?.webSearches?.[0];

      expect(search?.resultCount).toBe(10);
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

  // lo-2478: the fixture above is pre-2026 markup. These run against a
  // hand-rebuilt snapshot of claude.ai's CURRENT markup, where four selectors
  // the parser depends on had silently gone dead. Each `it` here is a
  // liveness guard for one of them: if claude.ai moves it again, exactly one
  // of these fails and names what broke, instead of exports quietly going
  // empty.
  describe('current claude.ai markup (2026)', () => {
    let liveDocument: Document;
    let liveParser: ClaudeParser;

    beforeEach(() => {
      const html = readFileSync(
        join(__dirname, '../../../fixtures/dom-snapshots/claude/artifact-panel.html'),
        'utf-8'
      );
      liveDocument = new JSDOM(html, { url: 'https://claude.ai/chat/abc123' }).window.document;
      liveParser = new ClaudeParser(liveDocument);
    });

    it('recognizes the conversation container (overflow-y-auto, not -scroll)', () => {
      expect(liveParser.canParse()).toBe(true);
    });

    it('pairs the turn via data-user-message-bubble (div.mb-1.mt-6.group is gone)', () => {
      const pairs = liveParser.parse().conversation?.pairs ?? [];

      expect(pairs).toHaveLength(1);
      expect(pairs[0]?.question.content).toContain('Draft me a tide table helper');
      expect(pairs[0]?.answer.content).toContain('Both pieces are below');
    });

    it('finds artifact blocks that no longer sit inside div.pt-3.pb-3', () => {
      const artifacts = liveParser.parse().conversation?.pairs[0]?.answer.metadata?.artifacts ?? [];

      expect(artifacts.map((a) => a.title)).toEqual(['Tide table helper', 'Reading a tide table']);
    });

    it('types artifacts from the format token, not the translated label', () => {
      const artifacts = liveParser.parse().conversation?.pairs[0]?.answer.metadata?.artifacts ?? [];

      expect(artifacts[0]).toMatchObject({ type: 'react', language: 'react' });
      expect(artifacts[1]).toMatchObject({ type: 'document', language: 'markdown' });
    });

    it('types a Spanish-UI label the same way an English one is typed', () => {
      // "Documento · MD" -- only the kind is translated; the format token is
      // not, which is the whole point of reading it instead of the label.
      liveDocument
        .querySelectorAll('div.text-xs.line-clamp-1.text-text-400')
        .forEach((el) => (el.innerHTML = 'Documento<span class="opacity-50"> · </span>MD&nbsp;'));

      const artifacts = new ClaudeParser(liveDocument).parse().conversation?.pairs[0]?.answer
        .metadata?.artifacts;

      expect(artifacts?.every((a) => a.type === 'document')).toBe(true);
    });

    it('reads the open artifact body out of the side panel', () => {
      const artifacts = liveParser.parse().conversation?.pairs[0]?.answer.metadata?.artifacts ?? [];

      // The panel renders outside every turn container, so it is only reached
      // by a document-level lookup -- the failure shape that silently dropped
      // Gemini's Deep Research report (PR #55).
      const doc = artifacts.find((a) => a.title === 'Reading a tide table');
      expect(doc?.content).toContain('Reading a tide table');
      expect(doc?.content).toContain('Highs and lows');
      expect(doc?.content).toContain('more than one block-level child');
      // ...and keeps the blocks apart rather than running them together.
      expect(doc?.content).toContain('\n\n');
    });

    it('leaves the un-opened artifact content-less rather than mis-attaching the panel', () => {
      const artifacts = liveParser.parse().conversation?.pairs[0]?.answer.metadata?.artifacts ?? [];

      expect(artifacts.find((a) => a.title === 'Tide table helper')?.content).toBeUndefined();
    });

    it('drops the panel body when the viewer is a cross-origin preview iframe', () => {
      // A code artifact previews inside a sandboxed iframe whose source the
      // content script cannot read; the artifact must still survive as a
      // reference, not vanish.
      liveDocument.querySelector('[data-skill-file-viewer] div.standard-markdown')?.remove();

      const artifacts = new ClaudeParser(liveDocument).parse().conversation?.pairs[0]?.answer
        .metadata?.artifacts;

      expect(artifacts).toHaveLength(2);
      expect(artifacts?.every((a) => a.content === undefined)).toBe(true);
    });

    it('names every artifact in the answer text so no format can drop it', () => {
      const answer = liveParser.parse().conversation?.pairs[0]?.answer.content ?? '';

      expect(answer).toContain('[Code · JSX: Tide table helper]');
      expect(answer).toContain('[Document · MD: Reading a tide table]');
    });
  });

  describe('extraction survives losing the turn wrapper', () => {
    // canParse() claims the page off any of seven signals, but the walk used to
    // depend on `data-test-render-count` alone -- a render-debug attribute a
    // build can strip. Detection succeeding while extraction found nothing
    // produced an empty export on a page the popup reported as supported.
    const load = (mutate: (doc: Document) => void): Document => {
      const html = readFileSync(
        join(__dirname, '../../../fixtures/dom-snapshots/claude/artifact-panel.html'),
        'utf-8'
      );
      const doc = new JSDOM(html, { url: 'https://claude.ai/chat/abc123' }).window.document;
      mutate(doc);
      return doc;
    };

    const stripRenderCount = (doc: Document): void => {
      doc
        .querySelectorAll('[data-test-render-count]')
        .forEach((el) => el.removeAttribute('data-test-render-count'));
    };

    it('still pairs the turn when data-test-render-count is gone', () => {
      const doc = load(stripRenderCount);

      expect(doc.querySelectorAll('[data-test-render-count]')).toHaveLength(0);

      const pairs = new ClaudeParser(doc).parse().conversation?.pairs ?? [];
      expect(pairs).toHaveLength(1);
      expect(pairs[0]?.question.content).toContain('Draft me a tide table helper');
      expect(pairs[0]?.answer.content).toContain('Both pieces are below');
    });

    it('still recognizes the assistant turn when data-is-streaming is gone too', () => {
      const doc = load((d) => {
        stripRenderCount(d);
        d.querySelectorAll('[data-is-streaming]').forEach((el) =>
          el.removeAttribute('data-is-streaming')
        );
      });

      const pairs = new ClaudeParser(doc).parse().conversation?.pairs ?? [];
      expect(pairs).toHaveLength(1);
      expect(pairs[0]?.answer.content).toContain('Both pieces are below');
    });

    it('counts each turn once, so a response nested in a bubble is not a second turn', () => {
      const doc = load(stripRenderCount);

      // Two turns (one user, one assistant) -- not four, which is what an
      // unfiltered union of the role markers would report and what would make
      // every answer pair with the wrong question.
      const pairs = new ClaudeParser(doc).parse().conversation?.pairs ?? [];
      expect(pairs.map((pair) => pair.answer.content !== '')).toEqual([true]);
    });

    it('prefers the turn wrapper when it is present', () => {
      const html = readFileSync(
        join(__dirname, '../../../fixtures/dom-snapshots/claude/artifact-panel.html'),
        'utf-8'
      );
      const doc = new JSDOM(html, { url: 'https://claude.ai/chat/abc123' }).window.document;

      // Same result either way: the fallback is a safety net, not a second
      // parsing mode whose output has to be reconciled with the first.
      const withWrapper = new ClaudeParser(doc).parse().conversation?.pairs ?? [];
      const withoutWrapper =
        new ClaudeParser(load(stripRenderCount)).parse().conversation?.pairs ?? [];

      expect(withoutWrapper.map((p) => p.question.content)).toEqual(
        withWrapper.map((p) => p.question.content)
      );
      expect(withoutWrapper.map((p) => p.answer.content)).toEqual(
        withWrapper.map((p) => p.answer.content)
      );
    });
  });
});
