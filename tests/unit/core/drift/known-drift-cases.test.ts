/**
 * The three real drift cases from 2026-07, as regressions. Markup is invented
 * to reproduce each structural shape; no captured conversation text is used.
 */
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { checkSelectorHealth, checkOutputSanity } from '../../../../src/core/drift';
import type { SelectorSet, QAPair } from '../../../../src/core/types';

function docWith(html: string): Document {
  return new JSDOM(html).window.document;
}

function pair(question: string, answer: string): QAPair {
  return {
    index: 0,
    question: { id: 'q0', role: 'user', content: question, timestamp: new Date(0) },
    answer: { id: 'a0', role: 'assistant', content: answer, timestamp: new Date(0) },
  } as QAPair;
}

describe('known drift cases', () => {
  it('case 1 — Claude container class changed: required selector matches zero', () => {
    const selectors = {
      conversationContainer: 'div.overflow-y-scroll.pt-6.flex-1',
      messageElement: 'div[data-test-render-count]',
      userMessage: 'div[data-testid="user-message"]',
      assistantMessage: 'div[data-is-streaming="false"]',
      messageContent: 'div.standard-markdown',
    } satisfies SelectorSet;

    // The live markup switched `overflow-y-scroll` to `overflow-y-auto`.
    const doc = docWith('<div class="overflow-y-auto pt-6 flex-1"></div>');
    const findings = checkSelectorHealth(doc, selectors, ['conversationContainer']);
    const container = findings.find((f) => f.key === 'conversationContainer');
    expect(container?.matched).toBe(0);
    expect(container?.required).toBe(true);
  });

  it('case 2 — Gemini title selector dead: recorded, and required when declared so', () => {
    const selectors = {
      conversationContainer: 'main',
      messageElement: '.turn',
      userMessage: '.turn.user',
      assistantMessage: '.turn.model',
      messageContent: '.content',
      conversationTitle: '.conversation-title-that-no-longer-exists',
    } satisfies SelectorSet;

    const doc = docWith('<main><div class="turn user"><p class="content">q</p></div></main>');
    const findings = checkSelectorHealth(doc, selectors, ['conversationTitle']);
    expect(findings.find((f) => f.key === 'conversationTitle')?.matched).toBe(0);
  });

  it('case 3 — ChatGPT Deep Research: parse succeeds, output is the UI label', () => {
    // The turn held a long report; the extractor returned the sr-only label.
    const turnChars = 529;
    const findings = checkOutputSanity({
      pairs: [pair('Research the market for widgets', 'ChatGPT said:')],
      turnCount: 2,
      turnTextLengths: [turnChars],
      chromeStrings: ['ChatGPT said:', 'You said:'],
    });
    const rules = findings.map((f) => f.rule);
    expect(rules).toContain('chrome-as-content');
    expect(rules).toContain('content-shortfall');
  });

  it('an absent optional widget is not drift', () => {
    const selectors = {
      conversationContainer: 'main',
      messageElement: '.turn',
      userMessage: '.turn.user',
      assistantMessage: '.turn.model',
      messageContent: '.content',
      custom: { webSearchContainer: '.web-search' },
    } satisfies SelectorSet;

    const doc = docWith('<main><div class="turn user"><p class="content">q</p></div></main>');
    const findings = checkSelectorHealth(doc, selectors, ['conversationContainer']);
    const widget = findings.find((f) => f.key === 'custom.webSearchContainer');
    expect(widget?.matched).toBe(0);
    expect(widget?.required).toBe(false);
  });
});
