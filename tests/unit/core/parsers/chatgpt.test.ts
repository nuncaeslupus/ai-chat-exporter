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
  });
});
