/**
 * Popup shell — view router and fixed body box (lo-c39f).
 *
 * The redesign's whole premise is that the popup is one fixed box — 48+260 as
 * drawn, 56+320 since R11 scaled it up, 56+340 since the P-5 spacing pass: the
 * view swaps inside it and the box never changes size between states. These
 * tests assert the state machine (which container is visible, which UI state
 * is recorded), not rendered pixel values — jsdom has no layout engine, so
 * heights are guarded by the class staying put rather than by measurement.
 * The declared numbers are guarded at the bottom of this file, straight off
 * popup.css.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createTestQAPair } from '../../../utils/exporter-helpers';

const POPUP_HTML = readFileSync(
  resolve(__dirname, '../../../../src/extension/popup/popup.html'),
  'utf-8'
);
/**
 * Drive the real popup.html rather than a hand-written subset, so a container
 * renamed in the markup fails here instead of silently breaking the router.
 * Scripts inserted via innerHTML never execute in jsdom, so the <script> tag
 * is inert.
 */
const POPUP_BODY = /<body>([\s\S]*)<\/body>/.exec(POPUP_HTML)?.[1] ?? '';

const VIEWS = ['main', 'content', 'options', 'filename'] as const;

const mockTabsQuery = vi.fn();
const mockTabsSendMessage = vi.fn();

const CONVERSATION = {
  id: 'conv-1',
  title: 'Test conversation',
  platform: 'claude',
  pairs: [createTestQAPair(0, 'First question', 'First answer')],
  url: 'https://claude.ai/chat/abc',
};

function mockChrome() {
  Object.assign(chrome, {
    tabs: { query: mockTabsQuery, sendMessage: mockTabsSendMessage, create: vi.fn() },
    runtime: { getManifest: () => ({ version: '9.9.9' }) },
    i18n: {
      getUILanguage: () => 'en',
      getMessage: (key: string) => key,
    },
  });
}

function bodyBox(): HTMLElement {
  const el = document.getElementById('popup-body');
  if (!el) throw new Error('popup-body missing from popup.html');
  return el;
}

function visibleViews(): string[] {
  return VIEWS.filter((name) => document.getElementById(`view-${name}`)?.hidden === false);
}

/**
 * Boot the popup against the real markup, plus one nav trigger per view.
 * The module is imported once for the whole file (no resetModules): the
 * router's listeners live on the document, and a second module instance would
 * leave a second controller handling every click.
 */
async function loadPopup(): Promise<void> {
  document.body.innerHTML = POPUP_BODY;
  // Nav triggers stand in for the rows the later view tasks will add; the
  // router is delegated, so `data-nav` is the whole contract between them.
  const triggers = VIEWS.map(
    (name) => `<button data-nav="${name}" id="nav-${name}"></button>`
  ).join('');
  document.body.insertAdjacentHTML('beforeend', triggers);
  await import('../../../../src/extension/popup/popup');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => {
    expect(bodyBox().dataset.view).toBe('main');
  });
}

/** Wait until the page check has finished and the export button is live. */
async function loadReadyPopup(): Promise<void> {
  await loadPopup();
  await vi.waitFor(() => {
    expect((document.getElementById('export-button') as HTMLButtonElement).disabled).toBe(false);
  });
}

function navigateTo(view: string): void {
  document.getElementById(`nav-${view}`)?.click();
}

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

