/**
 * CONSIST-1: content-script.ts hardcoded the `[AI Chat Exporter]` log prefix
 * instead of importing EXTENSION_NAME from shared/constants.ts, the
 * convention service-worker.ts already uses in 28 call sites. A rebrand that
 * edits EXTENSION_NAME would then split console output across two product
 * names. Source-level check: no hardcoded literal, the shared constant is
 * imported and used instead.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('content-script.ts log prefix', () => {
  const source = readFileSync(
    resolve(__dirname, '../../../../src/extension/content/content-script.ts'),
    'utf-8'
  );

  it('does not hardcode the "[AI Chat Exporter]" literal', () => {
    expect(source).not.toContain('[AI Chat Exporter]');
  });

  it('imports EXTENSION_NAME from shared/constants and uses it as the log prefix', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*EXTENSION_NAME[^}]*\}\s*from\s*['"].*shared\/constants['"]/
    );
    expect(source).toContain('[${EXTENSION_NAME}]');
  });
});
