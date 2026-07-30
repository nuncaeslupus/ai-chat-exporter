/**
 * Shared `marked` configuration for both markdown-rendering call sites
 * (`code-highlight.ts`'s `loadMarkdownRenderer`, used by pdf/docx/html, and
 * `content-script.ts`'s print path).
 *
 * GFM's default strikethrough rule accepts a SINGLE `~` as a delimiter, so
 * prose that uses `~` to mean "approximately" (e.g. "~64 days") gets parsed
 * as `<del>` and the tilde characters are silently deleted — corrupting text
 * the source page rendered literally. Disabling `gfm` entirely would also
 * lose tables, autolinks and task lists, so instead this overrides just the
 * `del` tokenizer to require **two** tildes, matching GitHub's own behavior
 * for `~~strikethrough~~` while leaving a lone `~` alone.
 */
import type { MarkedExtension } from 'marked';

/** GFM's del regex (from marked's source) with the opening/closing delimiter narrowed to exactly `~~`. */
const STRICT_DEL_RULE = /^~~(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))~~(?=[^~]|$)/;

/**
 * Structural type for what `use()` needs: both the `marked` singleton
 * (a callable namespace, not a `Marked` class instance) and a standalone
 * `Marked` instance satisfy this.
 */
interface UsesMarkedExtensions {
  use(extension: MarkedExtension): unknown;
}

export function requireDoubleTildeStrikethrough(markedInstance: UsesMarkedExtensions): void {
  markedInstance.use({
    tokenizer: {
      del(src) {
        const match = STRICT_DEL_RULE.exec(src);
        const text = match?.[1];
        if (!match || text === undefined) return undefined;
        return {
          type: 'del',
          raw: match[0],
          text,
          tokens: this.lexer.inlineTokens(text),
        };
      },
    },
  });
}