describe('popup view router', () => {
  beforeEach(() => {
    mockTabsQuery.mockReset();
    mockTabsSendMessage.mockReset();
    mockChrome();
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
    mockTabsSendMessage.mockResolvedValue({ success: true, data: CONVERSATION });
  });

  it('starts on the main view with exactly one container visible', async () => {
    await loadPopup();
    expect(visibleViews()).toEqual(['main']);
  });

  it.each(VIEWS)('shows exactly the %s view container when routed to it', async (view) => {
    await loadPopup();
    navigateTo(view);
    expect(visibleViews()).toEqual([view]);
    expect(bodyBox().dataset.view).toBe(view);
  });

  it.each(['content', 'options', 'filename'])('Esc returns to main from %s', async (view) => {
    await loadPopup();
    navigateTo(view);
    expect(bodyBox().dataset.view).toBe(view);

    pressEscape();

    expect(bodyBox().dataset.view).toBe('main');
    expect(visibleViews()).toEqual(['main']);
  });

  it('Esc on the main view is a no-op', async () => {
    await loadPopup();
    pressEscape();
    expect(visibleViews()).toEqual(['main']);
  });

  it('tracks the format menu separately, and Esc closes it before leaving the view', async () => {
    await loadPopup();
    document.body.insertAdjacentHTML('beforeend', '<button data-format-menu-toggle></button>');
    navigateTo('content');

    document.querySelector<HTMLElement>('[data-format-menu-toggle]')?.click();
    expect(bodyBox().dataset.formatMenuOpen).toBe('true');

    // First Esc closes the menu and keeps the view...
    pressEscape();
    expect(bodyBox().dataset.formatMenuOpen).toBe('false');
    expect(bodyBox().dataset.view).toBe('content');

    // ...the second backs out to main.
    pressEscape();
    expect(bodyBox().dataset.view).toBe('main');
  });

  it('closes the format menu on a click outside it', async () => {
    await loadPopup();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button data-format-menu-toggle></button><div data-format-menu><button id="in-menu"></button></div>'
    );

    document.querySelector<HTMLElement>('[data-format-menu-toggle]')?.click();
    document.getElementById('in-menu')?.click();
    expect(bodyBox().dataset.formatMenuOpen).toBe('true');

    document.getElementById('conversation-title')?.click();
    expect(bodyBox().dataset.formatMenuOpen).toBe('false');
  });
});

/**
 * A11Y-1: view changes used to only flip `hidden` — the trigger that was just
 * activated lives inside the section being hidden, so the browser blurred it
 * and focus fell back to `<body>`. These assert focus actually lands
 * somewhere real on every hop, forward and back.
 */
describe('popup focus management', () => {
  beforeEach(() => {
    mockTabsQuery.mockReset();
    mockTabsSendMessage.mockReset();
    mockChrome();
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
    mockTabsSendMessage.mockResolvedValue({ success: true, data: CONVERSATION });
  });

  it('moves focus into the new view when navigating away from main', async () => {
    await loadPopup();
    navigateTo('content');

    expect(document.getElementById('view-content')?.contains(document.activeElement)).toBe(true);
  });

  it('restores focus to the trigger that opened a view, on the way back', async () => {
    await loadPopup();
    const trigger = document.getElementById('nav-content')!;
    navigateTo('content');

    pressEscape();

    expect(document.activeElement).toBe(trigger);
  });

  it('does not re-focus a trigger that is no longer reachable, and falls back to the heading', async () => {
    await loadPopup();
    const trigger = document.getElementById('nav-content')!;
    navigateTo('content');
    // Simulate the trigger having left the document between the forward hop
    // and the return trip (e.g. a re-render).
    trigger.remove();

    pressEscape();

    expect(document.activeElement).not.toBe(document.body);
    expect(document.getElementById('view-main')?.contains(document.activeElement)).toBe(true);
  });

  it('sets the document language from the UI locale', async () => {
    await loadPopup();
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('popup fixed body box', () => {
  beforeEach(() => {
    mockTabsQuery.mockReset();
    mockTabsSendMessage.mockReset();
    mockChrome();
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://claude.ai/chat/abc' }]);
  });

  /** Every state must leave the box's height-bearing class untouched. */
  function expectBoxIntact(): void {
    expect(bodyBox().classList.contains('popup-body')).toBe(true);
    expect(bodyBox().tagName).toBe('MAIN');
  }

  it('stays in the detecting state, in the box, until the page check resolves', async () => {
    mockTabsQuery.mockReturnValue(new Promise(() => undefined));
    await loadPopup();
    expect(bodyBox().dataset.uiState).toBe('detecting');
    expectBoxIntact();
  });

  it('reports ready on a supported page', async () => {
    mockTabsSendMessage.mockResolvedValue({ success: true, data: CONVERSATION });
    await loadPopup();
    await vi.waitFor(() => {
      expect(bodyBox().dataset.uiState).toBe('ready');
    });
    expectBoxIntact();
  });

  it('reports noSelection once every pair is deselected, and back to ready', async () => {
    mockTabsSendMessage.mockResolvedValue({ success: true, data: CONVERSATION });
    await loadPopup();
    await vi.waitFor(() => {
      expect(bodyBox().dataset.uiState).toBe('ready');
    });

    const toggleAll = document.getElementById('qa-selection-toggle-all');
    toggleAll?.click();
    expect(bodyBox().dataset.uiState).toBe('noSelection');
    expectBoxIntact();

    toggleAll?.click();
    expect(bodyBox().dataset.uiState).toBe('ready');
  });

  it('reports unsupported on a page with no parser', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com/' }]);
    await loadPopup();
    await vi.waitFor(() => {
      expect(bodyBox().dataset.uiState).toBe('unsupported');
    });
    expectBoxIntact();
  });

  it('reports reload when the content script does not answer', async () => {
    mockTabsSendMessage.mockRejectedValue(new Error('no receiving end'));
    await loadPopup();
    await vi.waitFor(() => {
      expect(bodyBox().dataset.uiState).toBe('reload');
    });
    expectBoxIntact();
  });

  it('reports warning on a degraded export', async () => {
    mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) =>
      message.type === 'get_conversation'
        ? Promise.resolve({ success: true, data: CONVERSATION })
        : Promise.resolve({ success: true, warning: 'artifacts missing' })
    );
    await loadReadyPopup();
    document.getElementById('export-button')?.click();
    await vi.waitFor(() => {
      expect(bodyBox().dataset.uiState).toBe('warning');
    });
    expectBoxIntact();
  });

  it('reports error when the export fails outright', async () => {
    mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) =>
      message.type === 'get_conversation'
        ? Promise.resolve({ success: true, data: CONVERSATION })
        : Promise.resolve({ success: false, error: 'boom' })
    );
    await loadReadyPopup();
    document.getElementById('export-button')?.click();
    await vi.waitFor(() => {
      expect(bodyBox().dataset.uiState).toBe('error');
    });
    expectBoxIntact();
  });

  it('puts the failure detail in a visible panel, not only the header tooltip', async () => {
    mockTabsSendMessage.mockImplementation((_tabId: number, message: { type: string }) =>
      message.type === 'get_conversation'
        ? Promise.resolve({ success: true, data: CONVERSATION })
        : Promise.resolve({ success: false, error: 'boom' })
    );
    await loadReadyPopup();
    document.getElementById('export-button')?.click();
    await vi.waitFor(() => {
      expect(bodyBox().dataset.uiState).toBe('error');
    });

    expect(document.getElementById('error-card-detail')?.textContent).toContain('boom');
  });
});

