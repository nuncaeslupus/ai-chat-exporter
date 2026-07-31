/**
 * flattenElementText (D-35) -- see src/core/utils/dom-text.ts for the
 * boundary rules this replaces plain `textContent` with.
 */

import { describe, it, expect } from 'vitest';
import { flattenElementText, boundaryLevelForTag } from '../../../../src/core/utils/dom-text';

function elementFrom(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

describe('flattenElementText', () => {
  it('never joins two cells of a div-based grid with no separator', () => {
    const el = elementFrom(
      '<div><div>Jurisdicción</div><div>Impuesto (Acrónimo)</div><div>Tasa Impositiva</div></div>'
    );
    const text = flattenElementText(el);
    expect(text).not.toContain('JurisdicciónImpuesto');
    expect(text).not.toContain('(Acrónimo)Tasa');
  });

  it('separates real <td>/<th> cells with " | " and rows with a newline', () => {
    const el = elementFrom(
      '<table><tr><th>Base</th><th>Cuota</th><th>Pct</th></tr>' +
        '<tr><td>Hasta 6.000 EUR</td><td>0 EUR</td><td>19%</td></tr></table>'
    );
    const text = flattenElementText(el);
    expect(text).toBe('Base | Cuota | Pct\nHasta 6.000 EUR | 0 EUR | 19%');
  });

  it('never joins the exact "0 EUR" / "19%" pair from the real export', () => {
    const el = elementFrom('<table><tr><td>0 EUR</td><td>19%</td></tr></table>');
    expect(flattenElementText(el)).not.toContain('0 EUR19%');
  });

  it('keeps a lone "–" cell distinct from its neighbours', () => {
    const el = elementFrom('<table><tr><td>Ajuste</td><td>–</td><td>0%</td></tr></table>');
    const text = flattenElementText(el);
    expect(text).not.toContain('Ajuste–');
    expect(text).not.toContain('–0%');
  });

  it('keeps two identical adjacent cells distinct rather than merging into one run', () => {
    const el = elementFrom('<table><tr><td>EUR</td><td>EUR</td></tr></table>');
    const text = flattenElementText(el);
    expect(text).toBe('EUR | EUR');
  });

  it('separates adjacent block siblings (div, p, li, heading+list) with a newline', () => {
    const el = elementFrom('<div>First block</div><div>Second block</div>');
    expect(flattenElementText(el)).toBe('First block\nSecond block');
  });

  it('separates a heading immediately followed by a list', () => {
    const el = elementFrom('<h2>Section Title</h2><ul><li>Item one</li><li>Item two</li></ul>');
    const text = flattenElementText(el);
    expect(text).not.toContain('Section TitleItem one');
    expect(text).toBe('Section Title\nItem one\nItem two');
  });

  it('never inserts a boundary inside an inline run (no regression)', () => {
    const el = elementFrom(
      '<p>The <strong>quick</strong> fox jumps over the <em>lazy</em> dog.</p>'
    );
    expect(flattenElementText(el).trim()).toBe('The quick fox jumps over the lazy dog.');
  });

  it('keeps <pre>/<code> content byte-exact, whitespace included', () => {
    const el = elementFrom('<div>before<pre>  keep\n\tthis   exactly  </pre>after</div>');
    const text = flattenElementText(el);
    expect(text).toContain('  keep\n\tthis   exactly  ');
  });

  it('collapses pretty-printed indentation to nothing (no leaking newlines into prose)', () => {
    const el = elementFrom('<p>Hello\n            <span>world</span>\n          .</p>');
    const text = flattenElementText(el);
    expect(text).not.toContain('\n');
  });
});

describe('boundaryLevelForTag', () => {
  it('classifies table cells as level 1', () => {
    expect(boundaryLevelForTag('td')).toBe(1);
    expect(boundaryLevelForTag('th')).toBe(1);
  });

  it('classifies block-level tags as level 2', () => {
    for (const tag of ['div', 'p', 'li', 'tr', 'section', 'h1', 'table', 'blockquote', 'ul']) {
      expect(boundaryLevelForTag(tag)).toBe(2);
    }
  });

  it('classifies inline tags as level 0 (no boundary)', () => {
    for (const tag of ['span', 'a', 'em', 'strong', 'code', 'sup', 'b', 'i']) {
      expect(boundaryLevelForTag(tag)).toBe(0);
    }
  });
});
