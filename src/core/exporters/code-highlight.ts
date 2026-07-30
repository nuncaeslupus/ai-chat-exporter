/**
 * Five-token syntax highlighting, shared by pdf, docx and html (R-8).
 *
 * `highlight.js` is already a dependency (it was previously loaded only on the
 * print path). It emits ~20 scope classes; the design asks for **five**, dark
 * and low-saturation, so each clears WCAG AA on the code background and the set
 * stays distinguishable printed in greyscale. This module is that mapping.
 *
 * md and txt deliberately do not use it: the fence's language tag already tells
 * a Markdown renderer how to paint the block, and plain text has no colour.
 *
 * Loading is dynamic and happens once per export, so hljs stays out of the eager
 * content-script bundle (see `src/core/exporters/index.ts` for why that matters).
 */

import type { CODE_TOKEN_COLOR } from './style-tokens';

/** One of the five classes, or null for punctuation and plain identifiers. */
export type CodeTokenClass = keyof typeof CODE_TOKEN_COLOR | null;

/** A run of code that shares one class. */
export interface CodeToken {
  text: string;
  cls: CodeTokenClass;
}

/**
 * hljs scope -> one of the five classes.
 *
 * Matched on the most specific scope first, then by prefix, so
 * `hljs-title function_` lands on `function` and an unlisted scope falls through
 * to `null` rather than being coloured arbitrarily. Keeping this table explicit
 * is the point of the task: a new hljs scope should render as plain text until
 * someone decides which of the five it belongs to.
 */
const SCOPE_TO_CLASS: Record<string, CodeTokenClass> = {
  comment: 'comment',
  quote: 'comment',
  doctag: 'comment',

  keyword: 'keyword',
  'selector-tag': 'keyword',
  literal: 'keyword',
  type: 'keyword',
  built_in: 'keyword',
  'meta keyword': 'keyword',

  title: 'function',
  'title function_': 'function',
  'title class_': 'function',
  function: 'function',
  class: 'function',
  section: 'function',

  string: 'string',
  'meta string': 'string',
  regexp: 'string',
  'selector-string': 'string',
  'template-tag': 'string',
  subst: 'string',
  attr: 'string',
  'selector-attr': 'string',

  number: 'number',
  symbol: 'number',
  'selector-id': 'number',
  variable: 'number',
  'variable constant_': 'number',
  'variable language_': 'number',
  bullet: 'number',
  link: 'number',
};

/**
 * The languages auto-detection is allowed to pick from.
 *
 * Unrestricted `highlightAuto` is unusable on short snippets. Measured against
 * real one-liners it chose **ada** for a JavaScript function, **ruby** for
 * Python, and **n1ql** for SQL — and a relevance floor does not save it, since
 * Ada scored *higher* (5) than JavaScript (4) on the same input. Restricted to
 * this list it gets all three right.
 *
 * The list is what chat platforms actually emit in fenced blocks. Adding to it
 * is cheap; leaving it unrestricted is not.
 */
const AUTO_DETECT_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'json',
  'bash',
  'shell',
  'xml',
  'css',
  'sql',
  'java',
  'go',
  'rust',
  'c',
  'cpp',
  'yaml',
  'diff',
  'markdown',
];

/** Resolve an hljs class attribute (e.g. `hljs-title function_`) to a class. */
export function classForScope(classAttr: string): CodeTokenClass {
  const scope = classAttr
    .split(/\s+/)
    .filter((c) => c !== 'hljs')
    .map((c) => c.replace(/^hljs-/, ''))
    .join(' ')
    .trim();
  if (!scope) return null;
  if (scope in SCOPE_TO_CLASS) return SCOPE_TO_CLASS[scope] ?? null;
  // `hljs-title function_` etc.: fall back to the leading scope word.
  const head = scope.split(' ')[0];
  return (head ? SCOPE_TO_CLASS[head] : null) ?? null;
}

/**
 * hljs's HTML output -> a flat token list.
 *
 * Nested spans take the INNERMOST class that resolves to one of the five, which
 * is what a reader expects: in `<span class="hljs-string">"<span
 * class="hljs-subst">${x}</span>"</span>` the substitution is the interesting
 * part, not the surrounding quote.
 */
export function tokenizeHighlighted(html: string, doc: Document): CodeToken[] {
  const container = doc.createElement('div');
  container.innerHTML = html;

  const tokens: CodeToken[] = [];
  const walk = (node: Node, inherited: CodeTokenClass): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const text = child.textContent ?? '';
        if (text) tokens.push({ text, cls: inherited });
        continue;
      }
      if (child.nodeType === 1) {
        const el = child as Element;
        const own = classForScope(el.getAttribute('class') ?? '');
        walk(el, own ?? inherited);
      }
    }
  };
  walk(container, null);

  // Merge adjacent runs of the same class so a consumer draws one segment
  // instead of one per character-ish fragment.
  return tokens.reduce<CodeToken[]>((acc, token) => {
    const last = acc[acc.length - 1];
    if (last?.cls === token.cls) {
      last.text += token.text;
      return acc;
    }
    acc.push({ ...token });
    return acc;
  }, []);
}