/*
 * The box's declared size and the type scale, read straight out of popup.css.
 * jsdom cannot lay the popup out, so these guard the *declarations* the browser
 * measurements were taken against: 428x(56+320), and every font size coming
 * from one token block so the next resize is that block and nothing else.
 */
const POPUP_CSS = readFileSync(
  resolve(__dirname, '../../../../src/extension/popup/popup.css'),
  'utf-8'
);

/** The `:root` block — where every token must be declared. */
const ROOT_BLOCK = /:root\s*\{([\s\S]*?)\n\}/.exec(POPUP_CSS)?.[1] ?? '';

describe('popup geometry and type tokens', () => {
  it.each([
    ['--popup-width', '436px'],
    ['--header-height', '56px'],
    ['--body-height', '340px'],
  ])('declares %s as %s', (token, value) => {
    expect(ROOT_BLOCK).toContain(`${token}: ${value};`);
  });

  it('takes every font size from a type-scale token, never a literal', () => {
    const outsideRoot = POPUP_CSS.replace(ROOT_BLOCK, '');
    const literals = outsideRoot
      .split('\n')
      .filter((line) => /^\s*font-size:/.test(line) && !line.includes('var(--text-'));
    expect(literals).toEqual([]);
  });

  it('declares every type token it uses', () => {
    const used = new Set(
      [...POPUP_CSS.matchAll(/var\((--text-[\w-]+)\)/g)].map((match) => match[1])
    );
    expect(used.size).toBeGreaterThan(0);
    for (const token of used) {
      expect(ROOT_BLOCK).toMatch(new RegExp(`${token}:\\s*[\\d.]+px;`));
    }
  });

  /*
   * The action bar is the one part R11 did not scale — the author's call was
   * that it already reads at the right size. It gets its own off-scale token so
   * a future bump of the scale cannot drag the button along with it.
   */
  it.each([
    ['--text-action: 14px', ROOT_BLOCK],
    ['height: 50px', /\.split-button\s*\{([^}]*)\}/.exec(POPUP_CSS)?.[1] ?? ''],
    ['width: 42px', /\.split-toggle\s*\{([^}]*)\}/.exec(POPUP_CSS)?.[1] ?? ''],
    ['width: 50px', /\.print-button\s*\{([^}]*)\}/.exec(POPUP_CSS)?.[1] ?? ''],
    ['height: 50px', /\.print-button\s*\{([^}]*)\}/.exec(POPUP_CSS)?.[1] ?? ''],
  ])('keeps the action bar at its 5a size: %s', (declaration, block) => {
    expect(block).toContain(declaration);
  });

  it('sizes the export label off the action token, not the scale', () => {
    const block = /\.split-export\s*\{([^}]*)\}/.exec(POPUP_CSS)?.[1] ?? '';
    expect(block).toContain('font-size: var(--text-action);');
  });
});

