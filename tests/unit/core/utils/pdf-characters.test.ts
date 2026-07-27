/**
 * PDF Character Sanitizer Tests
 */

import { describe, it, expect } from 'vitest';
import { sanitizeTextForPDF } from '../../../../src/core/utils/pdf-characters';

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
});
