/**
 * Popup shell — view router and fixed body box (lo-c39f).
 *
 * The redesign's whole premise is that the popup is one fixed box — 48+260 as
 * drawn, 56+320 since R11 scaled it up: the view swaps inside it and the box
 * never changes. These tests assert the state machine (which container is
 * visible, which UI state is recorded), not rendered pixel values — jsdom has
 * no layout engine, so heights are guarded by the class staying put rather
 * than by measurement. The declared numbers are guarded at the bottom of this
 * file, straight off popup.css.
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
  const triggers = VIEWS.map((name) => `<button data-nav="${name}" id="nav-${name}"></button>`)
    .join('');
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
});

/*
 * The box's declared size and the type scale, read straight out of popup.css.
 * jsdom cannot lay the popup out, so these guard the *declarations* the browser
 * measurements were taken against: 420x(56+320), and every font size coming
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
    ['--popup-width', '420px'],
    ['--header-height', '56px'],
    ['--body-height', '320px'],
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
