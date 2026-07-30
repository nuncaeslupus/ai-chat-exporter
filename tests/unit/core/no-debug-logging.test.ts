import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Parsing runs a console call per message, per node and per artifact, so a
 * `console.log` on these paths costs CPU in a hot loop *and* pins the logged
 * object -- parsed conversation content -- in devtools console history for as
 * long as it stays open. `console.warn`/`console.error` on genuine failure
 * paths are fine: they fire once, off the hot path.
 */
const HOT_PATH_FILES = [
  'src/core/services/html-content-parser.ts',
  'src/core/services/claude-api-service.ts',
  'src/core/parsers/base-parser.ts',
  'src/core/parsers/claude/parser.ts',
];

const rootDir = resolve(__dirname, '../../..');

describe('parser/service hot paths', () => {
  it.each(HOT_PATH_FILES)('%s has no console.log', (file) => {
    const source = readFileSync(resolve(rootDir, file), 'utf8');
    const offenders = source
      .split('\n')
      .map((line, i) => ({ line, number: i + 1 }))
      .filter(({ line }) => /(^|[^.\w])console\.log\s*\(/.test(line));

    expect(offenders.map((o) => `${file}:${String(o.number)}`)).toEqual([]);
  });
});
