/**
 * Shared artifact-rendering predicate, used by every exporter that shows a
 * different body for prose vs. source (html, md, pdf, docx).
 */

import type { Artifact } from '../types';

/**
 * True when an artifact is prose — a deep-research report, a written
 * document — and should be rendered (headings, lists, tables), not shown as
 * a code block.
 *
 * Only `type === 'document'` qualifies. A `type: 'code'` artifact whose
 * `language` happens to be `'markdown'` (e.g. "show me the raw markdown for
 * this table") is source, not a document, and must stay a code block —
 * `language` alone must never flip an artifact to prose.
 */
export function isProseArtifact(artifact: Pick<Artifact, 'type'>): boolean {
  return artifact.type === 'document';
}
