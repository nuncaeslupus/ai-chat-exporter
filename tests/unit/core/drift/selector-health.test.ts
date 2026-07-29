/**
 * SelectorHealth: run every declared selector against the document and
 * report its match count. The required/optional split is what distinguishes
 * "the parser is broken" from "that widget isn't on this page".
 */
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { checkSelectorHealth } from '../../../../src/core/drift/selector-health';
import type { SelectorSet } from '../../../../src/core/types';

const selectors: SelectorSet = {
  conversationContainer: 'main',
  messageElement: '[data-role]',
  userMessage: '[data-role="user"]',
  assistantMessage: '[data-role="assistant"]',
  messageContent: '.content',
  custom: {
    presentWidget: '.widget',
    absentWidget: '.no-such-widget',
  },
};

const required = ['conversationContainer', 'messageElement', 'messageContent'];

function docWith(html: string): Document {
  return new JSDOM(html).window.document;
}

describe('checkSelectorHealth', () => {
  it('reports a match count for every declared selector', () => {
    const doc = docWith('<main><div data-role="user"><p class="content">hi</p></div></main>');
    const findings = checkSelectorHealth(doc, selectors, required);
    const keys = findings.map((f) => f.key);
    expect(keys).toContain('conversationContainer');
    expect(keys).toContain('custom.presentWidget');
    expect(findings.find((f) => f.key === 'messageElement')?.matched).toBe(1);
  });

  it('marks required keys as required and others as optional', () => {
    const doc = docWith('<main></main>');
    const findings = checkSelectorHealth(doc, selectors, required);
    expect(findings.find((f) => f.key === 'messageContent')?.required).toBe(true);
    expect(findings.find((f) => f.key === 'custom.absentWidget')?.required).toBe(false);
  });

  it('records zero matches for a dead selector', () => {
    const doc = docWith('<main></main>');
    const findings = checkSelectorHealth(doc, selectors, required);
    expect(findings.find((f) => f.key === 'messageElement')?.matched).toBe(0);
  });

  it('reports an invalid selector as -1 instead of throwing', () => {
    const doc = docWith('<main></main>');
    const broken: SelectorSet = { ...selectors, messageContent: ':::not-css' };
    expect(() => checkSelectorHealth(doc, broken, required)).not.toThrow();
    const findings = checkSelectorHealth(doc, broken, required);
    expect(findings.find((f) => f.key === 'messageContent')?.matched).toBe(-1);
  });

  it('skips undeclared optional top-level keys', () => {
    const doc = docWith('<main></main>');
    const findings = checkSelectorHealth(doc, selectors, required);
    expect(findings.map((f) => f.key)).not.toContain('conversationTitle');
  });
});
