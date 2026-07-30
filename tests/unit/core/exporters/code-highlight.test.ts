/**
 * R-8: the five-token mapping over highlight.js.
 *
 * The point of the task is that exactly five classes reach the exporters and an
 * unmapped hljs scope renders as plain text rather than picking up a colour by
 * accident — so these tests are about the mapping, not about hljs itself.
 */

import { describe, it, expect } from 'vitest';
import {
  classForScope,
  highlightCode,
  loadHighlighter,
  tokenizeHighlighted,
  type CodeToken,
  type Highlighter,
} from '../../../../src/core/exporters/code-highlight';
import { CODE_TOKEN_COLOR } from '../../../../src/core/exporters/style-tokens';

describe('classForScope', () => {
  it('maps each of the five families', () => {
    expect(classForScope('hljs-comment')).toBe('comment');
    expect(classForScope('hljs-keyword')).toBe('keyword');
    expect(classForScope('hljs-string')).toBe('string');
    expect(classForScope('hljs-number')).toBe('number');
    expect(classForScope('hljs-title function_')).toBe('function');
  });

  it('falls back to the leading scope for a compound class', () => {
    expect(classForScope('hljs-title class_')).toBe('function');
    expect(classForScope('hljs-variable constant_')).toBe('number');
  });

  it('returns null for an unmapped scope rather than guessing a colour', () => {
    expect(classForScope('hljs-punctuation')).toBeNull();
    expect(classForScope('hljs-some-future-scope')).toBeNull();
    expect(classForScope('hljs')).toBeNull();
    expect(classForScope('')).toBeNull();
  });

  it('never yields a class without a declared colour', () => {
    const scopes = ['hljs-comment', 'hljs-keyword', 'hljs-string', 'hljs-number', 'hljs-title'];
    for (const scope of scopes) {
      const cls = classForScope(scope);
      expect(cls).not.toBeNull();
      expect(CODE_TOKEN_COLOR[cls!]).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe('tokenizeHighlighted', () => {
  it('flattens spans into a token list carrying the five classes', () => {
    const html =
      '<span class="hljs-keyword">def</span> <span class="hljs-title function_">f</span>()';
    const tokens = tokenizeHighlighted(html, document);

    expect(tokens).toEqual<CodeToken[]>([
      { text: 'def', cls: 'keyword' },
      { text: ' ', cls: null },
      { text: 'f', cls: 'function' },
      { text: '()', cls: null },
    ]);
  });

  it('takes the innermost class when a nested span maps elsewhere', () => {
    // Inner scope must win, so pick one that maps to a DIFFERENT class than the
    // outer: `subst` also maps to `string`, which would merge and prove nothing.
    const html = '<span class="hljs-string">"a<span class="hljs-number">1</span>b"</span>';
    const tokens = tokenizeHighlighted(html, document);

    expect(tokens).toEqual<CodeToken[]>([
      { text: '"a', cls: 'string' },
      { text: '1', cls: 'number' },
      { text: 'b"', cls: 'string' },
    ]);
  });

  it('keeps a nested span that maps to the same class as one merged run', () => {
    const html = '<span class="hljs-string">"a<span class="hljs-subst">${x}</span>"</span>';
    const tokens = tokenizeHighlighted(html, document);

    expect(tokens).toEqual<CodeToken[]>([{ text: '"a${x}"', cls: 'string' }]);
  });

  it('merges adjacent runs of the same class', () => {
    const html = '<span class="hljs-keyword">if</span><span class="hljs-keyword"> not</span>';
    expect(tokenizeHighlighted(html, document)).toEqual<CodeToken[]>([
      { text: 'if not', cls: 'keyword' },
    ]);
  });

  it('decodes entities so the code is the original text', () => {
    const html = '<span class="hljs-string">&quot;a &lt; b&quot;</span>';
    const tokens = tokenizeHighlighted(html, document);
    expect(tokens.map((t) => t.text).join('')).toBe('"a < b"');
  });
});

describe('highlightCode', () => {
  const stub: Highlighter = {
    getLanguage: (name) => (name === 'python' ? {} : undefined),
    highlight: (code) => ({ value: `<span class="hljs-keyword">${code}</span>` }),
    highlightAuto: (code) => ({ value: `<span class="hljs-number">${code}</span>` }),
  };

  it('falls back to auto-detection when the language is unknown to hljs', () => {
    // Unlabelled or unrecognised code must still be coloured: the highlighter
    // this replaced coloured every block regardless of language, and silently
    // dropping that would be a regression.
    expect(highlightCode('x = 1', 'brainfuck', stub, document)).toEqual([
      { text: 'x = 1', cls: 'number' },
    ]);
  });

  it('falls back to auto-detection when there is no language at all', () => {
    expect(highlightCode('x = 1', undefined, stub, document)).toEqual([
      { text: 'x = 1', cls: 'number' },
    ]);
  });

  it('uses the declared language when hljs knows it', () => {
    expect(highlightCode('x = 1', 'python', stub, document)).toEqual([
      { text: 'x = 1', cls: 'keyword' },
    ]);
  });

  it('returns one plain token for empty code', () => {
    expect(highlightCode('', 'python', stub, document)).toEqual([{ text: '', cls: null }]);
  });

  it('returns one plain token when no highlighter loaded', () => {
    expect(highlightCode('x = 1', 'python', null, document)).toEqual([
      { text: 'x = 1', cls: null },
    ]);
  });

  it('degrades to plain code when the highlighter throws', () => {
    const throwing: Highlighter = {
      getLanguage: () => ({}),
      highlight: () => {
        throw new Error('boom');
      },
      highlightAuto: () => {
        throw new Error('boom');
      },
    };
    // A highlighter that chokes must not fail the export.
    expect(highlightCode('x = 1', 'python', throwing, document)).toEqual([
      { text: 'x = 1', cls: null },
    ]);
  });

  it('highlights a real snippet through the actual highlight.js', async () => {
    const hljs = await loadHighlighter();
    expect(hljs).not.toBeNull();

    const tokens = highlightCode('# note\ndef f(x):\n    return "s" + 1', 'python', hljs, document);

    // The code round-trips exactly...
    expect(tokens.map((t) => t.text).join('')).toBe('# note\ndef f(x):\n    return "s" + 1');
    // ...and only ever carries the five classes.
    const used = new Set(
      tokens.map((t) => t.cls).filter((c): c is Exclude<CodeToken['cls'], null> => c !== null)
    );
    expect([...used].every((c) => c in CODE_TOKEN_COLOR)).toBe(true);
    expect(used.has('comment')).toBe(true);
    expect(used.has('keyword')).toBe(true);
    expect(used.has('string')).toBe(true);
    expect(used.has('number')).toBe(true);
  });
});

describe('R-8: auto-detection is restricted to a sane language subset', () => {
  it('detects javascript, not ada, for an unlabelled js one-liner', async () => {
    const hljs = await loadHighlighter();
    const tokens = highlightCode('function foo() { return "hi"; }', undefined, hljs, document);

    // Unrestricted highlightAuto picks 'ada' here and types the string as
    // hljs-type, which lands on the keyword colour. The subset keeps it correct.
    const strings = tokens.filter((t) => t.cls === 'string').map((t) => t.text);
    expect(strings).toEqual(['"hi"']);
    expect(tokens.filter((t) => t.cls === 'keyword').map((t) => t.text)).toEqual(
      expect.arrayContaining(['function', 'return'])
    );
  });

  it('detects python, not ruby, for an unlabelled python snippet', async () => {
    const hljs = await loadHighlighter();
    const tokens = highlightCode('def f(x):\n    return "s"', undefined, hljs, document);
    expect(tokens.filter((t) => t.cls === 'string').map((t) => t.text)).toEqual(['"s"']);
  });
});
