/**
 * lo-9001: the postMessage wire format between the Deep Research sandboxed
 * iframe (deep-research-frame.ts) and the parent page's content script.
 */

import { describe, it, expect } from 'vitest';
import {
  DEEP_RESEARCH_FRAME_ORIGIN_RE,
  createDeepResearchFrameMessage,
  isDeepResearchFrameMessage,
} from '../../../src/shared/deep-research-relay';

describe('DEEP_RESEARCH_FRAME_ORIGIN_RE', () => {
  it('matches the sandbox host from the captured markup', () => {
    expect(
      DEEP_RESEARCH_FRAME_ORIGIN_RE.test(
        'https://connector-openai-deep-research.web-sandbox.oaiusercontent.com'
      )
    ).toBe(true);
  });

  it('rejects the plain oaiusercontent.com host (user file uploads, not the sandbox)', () => {
    expect(DEEP_RESEARCH_FRAME_ORIGIN_RE.test('https://files.oaiusercontent.com')).toBe(false);
  });

  it('rejects an unrelated origin trying to spoof a report', () => {
    expect(DEEP_RESEARCH_FRAME_ORIGIN_RE.test('https://evil.example.com')).toBe(false);
  });
});

describe('isDeepResearchFrameMessage', () => {
  it('accepts a text message built by createDeepResearchFrameMessage', () => {
    const message = createDeepResearchFrameMessage({ text: 'the report text' });
    expect(isDeepResearchFrameMessage(message)).toBe(true);
  });

  it('accepts an html message built by createDeepResearchFrameMessage', () => {
    const message = createDeepResearchFrameMessage({ html: '<p>the report</p>' });
    expect(isDeepResearchFrameMessage(message)).toBe(true);
  });

  it('rejects data with the wrong type tag', () => {
    expect(isDeepResearchFrameMessage({ type: 'something-else', text: 'x' })).toBe(false);
  });

  it('rejects data with a non-string text field and no html field', () => {
    expect(
      isDeepResearchFrameMessage({ type: 'ai-chat-exporter:deep-research-report', text: 42 })
    ).toBe(false);
  });

  it('rejects null and non-objects', () => {
    expect(isDeepResearchFrameMessage(null)).toBe(false);
    expect(isDeepResearchFrameMessage('a string')).toBe(false);
    expect(isDeepResearchFrameMessage(undefined)).toBe(false);
  });
});