describe('popup CSS accessibility rules', () => {
  it('never removes the keyboard focus outline from the free-text chip input', () => {
    // The global `:focus-visible` rule must be the only thing governing this
    // input's focus ring -- a per-element `outline: none` on
    // `.filename-chip-input:focus` used to win on specificity and leave
    // keyboard focus on that field with no visible indicator at all.
    expect(POPUP_CSS).not.toMatch(/\.filename-chip-input:focus\s*\{[^}]*outline:\s*none/);
  });

  it('shows a focus indicator on the chip when its input is focused', () => {
    expect(POPUP_CSS).toMatch(/\.filename-chip:focus-within\s*\{[^}]*box-shadow/);
  });

  it('honours prefers-reduced-motion', () => {
    expect(POPUP_CSS).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/);
  });

  it('declares an error-card, shown only in the error ui-state', () => {
    expect(POPUP_CSS).toMatch(/\.popup-body\[data-ui-state='error'\]\s*\.error-card\s*\{/);
  });

  it('gives the split button halves their own focus ring, since .split-button clips the global outline', () => {
    // `.split-button` sets `overflow: hidden` to clip its two halves to its
    // own radius, which also clips 3 of the 4 sides of the global
    // `:focus-visible` outline (it paints outside the child's border box).
    // An inset box-shadow survives the clip.
    expect(POPUP_CSS).toMatch(
      /\.split-export:focus-visible,\s*\n\.split-toggle:focus-visible\s*\{[^}]*box-shadow:\s*inset/
    );
  });

  it('makes the dimmed backdrop behind the open format menu inert to clicks', () => {
    // Without `pointer-events: none`, a click through the dimmed
    // `.view-scroll` / `.setting-rows` still hit whatever was under it (e.g.
    // the Content row), navigating away while leaving the menu open.
    const block =
      /\.popup-body\[data-format-menu-open='true'\] \.view-scroll,\s*\n\.popup-body\[data-format-menu-open='true'\] \.setting-rows\s*\{([^}]*)\}/.exec(
        POPUP_CSS
      )?.[1] ?? '';
    expect(block).toContain('pointer-events: none');
  });
});

describe('popup layout comment stays honest about the box size', () => {
  it('documents the body box at its real 340px/396px size, not the pre-P5 320px/378px', () => {
    expect(POPUP_HTML).not.toMatch(/320px body/);
    expect(POPUP_HTML).not.toMatch(/378px tall/);
    expect(POPUP_HTML).toMatch(/340px body/);
    expect(POPUP_HTML).toMatch(/396px tall/);
  });
});

