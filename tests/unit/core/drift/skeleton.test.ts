/**
 * SkeletonBuilder. The leak property test below is the single most important
 * test in the drift feature: it is the entire basis for telling users that
 * nothing but structure is sent, and it is the invariant a future refactor
 * could quietly break.
 */
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildSkeleton } from '../../../../src/core/drift/skeleton';

function rootOf(html: string): Element {
  const doc = new JSDOM(`<body>${html}</body>`).window.document;
  return doc.body.firstElementChild!;
}

describe('buildSkeleton', () => {
  it('emits tag names, classes and attribute names', () => {
    const skeleton = buildSkeleton(
      rootOf('<main id="main"><div data-testid="x" class="a b">hi</div></main>')
    );
    expect(skeleton).toContain('main');
    expect(skeleton).toContain('div');
    expect(skeleton).toContain('a b');
    expect(skeleton).toContain('data-testid');
  });

  it('replaces every text node with its character count', () => {
    const skeleton = buildSkeleton(rootOf('<div><p>hello world</p></div>'));
    expect(skeleton).toContain('text(11)');
    expect(skeleton).not.toContain('hello');
  });

  it('keeps safelisted attribute values', () => {
    const skeleton = buildSkeleton(rootOf('<div data-turn="assistant" role="button"></div>'));
    expect(skeleton).toContain('data-turn="assistant"');
    expect(skeleton).toContain('role="button"');
  });

  it('drops non-safelisted attribute values but keeps their names', () => {
    const skeleton = buildSkeleton(
      rootOf('<div aria-label="Artifact panel: Q3 revenue plan" data-turn-id="ab-12"></div>')
    );
    expect(skeleton).toContain('aria-label');
    expect(skeleton).not.toContain('Q3 revenue plan');
    expect(skeleton).toContain('data-turn-id');
    expect(skeleton).not.toContain('ab-12');
  });

  // THE LEAK PROPERTY TEST — invariant 2 of the spec.
  it('leaks none of the distinctive strings seeded into the DOM', () => {
    const secrets = [
      'ZZQXSECRETONE',
      'ZZQXSECRETTWO',
      'ZZQXSECRETTHREE',
      'ZZQXSECRETFOUR',
      'ZZQXSECRETFIVE',
      'ZZQXSECRETSIX',
    ];
    const root = rootOf(`
      <main title="${secrets[0]}">
        <h1>${secrets[1]}</h1>
        <div data-turn="user" aria-label="${secrets[2]}" data-message-id="${secrets[3]}">
          <p class="whitespace-pre-wrap">${secrets[4]}</p>
          <img alt="${secrets[5]}" src="https://example.com/${secrets[5]}.png">
        </div>
      </main>
    `);

    const skeleton = buildSkeleton(root);

    for (const secret of secrets) {
      expect(skeleton).not.toContain(secret);
    }
  });

  it('does not leak comment nodes', () => {
    const skeleton = buildSkeleton(rootOf('<div><!-- ZZQXCOMMENT --></div>'));
    expect(skeleton).not.toContain('ZZQXCOMMENT');
  });

  it('truncates with an explicit elision marker instead of dropping', () => {
    const many = Array.from({ length: 50 }, (_, i) => `<div class="n${i}"></div>`).join('');
    const skeleton = buildSkeleton(rootOf(`<main>${many}</main>`), { maxNodes: 10 });
    expect(skeleton).toMatch(/elided \d+ nodes/);
    expect(skeleton).toContain('main');
  });

  it('respects the depth limit', () => {
    let html = '<span class="deepest"></span>';
    for (let i = 0; i < 20; i++) html = `<div class="d${i}">${html}</div>`;
    const skeleton = buildSkeleton(rootOf(html), { maxDepth: 3 });
    expect(skeleton).not.toContain('deepest');
  });

  it('never throws on a detached or empty element', () => {
    expect(() => buildSkeleton(rootOf('<div></div>'))).not.toThrow();
  });
});
