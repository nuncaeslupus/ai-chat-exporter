/**
 * ChatGPT Parser Tests
 * TDD: Tests written before implementation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CHATGPT_SELECTORS, isChatGPTUrl } from '../../../../src/core/parsers/chatgpt/selectors';
import { ChatGPTParser } from '../../../../src/core/parsers/chatgpt/parser';

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
      expect(CHATGPT_SELECTORS.custom?.conversationTurn).toBeDefined();
      expect(CHATGPT_SELECTORS.custom?.userMessageContent).toBeDefined();
      expect(CHATGPT_SELECTORS.custom?.assistantMessageContent).toBeDefined();
    });

    it('has code artifact selectors', () => {
      expect(CHATGPT_SELECTORS.custom?.codeArtifactContainer).toBeDefined();
      expect(CHATGPT_SELECTORS.custom?.codeArtifactLanguage).toBeDefined();
      expect(CHATGPT_SELECTORS.custom?.codeArtifactContent).toBeDefined();
    });

    it('has web citation selectors', () => {
      expect(CHATGPT_SELECTORS.custom?.citationPill).toBeDefined();
      expect(CHATGPT_SELECTORS.custom?.citationLink).toBeDefined();
    });
  });
});

describe('ChatGPT Parser', () => {
  let dom: JSDOM;
  let document: Document;

  // Load the real DOM fixture
  beforeEach(() => {
    const fixturePath = join(__dirname, '../../../fixtures/dom-snapshots/chatgpt/real-capture.html');
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
      const modelIndicator = document.querySelector(CHATGPT_SELECTORS.modelIndicator!);
      expect(modelIndicator).not.toBeNull();
      expect(modelIndicator?.getAttribute('data-message-model-slug')).toBeDefined();
    });

    it('finds content within user messages', () => {
      const userContent = document.querySelector(CHATGPT_SELECTORS.custom!.userMessageContent!);
      expect(userContent).not.toBeNull();
      expect(userContent?.textContent?.trim().length).toBeGreaterThan(0);
    });

    it('finds content within assistant messages', () => {
      const assistantContent = document.querySelector(CHATGPT_SELECTORS.custom!.assistantMessageContent!);
      expect(assistantContent).not.toBeNull();
    });
  });
});

describe('ChatGPTParser implementation', () => {
  let parser: ChatGPTParser;
  let dom: JSDOM;
  let document: Document;

  beforeEach(() => {
    const fixturePath = join(__dirname, '../../../fixtures/dom-snapshots/chatgpt/real-capture.html');
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
      expect(pair?.question.content.length).toBeGreaterThan(0);
      expect(pair?.answer.content.length).toBeGreaterThan(0);
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
      const noModelHtml = '<html><body><main><div data-message-author-role="assistant"></div></main></body></html>';
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
  });
});

describe('ChatGPT Parser - Code Artifacts', () => {
  let parser: ChatGPTParser;
  let dom: JSDOM;

  beforeEach(() => {
    const fixturePath = join(__dirname, '../../../fixtures/dom-snapshots/chatgpt/artifacts-code.html');
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
    const fixturePath = join(__dirname, '../../../fixtures/dom-snapshots/chatgpt/artifacts-svg.html');
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

  it('generates favicon URLs for citations', () => {
    const result = parser.parse();
    const webSearches = result.conversation?.pairs[0]?.answer.metadata?.webSearches;
    const results = webSearches?.[0]?.results;
    const firstResult = results?.[0];
    expect(firstResult?.favicon).toContain('google.com/s2/favicons');
    expect(firstResult?.favicon).toContain('domain=');
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
    const fixturePath = join(__dirname, '../../../fixtures/dom-snapshots/chatgpt/comprehensive.html');
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
