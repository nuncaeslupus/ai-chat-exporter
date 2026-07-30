/**
 * D-18: base-parser.ts fabricated a `timestamp: new Date()` on every message,
 * so every "message time" downstream was really the capture moment. No
 * parser can recover a real per-message time from the DOM (see the payload
 * for the capture evidence), so the honest behaviour is to leave it unset:
 * `Message.timestamp` is optional, and every consumer (exporters, popup meta
 * line) already treats "no timestamp" as "don't show a time" rather than
 * inventing one.
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { GeminiParser } from '../../../../src/core/parsers/gemini/parser';

// createMessage is `protected` on BaseParser; reach through GeminiParser like
// the sibling base-parser.test.ts does for extractContent.
type TestableParser = GeminiParser & {
  createMessage: (
    role: 'user' | 'assistant' | 'system',
    content: string,
    htmlContent?: string,
    id?: string
  ) => { timestamp?: Date };
};

function buildParser(): TestableParser {
  const dom = new JSDOM('<html><body></body></html>', {
    url: 'https://gemini.google.com/app/test',
  });
  return new GeminiParser(dom.window.document) as TestableParser;
}

describe('BaseParser.createMessage does not fabricate a timestamp', () => {
  it('leaves timestamp undefined instead of stamping the capture moment', () => {
    const parser = buildParser();
    const message = parser.createMessage('user', 'hello');

    expect(message.timestamp).toBeUndefined();
  });
});
