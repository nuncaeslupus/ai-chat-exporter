/**
 * D-27: vitest 4 dropped `coverage.all`, so a source file no test imports no
 * longer appears in the coverage report at 0% -- it just vanishes, and the
 * floor can no longer catch a brand-new untested module via dilution. This
 * check restores that signal independently of the coverage provider: walk the
 * import graph outward from every test file and assert it reaches every
 * `src/**\/*.ts` file. A file only imported by something a test never touches
 * -- e.g. `base-exporter.ts` used solely by subclasses the tests import --
 * still counts, since the walk follows imports transitively rather than
 * requiring a test to name the file directly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, join, dirname, relative } from 'path';

const ROOT = resolve(__dirname, '../..');
const SRC_DIR = join(ROOT, 'src');
const TESTS_DIR = join(ROOT, 'tests');

function walkFiles(dir: string, predicate: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(path, predicate);
    return predicate(entry.name) ? [path] : [];
  });
}

/** Same denominator the coverage floor uses: real source, not generated data or ambient types. */
const ALL_SRC_FILES = walkFiles(
  SRC_DIR,
  (name) => name.endsWith('.ts') && !name.endsWith('.generated.ts') && !name.endsWith('.d.ts')
);

const TEST_FILES = walkFiles(TESTS_DIR, (name) => name.endsWith('.test.ts'));

/** Matches static `import ... from '...'`, `export ... from '...'`, side-effect `import '...'`, and dynamic `import('...')`. */
const IMPORT_RE =
  /(?:import|export)\s[^;]*?\sfrom\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm;

function importSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf-8');
  return [...source.matchAll(IMPORT_RE)]
    .map((m) => m[1] ?? m[2] ?? m[3])
    .filter((s): s is string => !!s);
}

/** Resolves a relative specifier the way this project's tsconfig ("bundler" resolution, no import extensions) does. Bare package specifiers (no leading dot) return null -- they're outside the src/tests graph. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  const candidates = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

function reachableFrom(seeds: string[]): Set<string> {
  const visited = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    for (const spec of importSpecifiers(file)) {
      const resolved = resolveSpecifier(file, spec);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return visited;
}

describe('src import reachability', () => {
  it('every src/**/*.ts file is reachable, transitively, from a test file', () => {
    const reachable = reachableFrom(TEST_FILES);
    const unreachable = ALL_SRC_FILES.filter((f) => !reachable.has(f)).map((f) =>
      relative(ROOT, f)
    );

    expect(unreachable).toEqual([]);
  });
});
