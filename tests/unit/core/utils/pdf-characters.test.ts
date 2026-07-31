/**
 * PDF Character Sanitizer Tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeTextForPDF,
  UNSUPPORTED_SCRIPT_PLACEHOLDER,
} from '../../../../src/core/utils/pdf-characters';

describe('sanitizeTextForPDF()', () => {
  it('passes through characters representable in Windows-1252, never deletes them', () => {
    // ~ (U+007E), ° (U+00B0), · (U+00B7), ˜ (U+02DC) are all encodable in Win-1252.
    const input = 'a~b°c·d˜e';
    const result = sanitizeTextForPDF(input);

    for (const char of ['~', '°', '·', '˜']) {
      expect(result).toContain(char);
    }
  });

  it('substitutes genuinely unrepresentable characters visibly, never with empty string', () => {
    // Tilde-like operators outside Win-1252 (U+2248, U+223C, U+223D, U+223E).
    const chars = ['≈', '∼', '∽', '∾'];
    for (const char of chars) {
      const result = sanitizeTextForPDF(char);
      expect(result).not.toBe('');
      expect(result.trim().length).toBeGreaterThan(0);
    }
  });

  // EXP-2: the embedded faces are Latin-only. Before this fix, any codepoint
  // outside that coverage (and outside PDF_CHARACTER_REPLACEMENTS) passed
  // through sanitizeTextForPDF unchanged, reached jsPDF with no cmap entry,
  // and vanished from the content stream entirely -- a whole non-Latin
  // conversation exported as blank pages while reporting success.
  it('replaces CJK text with a visible placeholder instead of deleting it', () => {
    const result = sanitizeTextForPDF('你好世界');
    expect(result).not.toBe('你好世界');
    expect(result).not.toContain('你');
    expect(result).toBe(UNSUPPORTED_SCRIPT_PLACEHOLDER.repeat(4));
  });

  it('replaces Cyrillic text with a visible placeholder instead of deleting it', () => {
    const result = sanitizeTextForPDF('Привет');
    expect(result).not.toBe('Привет');
    expect(result).not.toContain('П');
    expect(result).toBe(UNSUPPORTED_SCRIPT_PLACEHOLDER.repeat(6));
  });

  it('replaces Arabic text with a visible placeholder instead of deleting it', () => {
    const result = sanitizeTextForPDF('مرحبا');
    expect(result).not.toBe('مرحبا');
    expect(result).not.toContain('م');
    expect(result.length).toBeGreaterThan(0);
    expect([...result].every((c) => c === UNSUPPORTED_SCRIPT_PLACEHOLDER)).toBe(true);
  });

  it('replaces Hebrew text with a visible placeholder instead of deleting it', () => {
    const result = sanitizeTextForPDF('שלום');
    expect(result).not.toBe('שלום');
    expect(result).not.toContain('ש');
    expect([...result].every((c) => c === UNSUPPORTED_SCRIPT_PLACEHOLDER)).toBe(true);
  });

  it('leaves a mixed Latin/CJK string with the Latin part intact and the CJK part flagged', () => {
    // Regression for the payload's measured case: 'a你b' used to reach jsPDF
    // as 2 glyphs for 3 characters (the CJK codepoint silently deleted).
    const result = sanitizeTextForPDF('a你b');
    expect(result).toBe(`a${UNSUPPORTED_SCRIPT_PLACEHOLDER}b`);
  });

  it('does not change pure-Latin/ASCII output at all (no regression)', () => {
    const input = 'The quick brown fox jumps over the lazy dog. 0123456789 - café.';
    expect(sanitizeTextForPDF(input)).toBe(input);
  });

  it('calls the onUnsupportedScript callback when a script can not be rendered', () => {
    const onUnsupportedScript = vi.fn();
    sanitizeTextForPDF('你好', onUnsupportedScript);
    expect(onUnsupportedScript).toHaveBeenCalledTimes(1);
  });

  it('does not call the onUnsupportedScript callback for plain Latin text', () => {
    const onUnsupportedScript = vi.fn();
    sanitizeTextForPDF('Hello, world!', onUnsupportedScript);
    expect(onUnsupportedScript).not.toHaveBeenCalled();
  });

  it('does not call the onUnsupportedScript callback for text already handled by PDF_CHARACTER_REPLACEMENTS', () => {
    const onUnsupportedScript = vi.fn();
    sanitizeTextForPDF('α ≈ β', onUnsupportedScript);
    expect(onUnsupportedScript).not.toHaveBeenCalled();
  });
});
