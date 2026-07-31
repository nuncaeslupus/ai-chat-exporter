/**
 * ChatGPT Parser Tests
 * TDD: Tests written before implementation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  CHATGPT_SELECTORS,
  EMBEDDED_FRAME_REPORT_ATTR,
  isChatGPTUrl,
} from '../../../../src/core/parsers/chatgpt/selectors';
import { ChatGPTParser } from '../../../../src/core/parsers/chatgpt/parser';
import { HtmlContentParser } from '../../../../src/core/services/html-content-parser';

describe('ChatGPT Selectors', () => {
  describe('isChatGPTUrl', () => {
    it('returns true for chat.openai.com', () => {
      expect(isChatGPTUrl('https://chat.openai.com')).toBe(true);
      expect(isChatGPTUrl('https://chat.openai.com/c/abc123')).toBe(true);
      expect(isChatGPTUrl('https://www.chat.openai.com')).toBe(true);
    });

    it('returns true for chatgpt.com', () => {
      expect(isChatGPTUrl('https://chatgpt.com')).toBe(true);
      expect(isChatGPTUrl('https://chatgpt.com/c/abc123')).toBe(true);
      expect(isChatGPTUrl('https://www.chatgpt.com')).toBe(true);
    });

    it('returns false for non-ChatGPT URLs', () => {
      expect(isChatGPTUrl('https://claude.ai')).toBe(false);
      expect(isChatGPTUrl('https://gemini.google.com')).toBe(false);
      expect(isChatGPTUrl('https://example.com')).toBe(false);
      expect(isChatGPTUrl('https://openai.com')).toBe(false); // Not chat.openai.com
    });
  });

  describe('CHATGPT_SELECTORS', () => {
    it('has all required selector properties', () => {
      expect(CHATGPT_SELECTORS.conversationContainer).toBeDefined();
      expect(CHATGPT_SELECTORS.messageElement).toBeDefined();
      expect(CHATGPT_SELECTORS.userMessage).toBeDefined();
      expect(CHATGPT_SELECTORS.assistantMessage).toBeDefined();
      expect(CHATGPT_SELECTORS.messageContent).toBeDefined();
    });

    it('has optional selectors', () => {
      expect(CHATGPT_SELECTORS.conversationTitle).toBeDefined();
      expect(CHATGPT_SELECTORS.modelIndicator).toBeDefined();
    });

    it('has custom ChatGPT-specific selectors', () => {
      expect(CHATGPT_SELECTORS.custom).toBeDefined();
      expect(CHATGPT_SELECTORS.custom.conversationTurn).toBeDefined();
      expect(CHATGPT_SELECTORS.custom.userMessageContent).toBeDefined();
      expect(CHATGPT_SELECTORS.custom.assistantMessageContent).toBeDefined();
    });

    it('has code artifact selectors', () => {
      expect(CHATGPT_SELECTORS.custom.codeArtifactContainer).toBeDefined();
      expect(CHATGPT_SELECTORS.custom.codeArtifactLanguage).toBeDefined();
      expect(CHATGPT_SELECTORS.custom.codeArtifactContent).toBeDefined();
    });

    it('has web citation selectors', () => {
      expect(CHATGPT_SELECTORS.custom.citationPill).toBeDefined();
      expect(CHATGPT_SELECTORS.custom.citationLink).toBeDefined();
    });
  });

  // Selector liveness. Guards the failure mode that silently zeroed this parser
  // once already: ChatGPT renamed the turn wrapper, every selector kept its
  // shape, and all 61 tests stayed green because none of them asserted that a
  // selector still matches anything (docs/dev/parser-gotchas.md #1).
  describe('selector liveness against the committed fixtures', () => {
    const FIXTURE_DIR = join(__dirname, '../../../fixtures/dom-snapshots/chatgpt');

    // Attribute *names*, not CSS selectors -- they are read with getAttribute().
    const isAttrKey = (key: string): boolean => key.endsWith('Attr');

    // Selectors whose markup no committed fixture contains, each for a reason
    // that is a property of the fixtures, not of the selector. Asserted to match
    // ZERO below, so the list cannot silently grow into an excuse list: add a
    // fixture covering one and this test tells you to drop it from here.
    const NO_FIXTURE_COVERAGE: Record<string, string> = {
      canvasContainer: 'no fixture contains a canvas/textdoc turn',
      generatedImageContainer: 'no fixture contains an image-generation turn',
    };

    const documents = readdirSync(FIXTURE_DIR)
      .filter((f) => f.endsWith('.html'))
      .map((f) => new JSDOM(readFileSync(join(FIXTURE_DIR, f), 'utf-8')).window.document);

    const entries: [string, string][] = Object.entries({
      conversationContainer: CHATGPT_SELECTORS.conversationContainer,
      messageElement: CHATGPT_SELECTORS.messageElement,
      userMessage: CHATGPT_SELECTORS.userMessage,
      assistantMessage: CHATGPT_SELECTORS.assistantMessage,
      messageContent: CHATGPT_SELECTORS.messageContent,
      conversationTitle: CHATGPT_SELECTORS.conversationTitle,
      modelIndicator: CHATGPT_SELECTORS.modelIndicator,
      ...CHATGPT_SELECTORS.custom,
    }).filter((entry): entry is [string, string] => Boolean(entry[1]) && !isAttrKey(entry[0]));

    const matchCount = (selector: string): number =>
      documents.reduce((total, doc) => total + doc.querySelectorAll(selector).length, 0);

    it.each(entries.filter(([key]) => !(key in NO_FIXTURE_COVERAGE)))(
      '%s matches at least one node in the fixtures',
      (_key, selector) => {
        expect(matchCount(selector)).toBeGreaterThan(0);
      }
    );

    it.each(entries.filter(([key]) => key in NO_FIXTURE_COVERAGE))(
      '%s has no fixture coverage yet, as documented',
      (key, selector) => {
        expect(matchCount(selector), `${key}: ${NO_FIXTURE_COVERAGE[key] ?? ''}`).toBe(0);
      }
    );

    it('covers every parser selector', () => {
      // The parser reads selectors only from CHATGPT_SELECTORS, so this list
      // being complete is what makes the guard above meaningful.
      const parserSource = readFileSync(
        join(__dirname, '../../../../src/core/parsers/chatgpt/parser.ts'),
        'utf-8'
      );
      // No querySelector(All) call in the parser may take a quoted selector
      // literal -- that is the hardcoded-selector defect this guard cannot see
      // past. Bare tag names ('img', 'button') are plain HTML, not platform
      // markup, so the pattern only fires on . # or [ .
      expect(parserSource).not.toMatch(/querySelector(All)?\(\s*['"][^'"]*[.#[][^'"]*['"]/);
    });
  });
});

describe('ChatGPT Parser', () => {
  let dom: JSDOM;
  let document: Document;

  // Load the real DOM fixture
  beforeEach(() => {
    const fixturePath = join(
      __dirname,
      '../../../fixtures/dom-snapshots/chatgpt/real-capture.html'
    );
    const html = readFileSync(fixturePath, 'utf-8');
    dom = new JSDOM(html, { url: 'https://chatgpt.com/c/test-conversation' });
    document = dom.window.document;
  });

  describe('DOM fixture validation', () => {
    it('loads the fixture successfully', () => {
      expect(document).toBeDefined();
      expect(document.body).toBeDefined();
    });

    it('contains expected ChatGPT structure', () => {
      const main = document.querySelector('main');
      expect(main).not.toBeNull();
    });

    it('contains message elements with author roles', () => {
      const messages = document.querySelectorAll('[data-message-author-role]');
      expect(messages.length).toBeGreaterThan(0);
    });

    it('contains user messages', () => {
      const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
      expect(userMessages.length).toBeGreaterThan(0);
    });

    it('contains assistant messages', () => {
      const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
      expect(assistantMessages.length).toBeGreaterThan(0);
    });
  });

  describe('selector matching on real DOM', () => {
    it('finds conversation container', () => {
      const container = document.querySelector(CHATGPT_SELECTORS.conversationContainer);
      expect(container).not.toBeNull();
    });

    it('finds message elements', () => {
      const messages = document.querySelectorAll(CHATGPT_SELECTORS.messageElement);
      expect(messages.length).toBeGreaterThan(0);
    });

    it('finds user messages', () => {
      const userMessages = document.querySelectorAll(CHATGPT_SELECTORS.userMessage);
      expect(userMessages.length).toBeGreaterThan(0);
    });

    it('finds assistant messages', () => {
      const assistantMessages = document.querySelectorAll(CHATGPT_SELECTORS.assistantMessage);
      expect(assistantMessages.length).toBeGreaterThan(0);
    });

    it('finds model indicator on assistant messages', () => {
      const modelIndicator = document.querySelector(CHATGPT_SELECTORS.modelIndicator);
      expect(modelIndicator).not.toBeNull();
      expect(modelIndicator?.getAttribute('data-message-model-slug')).toBeDefined();
    });

    it('finds content within user messages', () => {
      const userContent = document.querySelector(CHATGPT_SELECTORS.custom.userMessageContent);
      expect(userContent).not.toBeNull();
      expect(userContent?.textContent?.trim().length).toBeGreaterThan(0);
    });

    it('finds content within assistant messages', () => {
      const assistantContent = document.querySelector(
        CHATGPT_SELECTORS.custom.assistantMessageContent
      );
      expect(assistantContent).not.toBeNull();
    });
  });
});

describe('ChatGPTParser implementation', () => {
  let parser: ChatGPTParser;
  let dom: JSDOM;
  let document: Document;

  beforeEach(() => {
    const fixturePath = join(
      __dirname,
      '../../../fixtures/dom-snapshots/chatgpt/real-capture.html'
    );
    const html = readFileSync(fixturePath, 'utf-8');
    dom = new JSDOM(html, { url: 'https://chatgpt.com/c/test-conversation' });
    document = dom.window.document;
    parser = new ChatGPTParser(document);
  });

  describe('canParse()', () => {
    it('returns true for ChatGPT URLs', () => {
      expect(parser.canParse()).toBe(true);
    });

    it('returns false for non-ChatGPT URLs', () => {
      const otherDom = new JSDOM('<html></html>', { url: 'https://claude.ai' });
      const otherParser = new ChatGPTParser(otherDom.window.document);
      expect(otherParser.canParse()).toBe(false);
    });
  });

  describe('parse()', () => {
    it('returns success with valid conversation', () => {
      const result = parser.parse();
      expect(result.success).toBe(true);
      expect(result.conversation).toBeDefined();
    });

    it('extracts platform as chatgpt', () => {
      const result = parser.parse();
      expect(result.conversation?.platform).toBe('chatgpt');
    });

    it('extracts messages into Q&A pairs', () => {
      const result = parser.parse();
      expect(result.conversation?.pairs.length).toBeGreaterThan(0);
    });

    it('pairs have user question and assistant answer', () => {
      const result = parser.parse();
      const pair = result.conversation?.pairs[0];
      expect(pair?.question.role).toBe('user');
      expect(pair?.answer.role).toBe('assistant');
    });

    it('extracts message content correctly', () => {
      const result = parser.parse();
      const pair = result.conversation?.pairs[0];
      expect(pair?.question.content).toBe(
        'Yes You can point the TESSERA command line Client At a verdant gateway AS long?'
      );
      const answer = pair?.answer.content ?? '';
      // Anchors at the head, middle and tail of the fixture answer, so a
      // truncated or garbled extraction fails instead of passing on length > 0.
      expect(answer).toContain(
        'As, the endpoint speaks the Same REQUEST shape the client Already Knows how to SEND. The gateway:'
      );
      expect(answer).toContain(
        'bashadapter --endpoint https://example.org/guides/verdant-gateway --runtime HANDLER'
      );
      expect(answer).toMatch(/One KEEPS a Plain\?$/);
    });

    it('preserves HTML content when configured', () => {
      const result = parser.parse({ preserveHtml: true });
      const pair = result.conversation?.pairs[0];
      expect(pair?.answer.htmlContent).toBeDefined();
    });

    it('sets selected to true by default for all pairs', () => {
      const result = parser.parse();
      result.conversation?.pairs.forEach((pair) => {
        expect(pair.selected).toBe(true);
      });
    });

    it('generates unique IDs for messages and pairs', () => {
      const result = parser.parse();
      const ids = new Set<string>();
      result.conversation?.pairs.forEach((pair) => {
        ids.add(pair.id);
        ids.add(pair.question.id);
        ids.add(pair.answer.id);
      });
      expect(ids.size).toBe(result.conversation!.pairs.length * 3);
    });

    it('sets correct index for each pair', () => {
      const result = parser.parse();
      result.conversation?.pairs.forEach((pair, index) => {
        expect(pair.index).toBe(index);
      });
    });
  });

  describe('getTitle()', () => {
    it('extracts conversation title or returns default', () => {
      const title = parser.getTitle();
      expect(title).toBeDefined();
      expect(title.length).toBeGreaterThan(0);
    });

    it('returns fallback title when not found', () => {
      const emptyDom = new JSDOM('<html><body></body></html>', { url: 'https://chatgpt.com' });
      const emptyParser = new ChatGPTParser(emptyDom.window.document);
      const title = emptyParser.getTitle();
      expect(title).toBe('ChatGPT Conversation');
    });
  });

  describe('getModel()', () => {
    it('extracts model name from assistant message', () => {
      const model = parser.getModel();
      expect(model).toBeDefined();
      expect(model).toMatch(/gpt/i);
    });

    it('returns null when model not found', () => {
      const noModelHtml =
        '<html><body><main><div data-message-author-role="assistant"></div></main></body></html>';
      const noModelDom = new JSDOM(noModelHtml, { url: 'https://chatgpt.com' });
      const noModelParser = new ChatGPTParser(noModelDom.window.document);
      expect(noModelParser.getModel()).toBeNull();
    });
  });

  describe('getButtonInjectionPoint()', () => {
    it('returns a valid HTML element or null', () => {
      const element = parser.getButtonInjectionPoint();
      // May be null if the injection point selector doesn't match the fixture
      if (element !== null) {
        expect(element).toBeInstanceOf(dom.window.HTMLElement);
      }
    });
  });

  describe('getTheme()', () => {
    it('returns chatgpt theme name', () => {
      expect(parser.getTheme()).toBe('chatgpt');
    });
  });

  describe('edge cases', () => {
    it('handles empty conversation gracefully', () => {
      const emptyHtml = '<html><body><main></main></body></html>';
      const emptyDom = new JSDOM(emptyHtml, { url: 'https://chatgpt.com' });
      const emptyParser = new ChatGPTParser(emptyDom.window.document);
      const result = emptyParser.parse();
      expect(result.success).toBe(true);
      expect(result.conversation?.pairs).toEqual([]);
    });

    it('handles malformed HTML without crashing', () => {
      const malformedHtml = '<html><body><main><div data-message-author-role="user">Unclosed';
      const malformedDom = new JSDOM(malformedHtml, { url: 'https://chatgpt.com' });
      const malformedParser = new ChatGPTParser(malformedDom.window.document);
      expect(() => malformedParser.parse()).not.toThrow();
    });

    it('handles missing assistant response (orphan user message)', () => {
      const orphanHtml = `
        <html><body><main>
          <div data-message-author-role="user">
            <div class="whitespace-pre-wrap">User question without answer</div>
          </div>
        </main></body></html>
      `;
      const orphanDom = new JSDOM(orphanHtml, { url: 'https://chatgpt.com' });
      const orphanParser = new ChatGPTParser(orphanDom.window.document);
      const result = orphanParser.parse();
      // Result should skip the orphan (no pairs since no matching assistant)
      expect(result.success).toBe(true);
      expect(result.conversation?.pairs.length).toBe(0);
    });

    it('keeps an image-only user turn so later Q&A pairs stay aligned', () => {
      // U1(text)/A1, U2(image only, no text)/A2, U3(text)/A3
      const html = `
        <html><body><main>
          <article data-turn="user">
            <div data-message-author-role="user">
              <div class="user-message-bubble-color"><div class="whitespace-pre-wrap">First question</div></div>
            </div>
          </article>
          <article data-turn="assistant">
            <div data-message-author-role="assistant">
              <div class="markdown prose">First answer</div>
            </div>
          </article>
          <article data-turn="user">
            <div data-message-author-role="user">
              <img src="https://example.com/upload.png" alt="photo.png" width="100" height="100" />
            </div>
          </article>
          <article data-turn="assistant">
            <div data-message-author-role="assistant">
              <div class="markdown prose">Second answer</div>
            </div>
          </article>
          <article data-turn="user">
            <div data-message-author-role="user">
              <div class="user-message-bubble-color"><div class="whitespace-pre-wrap">Third question</div></div>
            </div>
          </article>
          <article data-turn="assistant">
            <div data-message-author-role="assistant">
              <div class="markdown prose">Third answer</div>
            </div>
          </article>
        </main></body></html>
      `;
      const imgDom = new JSDOM(html, { url: 'https://chatgpt.com' });
      const imgParser = new ChatGPTParser(imgDom.window.document);
      const result = imgParser.parse();

      expect(result.success).toBe(true);
      const pairs = result.conversation?.pairs ?? [];
      expect(pairs.length).toBe(3);
      expect(pairs[0]?.question.content).toBe('First question');
      expect(pairs[0]?.answer.content).toBe('First answer');
      expect(pairs[1]?.question.content).toContain('Uploaded images');
      expect(pairs[1]?.answer.content).toBe('Second answer');
      expect(pairs[2]?.question.content).toBe('Third question');
      expect(pairs[2]?.answer.content).toBe('Third answer');
    });

    it('signals turns-dropped when a leading orphan assistant turn is silently skipped (PAR-1)', () => {
      // A custom-GPT greeting opens the conversation with an assistant turn
      // before any question -- extractQAPairs has nothing to pair it with and
      // drops it. Before the turns-dropped rule this produced success:true,
      // warnings:undefined, drift:undefined with the greeting gone and no
      // signal anywhere.
      const html = `
        <html><body><main>
          <article data-testid="conversation-turn-1" data-turn="assistant">
            <div data-message-author-role="assistant">
              <div class="markdown prose">GREETING FROM A CUSTOM GPT</div>
            </div>
          </article>
          <article data-testid="conversation-turn-2" data-turn="user">
            <div data-message-author-role="user">
              <div class="user-message-bubble-color"><div class="whitespace-pre-wrap">question two</div></div>
            </div>
          </article>
          <article data-testid="conversation-turn-3" data-turn="assistant">
            <div data-message-author-role="assistant">
              <div class="markdown prose">answer two</div>
            </div>
          </article>
        </main></body></html>
      `;
      const dom = new JSDOM(html, { url: 'https://chatgpt.com' });
      const result = new ChatGPTParser(dom.window.document).parse();

      const pairs = result.conversation?.pairs ?? [];
      expect(pairs).toHaveLength(1);
      expect(pairs[0]?.question.content).toBe('question two');
      expect(pairs[0]?.answer.content).toBe('answer two');
      expect(result.drift?.sanityFindings?.map((f) => f.rule)).toContain('turns-dropped');
    });

    it('signals content-shortfall when the answer is a sliver of the turn text (PAR-1)', () => {
      // Reference case: a large sr-only block sits alongside a two-character
      // visible answer inside the same turn. turnTextLengthsFor was dead code
      // (always -1) before this fix, so content-shortfall never had a chance
      // to fire for any platform.
      const html = `
        <html><body><main>
          <article data-turn="user">
            <div data-message-author-role="user">
              <div class="user-message-bubble-color"><div class="whitespace-pre-wrap">Summarize it</div></div>
            </div>
          </article>
          <article data-turn="assistant">
            <div data-message-author-role="assistant">
              <span class="sr-only">${'A'.repeat(4000)}</span>
              <div class="markdown prose">ok</div>
            </div>
          </article>
        </main></body></html>
      `;
      const dom = new JSDOM(html, { url: 'https://chatgpt.com' });
      const result = new ChatGPTParser(dom.window.document).parse();

      expect(result.conversation?.pairs[0]?.answer.content).toBe('ok');
      expect(result.drift?.sanityFindings?.map((f) => f.rule)).toContain('content-shortfall');
    });
  });

  // DOM-drift regression tests: the edge cases above cover empty and
  // malformed HTML, but the likelier real-world failure is the target site
  // renaming a class or moving an attribute -- a *plausible near-miss*, not
  // garbage HTML. Each test here mutates a fresh copy of the real fixture
  // (loaded by the outer beforeEach) the way a redesign plausibly would, and
  // asserts on the resulting failure SIGNAL rather than merely on "did not
  // throw" -- a silently empty or half-parsed conversation is worse than an
  // exception (lo-b59b).
  describe('DOM drift resilience (plausible near-miss selector breakage)', () => {
    function freshParser(): ChatGPTParser {
      const html = readFileSync(
        join(__dirname, '../../../fixtures/dom-snapshots/chatgpt/real-capture.html'),
        'utf-8'
      );
      const freshDom = new JSDOM(html, { url: 'https://chatgpt.com/c/test-conversation' });
      return new ChatGPTParser(freshDom.window.document);
    }

    it('reports failure when the message-role attribute is renamed', () => {
      document.querySelectorAll('[data-message-author-role]').forEach((el) => {
        const role = el.getAttribute('data-message-author-role');
        el.removeAttribute('data-message-author-role');
        el.setAttribute('data-msg-role', role ?? '');
      });

      const baseline = freshParser().parse().conversation?.pairs.length ?? 0;
      const result = parser.parse();

      // CURRENT BEHAVIOR (documented, not a bug to fix here): this does NOT
      // fail. extractUserMessages/extractAssistantMessages fall back to the
      // turn wrapper (`[data-turn="user"/"assistant"]`) and class-based
      // content selectors whenever `userMessage`/`assistantMessage` doesn't
      // match, so renaming just the role attribute is fully absorbed and the
      // conversation still comes out complete. There is no dedicated
      // "role attribute missing" failure signal -- there is simply nothing
      // here that needs one.
      expect(result.success).toBe(true);
      expect(result.conversation?.pairs.length).toBe(baseline);
      expect(baseline).toBeGreaterThan(0);
    });

    it('does not mis-pair turns when a wrapper div is removed', () => {
      const baseline = freshParser().parse().conversation?.pairs ?? [];

      // Gut one middle user turn's content entirely -- as a redesign that
      // collapsed its inner wrapper divs plausibly would -- and leave every
      // other turn's markup untouched.
      const turn = document.querySelector('[data-testid="conversation-turn-9"]');
      expect(turn).not.toBeNull();
      expect(turn?.getAttribute('data-turn')).toBe('user');
      turn!.innerHTML = '';

      const result = parser.parse();
      const pairs = result.conversation?.pairs ?? [];

      // FIXED BEHAVIOR (lo-d0f0): extractQAPairs now walks conversation
      // turns in DOM order and pairs each user turn with the assistant turn
      // that immediately follows it, instead of zipping two independently-
      // filtered arrays by index. The gutted turn still occupies its slot in
      // that walk -- it becomes its own pair with an empty question plus a
      // dedicated warning -- so every later pair keeps its original
      // question, and no answer is silently reattached to the wrong one.
      expect(result.success).toBe(true);
      expect(pairs.length).toBe(baseline.length);
      expect(pairs[4]?.question.content).toBe('');
      expect(pairs[4]?.answer.content).toBe(baseline[4]?.answer.content);
      expect(pairs[5]?.question.content).toBe(baseline[5]?.question.content);
      expect(pairs[5]?.answer.content).toBe(baseline[5]?.answer.content);
      expect(result.warnings).toContain('Turn 5: the question could not be read');
    });

    it('returns success:false rather than an empty conversation when selectors match nothing', () => {
      // Simulate a redesign that drops the turn marker entirely.
      document.querySelectorAll('[data-turn]').forEach((el) => {
        el.removeAttribute('data-turn');
      });

      const result = parser.parse();

      // CURRENT BEHAVIOR (documented, not a bug to fix here): this does NOT
      // return success:false. BaseParser.parse() only sets success:false
      // when extractQAPairs throws; a selector set that matches nothing does
      // not throw -- it just yields an empty pairs array -- so parse()
      // reports success:true with a generic warning instead of a dedicated
      // failure signal. This is the silent-empty-conversation gap the task
      // is about.
      expect(result.success).toBe(true);
      expect(result.conversation?.pairs).toEqual([]);
      expect(result.warnings).toContain('No Q&A pairs found in the conversation');
    });

    it('required-selector set names custom.userTurn, the actual role discriminator (PAR-1)', () => {
      // custom.userTurn is half of the turn query and the sole role
      // discriminator in extractQAPairs; custom.conversationTurn is read by no
      // extraction code. Before this fix conversationTurn was required and
      // userTurn was not, so a rename that broke only userTurn passed the
      // required-selector check cleanly and named nothing in the drift report.
      document.querySelectorAll('[data-turn="user"]').forEach((el) => {
        el.setAttribute('data-turn', 'usr');
      });

      const result = parser.parse();
      const userTurnFinding = result.drift?.selectorFindings?.find(
        (f) => f.key === 'custom.userTurn'
      );

      expect(userTurnFinding?.matched).toBe(0);
      expect(userTurnFinding?.required).toBe(true);
    });
  });
});

describe('ChatGPT Parser - Code Artifacts', () => {
  let parser: ChatGPTParser;
  let dom: JSDOM;

  beforeEach(() => {
    const fixturePath = join(
      __dirname,
      '../../../fixtures/dom-snapshots/chatgpt/artifacts-code.html'
    );
    const html = readFileSync(fixturePath, 'utf-8');
    dom = new JSDOM(html, { url: 'https://chatgpt.com/c/test-artifacts' });
    parser = new ChatGPTParser(dom.window.document);
  });

  it('extracts code artifacts from assistant messages', () => {
    const result = parser.parse();
    const firstAnswer = result.conversation?.pairs[0]?.answer;
    expect(firstAnswer?.metadata?.artifacts).toBeDefined();
    expect(firstAnswer?.metadata?.artifacts?.length).toBeGreaterThan(0);
  });

  it('extracts React code artifact with correct metadata', () => {
    const result = parser.parse();
    const artifacts = result.conversation?.pairs[0]?.answer.metadata?.artifacts;
    const reactArtifact = artifacts?.find((a) => a.language === 'react');
    expect(reactArtifact).toBeDefined();
    expect(reactArtifact?.type).toBe('code');
    expect(reactArtifact?.title).toBe('React');
    expect(reactArtifact?.content).toContain('useState');
  });

  it('extracts CSS code artifact with correct metadata', () => {
    const result = parser.parse();
    const artifacts = result.conversation?.pairs[0]?.answer.metadata?.artifacts;
    const cssArtifact = artifacts?.find((a) => a.language === 'css');
    expect(cssArtifact).toBeDefined();
    expect(cssArtifact?.type).toBe('code');
    expect(cssArtifact?.title).toBe('Css');
    expect(cssArtifact?.content).toContain('.todo-list');
  });

  it('extracts multiple code artifacts from single message', () => {
    const result = parser.parse();
    const artifacts = result.conversation?.pairs[0]?.answer.metadata?.artifacts;
    expect(artifacts?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('ChatGPT Parser - SVG Artifacts', () => {
  let parser: ChatGPTParser;
  let dom: JSDOM;

  beforeEach(() => {
    const fixturePath = join(
      __dirname,
      '../../../fixtures/dom-snapshots/chatgpt/artifacts-svg.html'
    );
    const html = readFileSync(fixturePath, 'utf-8');
    dom = new JSDOM(html, { url: 'https://chatgpt.com/c/test-svg' });
    parser = new ChatGPTParser(dom.window.document);
  });

  it('extracts SVG artifacts with image type', () => {
    const result = parser.parse();
    const artifacts = result.conversation?.pairs[0]?.answer.metadata?.artifacts;
    const svgArtifact = artifacts?.find((a) => a.language === 'svg');
    expect(svgArtifact).toBeDefined();
    expect(svgArtifact?.type).toBe('image');
  });

  it('extracts SVG code content excluding img tag', () => {
    const result = parser.parse();
    const artifacts = result.conversation?.pairs[0]?.answer.metadata?.artifacts;
    const svgArtifact = artifacts?.find((a) => a.language === 'svg');
    expect(svgArtifact?.content).toContain('<svg');
    expect(svgArtifact?.content).toContain('</svg>');
    expect(svgArtifact?.content).not.toContain('<img');
  });

  it('extracts multiple SVG artifacts', () => {
    const result = parser.parse();
    const artifacts = result.conversation?.pairs[0]?.answer.metadata?.artifacts;
    const svgArtifacts = artifacts?.filter((a) => a.language === 'svg');
    expect(svgArtifacts?.length).toBeGreaterThanOrEqual(1);
  });

  it('does not file the artifact-preview <img> in metadata.images (lo-4b7f)', () => {
    // That decorative preview lives inside the artifact's code panel and is
    // already captured via metadata.artifacts above -- extractImages() must
    // not also treat it as a real conversation image, which previously hung
    // PDF export forever trying to decode its data: URI.
    const result = parser.parse();
    const images = result.conversation?.pairs[0]?.answer.metadata?.images;
    expect(images ?? []).toHaveLength(0);
  });
});

describe('ChatGPT Parser - Web Citations', () => {
  let parser: ChatGPTParser;
  let dom: JSDOM;

  beforeEach(() => {
    const fixturePath = join(__dirname, '../../../fixtures/dom-snapshots/chatgpt/citations.html');
    const html = readFileSync(fixturePath, 'utf-8');
    dom = new JSDOM(html, { url: 'https://chatgpt.com/c/test-citations' });
    parser = new ChatGPTParser(dom.window.document);
  });

  it('extracts web search citations from assistant messages', () => {
    const result = parser.parse();
    const firstAnswer = result.conversation?.pairs[0]?.answer;
    expect(firstAnswer?.metadata?.webSearches).toBeDefined();
    expect(firstAnswer?.metadata?.webSearches?.length).toBeGreaterThan(0);
  });

  it('extracts citation URLs and titles correctly', () => {
    const result = parser.parse();
    const webSearches = result.conversation?.pairs[0]?.answer.metadata?.webSearches;
    const search = webSearches?.[0];
    expect(search?.results).toBeDefined();
    expect(search?.results?.length).toBeGreaterThan(0);

    const firstResult = search?.results?.[0];
    expect(firstResult?.url).toMatch(/^https?:\/\//);
    expect(firstResult?.title).toBeDefined();
    expect(firstResult?.title?.length).toBeGreaterThan(0);
  });

  it('extracts domain from citation URLs', () => {
    const result = parser.parse();
    const webSearches = result.conversation?.pairs[0]?.answer.metadata?.webSearches;
    const results = webSearches?.[0]?.results;
    const githubResult = results?.find((r) => r.url.includes('github.com'));
    expect(githubResult?.domain).toBe('github.com');
  });

  it('does not generate third-party favicon URLs for citations', () => {
    // Fetching favicons from Google at export/view time would leak the
    // cited domains (and referring context) to a third party every time
    // the exported file is opened. Citations must not carry a favicon URL.
    const result = parser.parse();
    const webSearches = result.conversation?.pairs[0]?.answer.metadata?.webSearches;
    const results = webSearches?.[0]?.results;
    expect(results?.length).toBeGreaterThan(0);
    for (const citationResult of results ?? []) {
      expect(citationResult.favicon).toBeUndefined();
    }
  });

  it('does not file citation-pill favicons in metadata.images (lo-37b2)', () => {
    // Each webpage-citation-pill embeds a third-party favicon <img> next to
    // the link text. extractImages() must not treat those as conversation
    // images -- they belong to the citation, not the message, and their
    // third-party URLs would leak the cited domains on every export view.
    const result = parser.parse();
    const images = result.conversation?.pairs[0]?.answer.metadata?.images;
    expect(images ?? []).toHaveLength(0);
  });

  it('sets result count correctly', () => {
    const result = parser.parse();
    const webSearches = result.conversation?.pairs[0]?.answer.metadata?.webSearches;
    const search = webSearches?.[0];
    expect(search?.resultCount).toBe(search?.results?.length);
  });

  it('uses "Web Search" as default query', () => {
    const result = parser.parse();
    const webSearches = result.conversation?.pairs[0]?.answer.metadata?.webSearches;
    const search = webSearches?.[0];
    expect(search?.query).toBe('Web Search');
  });
});

describe('ChatGPT Parser - Comprehensive Features', () => {
  let parser: ChatGPTParser;
  let dom: JSDOM;

  beforeEach(() => {
    const fixturePath = join(
      __dirname,
      '../../../fixtures/dom-snapshots/chatgpt/comprehensive.html'
    );
    const html = readFileSync(fixturePath, 'utf-8');
    dom = new JSDOM(html, { url: 'https://chatgpt.com/c/test-comprehensive' });
    parser = new ChatGPTParser(dom.window.document);
  });

  it('extracts all features from a comprehensive message', () => {
    const result = parser.parse();
    const firstAnswer = result.conversation?.pairs[0]?.answer;
    expect(firstAnswer?.metadata?.artifacts).toBeDefined();
    expect(firstAnswer?.metadata?.webSearches).toBeDefined();
  });

  it('extracts multiple code artifacts of different types', () => {
    const result = parser.parse();
    const artifacts = result.conversation?.pairs[0]?.answer.metadata?.artifacts;
    const languages = new Set(artifacts?.map((a) => a.language));
    expect(languages.size).toBeGreaterThan(1);
    expect(languages.has('javascript')).toBe(true);
    expect(languages.has('css')).toBe(true);
  });

  it('extracts both SVG and code artifacts', () => {
    const result = parser.parse();
    const artifacts = result.conversation?.pairs[0]?.answer.metadata?.artifacts;
    const svgArtifacts = artifacts?.filter((a) => a.language === 'svg');
    const codeArtifacts = artifacts?.filter((a) => a.type === 'code');
    expect(svgArtifacts?.length).toBeGreaterThan(0);
    expect(codeArtifacts?.length).toBeGreaterThan(0);
  });

  it('extracts multiple web citations', () => {
    const result = parser.parse();
    const webSearches = result.conversation?.pairs[0]?.answer.metadata?.webSearches;
    const totalResults = webSearches?.[0]?.results?.length || 0;
    expect(totalResults).toBeGreaterThan(3);
  });

  it('preserves message content alongside metadata', () => {
    const result = parser.parse();
    const firstAnswer = result.conversation?.pairs[0]?.answer;
    expect(firstAnswer?.content.length).toBeGreaterThan(0);
    expect(firstAnswer?.metadata?.artifacts?.length).toBeGreaterThan(0);
    expect(firstAnswer?.metadata?.webSearches?.length).toBeGreaterThan(0);
  });
});

describe('ChatGPT Parser - section-based turns (2026-07 DOM)', () => {
  let parser: ChatGPTParser;

  beforeEach(() => {
    const fixturePath = join(
      __dirname,
      '../../../fixtures/dom-snapshots/chatgpt/formatting-showcase-2026-07.html'
    );
    const html = readFileSync(fixturePath, 'utf-8');
    const dom = new JSDOM(html, { url: 'https://chatgpt.com/c/test-section-turns' });
    parser = new ChatGPTParser(dom.window.document);
  });

  it('extracts one correctly-paired Q&A from <section data-turn> wrappers', () => {
    const result = parser.parse();
    expect(result.success).toBe(true);
    expect(result.conversation?.pairs.length).toBe(1);

    const pair = result.conversation?.pairs[0];
    expect(pair?.question.role).toBe('user');
    expect(pair?.answer.role).toBe('assistant');
    expect(pair?.question.content.length).toBeGreaterThan(0);
    expect(pair?.answer.content.length).toBeGreaterThan(0);
  });

  // lo-5a16: ChatGPT now renders fenced code through an embedded CodeMirror 6
  // viewer (nested <pre>, no language class on <code>). These lock in that
  // each of the fixture's two code blocks (python, json) is extracted exactly
  // once with its body intact -- no duplicate from the nested <pre>.
  it('extracts each CodeMirror code block exactly once, with a real (not guessed) language', () => {
    const result = parser.parse();
    const artifacts = result.conversation?.pairs[0]?.answer.metadata?.artifacts;
    expect(artifacts).toHaveLength(2);

    const python = artifacts?.find((a) => a.language === 'python');
    expect(python?.content).toBe(
      'factory = "Fictional"\nwidgets = ["Alpha", "Beta"]\ncount = len(widgets)\nfor w in widgets:\n    print(w)\nready = count == 2\nprint(ready)'
    );
    expect(python?.title).toBe('Python');

    const json = artifacts?.find((a) => a.language === 'json');
    expect(json?.content).toBe('{\n  "factory": "Fictional"\n}');
    expect(json?.title).toBe('Json');
  });

  it('parses htmlContent into exactly one structured code block per CodeMirror block, body intact', () => {
    const result = parser.parse({ preserveHtml: true });
    const htmlContent = result.conversation?.pairs[0]?.answer.htmlContent;
    expect(htmlContent).toBeDefined();

    const blocks = HtmlContentParser.parse(htmlContent ?? '');
    const codeBlocks = blocks.filter((b) => b.type === 'code');
    expect(codeBlocks).toHaveLength(2);
    expect((codeBlocks[0] as { code: string }).code).toContain('factory = "Fictional"');
    expect((codeBlocks[1] as { code: string }).code).toContain('"factory": "Fictional"');
  });
});

// lo-f132: a Deep Research turn holds no message element at all -- the report
// lives in a cross-origin sandboxed <iframe>. The turn's only text was the
// screenreader label, which the raw-textContent fallback shipped as the answer.
describe('ChatGPT Parser - Deep Research turn (cross-origin iframe)', () => {
  let parser: ChatGPTParser;

  const load = (): Document => {
    const fixturePath = join(
      __dirname,
      '../../../fixtures/dom-snapshots/chatgpt/deep-research-2026-07.html'
    );
    const html = readFileSync(fixturePath, 'utf-8');
    return new JSDOM(html, { url: 'https://chatgpt.com/c/test-deep-research' }).window.document;
  };

  beforeEach(() => {
    parser = new ChatGPTParser(load());
  });

  it('never ships the screenreader label as the answer', () => {
    const result = parser.parse();
    for (const pair of result.conversation?.pairs ?? []) {
      expect(pair.answer.content).not.toContain('ChatGPT said:');
      expect(pair.question.content).not.toContain('You said:');
    }
  });

  it('labels the Deep Research answer with a marker naming the widget', () => {
    const result = parser.parse();
    expect(result.conversation?.pairs[0]?.answer.content).toBe(
      '[Deep Research: rendered in an embedded viewer ChatGPT does not expose to the page]'
    );
  });

  it('leaves the ordinary turn in the same conversation untouched', () => {
    const result = parser.parse();
    expect(result.conversation?.pairs).toHaveLength(2);
    expect(result.conversation?.pairs[1]?.question.content).toContain('summarise');
    expect(result.conversation?.pairs[1]?.answer.content).toContain('tidal mill');
  });

  it('reads a Deep-Research-only conversation as a complete pair, not an empty one', () => {
    // Same fixture with the ordinary follow-up removed: the whole conversation
    // is then one question and one iframe-only answer.
    const document = load();
    document
      .querySelectorAll('[data-testid="conversation-turn-3"], [data-testid="conversation-turn-4"]')
      .forEach((turn) => {
        turn.remove();
      });

    const result = new ChatGPTParser(document).parse();
    expect(result.conversation?.pairs).toHaveLength(1);
    expect(result.conversation?.pairs[0]?.answer.content).toContain('[Deep Research:');
    expect(result.warnings).toBeUndefined();
  });
});

// lo-9001: the page's content script relays the sandboxed frame's own
// rendered text out via postMessage and stashes it on the iframe element as
// EMBEDDED_FRAME_REPORT_ATTR. The parser must prefer that real report text
// over the lo-f132 marker -- and must still degrade to the marker, never an
// exception or fabricated content, when the relay produced nothing readable.
describe('ChatGPT Parser - Deep Research turn (relayed report text)', () => {
  const REPORT_TEXT =
    'Tidal mills trapped the incoming tide behind a sluice and released it through ' +
    'a waterwheel on the ebb, so grinding time slid with the tide rather than the ' +
    'sun. They died out once steam power let millers work fixed hours anywhere.';
  const MARKER =
    '[Deep Research: rendered in an embedded viewer ChatGPT does not expose to the page]';

  const load = (attrValue?: string): Document => {
    const fixturePath = join(
      __dirname,
      '../../../fixtures/dom-snapshots/chatgpt/deep-research-2026-07.html'
    );
    const html = readFileSync(fixturePath, 'utf-8');
    const document = new JSDOM(html, { url: 'https://chatgpt.com/c/test-deep-research' }).window
      .document;
    if (attrValue !== undefined) {
      const frame = document.querySelector(CHATGPT_SELECTORS.custom.embeddedWidgetFrame);
      frame?.setAttribute(EMBEDDED_FRAME_REPORT_ATTR, attrValue);
    }
    return document;
  };

  it('exports the relayed report text instead of the marker when the frame was read', () => {
    const result = new ChatGPTParser(load(REPORT_TEXT)).parse();
    expect(result.conversation?.pairs[0]?.answer.content).toBe(REPORT_TEXT);
  });

  it('falls back to the marker when the relayed text is empty or whitespace-only', () => {
    const result = new ChatGPTParser(load('   \n  ')).parse();
    expect(result.conversation?.pairs[0]?.answer.content).toBe(MARKER);
  });

  it('falls back to the marker when the frame was never read at all', () => {
    const result = new ChatGPTParser(load()).parse();
    expect(result.conversation?.pairs[0]?.answer.content).toBe(MARKER);
  });
});

// The same raw-textContent fallback exists on the user side, where the
// screenreader label reads "You said:". It is reached by a user turn with
// neither a message element nor a text bubble -- no capture shows one, which
// is exactly why the guard belongs on the fallback rather than on the widget.
describe('ChatGPT Parser - screenreader labels on the user side', () => {
  it('uses the image placeholder, not "You said:", for a bubble-less upload turn', () => {
    const dom = new JSDOM(
      `<main id="main">
         <section data-turn="user" data-testid="conversation-turn-1">
           <h4 class="sr-only select-none">You said:</h4>
           <img src="https://files.example.test/photo.png" alt="a tide pond">
         </section>
         <section data-turn="assistant" data-testid="conversation-turn-2">
           <h4 class="sr-only select-none">ChatGPT said:</h4>
           <div data-message-author-role="assistant" data-message-id="a1">
             <div class="markdown prose"><p>That is a tide pond at low water.</p></div>
           </div>
         </section>
       </main>`,
      { url: 'https://chatgpt.com/c/test-image-only' }
    );

    const result = new ChatGPTParser(dom.window.document).parse();
    expect(result.conversation?.pairs[0]?.question.content).toBe('[Uploaded images: a tide pond]');
  });
});