/** The hljs surface this module needs, so callers can inject a stub in tests. */
export interface Highlighter {
  highlight(
    code: string,
    options: { language: string; ignoreIllegals?: boolean }
  ): {
    value: string;
  };
  highlightAuto(code: string, languageSubset?: string[]): { value: string };
  getLanguage(name: string): unknown;
}

/**
 * Load highlight.js on demand.
 *
 * Dynamic so it joins the lazily-loaded exporter chunk rather than the eager
 * content-script bundle. Returns null if it cannot be loaded, so a failure
 * degrades to uncoloured code rather than a failed export.
 */
export async function loadHighlighter(): Promise<Highlighter | null> {
  try {
    const mod = await import('highlight.js');
    return mod.default;
  } catch {
    return null;
  }
}

/**
 * Tokenize a code block into the five classes.
 *
 * A block with a known language is highlighted as that language. A block with no
 * language — or one hljs does not know — falls back to auto-detection over
 * `AUTO_DETECT_LANGUAGES`, because chat platforms do not always label their
 * fences and the highlighter this replaced coloured every block regardless.
 * Dropping colour for unlabelled code would have been a silent regression.
 *
 * Never throws: a highlighter that chokes on a snippet must not fail the export,
 * so the fallback is always the code itself, uncoloured.
 */
export function highlightCode(
  code: string,
  language: string | undefined,
  highlighter: Highlighter | null,
  doc: Document | undefined
): CodeToken[] {
  const plain: CodeToken[] = [{ text: code, cls: null }];
  if (!highlighter || !doc || !code) return plain;
  try {
    const known = language && highlighter.getLanguage(language);
    const { value } = known
      ? highlighter.highlight(code, { language, ignoreIllegals: true })
      : highlighter.highlightAuto(code, AUTO_DETECT_LANGUAGES);
    const tokens = tokenizeHighlighted(value, doc);
    return tokens.length > 0 ? tokens : plain;
  } catch {
    return plain;
  }
}

/**
 * Split a token list at newlines, so a consumer that draws line by line (pdf) or
 * needs an explicit break per line (docx) can walk lines without re-tokenizing.
 *
 * A token spanning a newline becomes one token per line, each keeping its class.
 * Empty lines survive as empty arrays, so line numbering stays faithful to the
 * source.
 */
export function tokenLines(tokens: CodeToken[]): CodeToken[][] {
  const lines: CodeToken[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      const current = lines[lines.length - 1];
      if (part && current) current.push({ text: part, cls: token.cls });
    });
  }
  return lines;
}

/**
 * Escape text for embedding in HTML.
 *
 * Used as the fenced-code renderer passed to `loadMarkdownRenderer` by
 * consumers (pdf, docx) whose own code-block renderer re-derives highlighting
 * from the parsed block's plain text rather than from this markup — so it
 * only needs to be inert, not coloured.
 */
export function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Load `marked` on demand and return a Markdown -> sanitized-HTML function.
 *
 * Dynamic for the same reason as the highlighter: it belongs in the lazily-loaded
 * exporter chunk, not the eager content script.
 *
 * The output is sanitized before it is returned. `marked` passes raw inline HTML
 * through by default, and an artifact's content is scraped from the page, so this
 * is a re-injection point into a file the reader will open and the browser will
 * render. Returns null on any failure — including no DOM to sanitize with — so
 * the caller falls back to showing the source rather than emitting unsanitized
 * markup.
 */
export async function loadMarkdownRenderer(
  highlighter: Highlighter | null,
  renderCode: (code: string, language: string | undefined) => string
): Promise<((md: string) => string | null) | null> {
  try {
    const [{ marked }, { sanitizeHtml }, { requireDoubleTildeStrikethrough }] = await Promise.all([
      import('marked'),
      import('../utils/sanitize-html'),
      import('../utils/markdown-options'),
    ]);
    marked.setOptions({ gfm: true, breaks: false });
    requireDoubleTildeStrikethrough(marked);

    // A code fence inside a prose artifact goes through the same five-token
    // renderer as any other code block. Without this, one document would show
    // highlighted code in a message and unhighlighted code in a research report.
    marked.use({
      renderer: {
        code({ text, lang }) {
          const language = lang && highlighter?.getLanguage(lang) ? lang : undefined;
          return `<pre><code class="language-${language ?? 'plaintext'}">${renderCode(text, language)}</code></pre>`;
        },
      },
    });

    return (md: string): string | null => {
      try {
        if (typeof globalThis.document === 'undefined') return null;
        const html = marked.parse(md, { async: false });
        return typeof html === 'string' ? sanitizeHtml(html) : null;
      } catch {
        return null;
      }
    };
  } catch {
    return null;
  }
}