describe('popup CSS style consistency (POPUP-1)', () => {
  it('keeps the noSelection Content row on --content-column instead of a flat 10px inset that breaks alignment with the Options row below it', () => {
    const block =
      /\.popup-body\[data-ui-state='noSelection'\] \.setting-row\[data-nav='content'\]\s*\{([^}]*)\}/.exec(
        POPUP_CSS
      )?.[1] ?? '';
    expect(block).not.toMatch(/padding:\s*0\s*10px/);
  });

  it('puts the drift row and drift report on the type scale instead of the inherited 16px body size', () => {
    const titleBlock = /\.drift-row-title\s*\{([^}]*)\}/.exec(POPUP_CSS)?.[1] ?? '';
    const detailBlock = /\.drift-row-detail\s*\{([^}]*)\}/.exec(POPUP_CSS)?.[1] ?? '';
    const actionBlock = /\.drift-row-action\s*\{([^}]*)\}/.exec(POPUP_CSS)?.[1] ?? '';
    const introBlock = /\.drift-report-intro\s*\{([^}]*)\}/.exec(POPUP_CSS)?.[1] ?? '';
    const statusBlock = /\.drift-report-status\s*\{([^}]*)\}/.exec(POPUP_CSS)?.[1] ?? '';

    expect(titleBlock).toContain('font-size: var(--text-base)');
    for (const block of [detailBlock, actionBlock, introBlock, statusBlock]) {
      expect(block).toContain('font-size: var(--text-sm)');
    }
  });

  it('insets the drift report body from --pad-x, matching the header/footer of the same view', () => {
    // `.drift-report-body` also appears in the scrollbar-styling selector
    // list further up the file, so this checks its own rule's declarations
    // by exact text rather than a regex that could match the wrong block.
    expect(POPUP_CSS).toContain(
      '.drift-report-body {\n  flex: 1;\n  min-height: 0;\n  overflow-y: auto;\n  padding: 0 var(--pad-x);\n}'
    );
  });

  it('gives the drift row, the retry link, and the file-name nav row a hover state like their siblings', () => {
    expect(POPUP_CSS).toMatch(/\.drift-row:hover\s*\{/);
    expect(POPUP_CSS).toMatch(
      /\.warning-card-retry:hover\s*\{[^}]*color:\s*var\(--color-warning-action\)/
    );
    expect(POPUP_CSS).toMatch(
      /\.option-row--nav:hover\s*\{[^}]*background:\s*var\(--color-surface-sunken\)/
    );
  });

  it('tokenizes the drift row / skeleton radii instead of hardcoded literals', () => {
    expect(POPUP_CSS).not.toMatch(/\.drift-row\s*\{[^}]*border-radius:\s*8px/);
    expect(POPUP_CSS).not.toMatch(/\.drift-report-preview\s*\{[^}]*border-radius:\s*6px/);
    expect(POPUP_CSS).not.toMatch(/\.skeleton--row\s*\{[^}]*border-radius:\s*6px/);
    // Aligned with `.warning-card`, the sibling amber block built the same
    // way, instead of its own one-off 8px.
    expect(POPUP_CSS).toMatch(/\.drift-row\s*\{[^}]*border-radius:\s*var\(--radius-lg\)/);
  });
});

/**
 * Back (the header chevron) and Done (a footer button) both did nothing but
 * return to the parent view, so every submenu shipped two controls that meant
 * the same thing. Asserted over the real markup for *all* submenus at once,
 * not view by view: the confusion was that it was everywhere, and a per-view
 * test lets the next new view reintroduce it unnoticed.
 */
describe('submenu exits', () => {
  const SUBMENUS = ['content', 'options', 'settings', 'report', 'filename'] as const;

  function view(name: string): Element {
    const section = document.getElementById(`view-${name}`);
    if (!section) throw new Error(`no view-${name} section in popup.html`);
    return section;
  }

  beforeEach(() => {
    document.body.innerHTML = POPUP_BODY;
  });

  it.each(SUBMENUS)('%s offers exactly one way back, and it is the chevron', (name) => {
    const exits = [...view(name).querySelectorAll('[data-nav]')].filter((el) =>
      el.matches('.submenu-back, .submenu-done')
    );

    expect(exits).toHaveLength(1);
    expect(exits[0]?.className).toContain('submenu-back');
  });

  it.each(SUBMENUS)('%s keeps its chevron reachable by name', (name) => {
    expect(view(name).querySelector('.submenu-back')?.getAttribute('data-i18n-label')).toBe(
      'submenuBack'
    );
  });

  // The one surviving `.submenu-done`: the Report view's "Copy & report" wears
  // the class for its filled-button styling, but it copies and opens an issue
  // rather than navigating, so it must never gain a `data-nav`.
  it("leaves the report view's primary action as an action, not a way out", () => {
    const action = document.getElementById('drift-report-copy-and-report');

    expect(action?.className).toContain('submenu-done');
    expect(action?.hasAttribute('data-nav')).toBe(false);
  });
});
