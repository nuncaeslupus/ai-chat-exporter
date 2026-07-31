/**
 * Popup script for AI Chat Exporter extension
 */

import {
  createMessage,
  type GetConversationMessage,
  type ExportConversationMessage,
  type PrintConversationMessage,
  type MessageResponse,
} from '../../shared/messages';
import { sendTabMessage } from '../../shared/tab-messaging';
import type { Conversation, QAPair } from '../../core/types/conversation';
import { EXPORT_FORMATS, type ExportFormat, type FontScale } from '../../core/types/exporter';
import {
  getMessage,
  getMessageWithValues,
  formatNumber,
  getPlatformName,
  getUILanguage,
} from '../../shared/i18n';
import { parserRegistry } from '../../core/parsers';
import {
  DEFAULT_FILENAME_PIECES,
  type FilenamePiece,
  type FilenamePieceType,
  type ThemePreference,
} from '../../core/types/config';
import { StorageService } from '../../shared/storage';
import {
  DEFAULT_PREFERENCES,
  MESSAGE_TYPES,
  RETRYABLE_WARNING_KEYS,
  WARNING_KEYS,
} from '../../shared/constants';
import { SelectionService } from '../../core/services/selection-service';
import { FilenameService } from '../../core/services/filename-service';
import { formatDriftReport } from '../../core/drift/format-report';
import { isDriftSuppressed, suppressDrift } from '../../core/drift/suppression';
import { buildDriftIssueUrl } from '../../core/drift/issue-url';
import type { DriftReport } from '../../core/drift/types';

/**
 * The popup's views. Only one is visible at a time and they all render
 * inside the same fixed-height body box, so switching never resizes the popup.
 */
const VIEWS = ['main', 'content', 'options', 'filename', 'report', 'settings'] as const;
type PopupView = (typeof VIEWS)[number];

function isPopupView(value: string): value is PopupView {
  return (VIEWS as readonly string[]).includes(value);
}

/** What the body box is currently showing. Mirrored to `data-ui-state`. */
type UiState =
  | 'detecting'
  | 'ready'
  | 'noSelection'
  | 'warning'
  | 'unsupported'
  | 'noConversation'
  | 'reload'
  | 'error';

/**
 * Domains a platform is served from, canonical one first. The single list:
 * it gates which pages count as supported *and* supplies the home URL of the
 * unsupported screen's platform links.
 *
 * ponytail: a platform registered without an entry here still gets a link row
 * (it comes from `parserRegistry`), just an inert one. Move the domains into
 * `platformInfo` if that ever bites.
 */
function getUrlsForPlatform(platform: string): string[] {
  switch (platform) {
    case 'chatgpt':
      return ['chatgpt.com', 'chat.openai.com'];
    case 'claude':
      return ['claude.ai'];
    case 'gemini':
      return ['gemini.google.com'];
    default:
      return [];
  }
}

/**
 * Marks, not wordmarks: at 13–16px the Gemini logotype is illegible, so the
 * spark is the only readable Gemini asset here.
 */
const PLATFORM_ICONS: Record<string, string> = {
  chatgpt: '../assets/icons/chatgpt-logo.svg',
  claude: '../assets/icons/claude-logo.svg',
  gemini: '../assets/icons/gemini-spark.svg',
};

/**
 * Render the version from the manifest, the single source of truth. Hardcoding
 * it here previously left the popup advertising v1.0.0 while shipping 1.1.1.
 * It shows twice — header badge and Options footer — so every `data-version`
 * slot is filled rather than one hardcoded id per place it appears.
 */
function renderVersion(): void {
  const slots = document.querySelectorAll('[data-version]');
  if (slots.length === 0) return;
  const text = `v${chrome.runtime.getManifest().version}`;
  slots.forEach((el) => {
    el.textContent = text;
  });
}

/**
 * Build the unsupported screen's platform links straight off `parserRegistry`.
 *
 * One list, one source: a second hardcoded list is what kept Gemini out of the
 * popup long after its parser shipped. Registering a parser is all it takes to
 * appear here.
 */
function renderPlatformLinks(): void {
  const container = document.getElementById('platform-links');
  if (!container) return;

  container.replaceChildren(
    ...[...parserRegistry.keys()].map((platform) => {
      const name = getPlatformName(platform);
      const link = document.createElement('a');
      link.className = 'platform-link';
      const home = getUrlsForPlatform(platform)[0];
      if (home !== undefined) {
        const url = `https://${home}`;
        link.href = url;
        link.title = getMessageWithValues('platformLinkOpen', name);
        // Extension popups close on blur, so a new tab is the whole point —
        // but the popup must never navigate itself to the chat page.
        link.addEventListener('click', (event) => {
          event.preventDefault();
          void chrome.tabs.create({ url });
        });
      }

      const icon = PLATFORM_ICONS[platform];
      if (icon !== undefined) {
        const img = document.createElement('img');
        img.className = 'platform-link-icon';
        img.src = icon;
        img.alt = '';
        link.appendChild(img);
      }

      const label = document.createElement('span');
      label.className = 'platform-link-name';
      label.textContent = name;
      link.appendChild(label);

      link.insertAdjacentHTML(
        'beforeend',
        `<svg class="platform-link-external" width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M4 1.5h6.5V8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M10.5 1.5 4.5 7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M8 10.5H1.5V4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`
      );
      return link;
    })
  );
}

/**
 * Replace all elements with data-i18n attribute with their translated text.
 *
 * `data-i18n-label` is the icon-only variant: those buttons have no text node
 * to translate, so the string becomes their accessible name and tooltip.
 */
function localizeHtmlPage(): void {
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');
    if (key) {
      element.textContent = getMessage(key);
    }
  });

  document.querySelectorAll('[data-i18n-label]').forEach((element) => {
    const key = element.getAttribute('data-i18n-label');
    if (key) {
      const message = getMessage(key);
      element.setAttribute('aria-label', message);
      element.setAttribute('title', message);
    }
  });
}

/** Short, menu-ready name of each export format (`Export Markdown`). */
const FORMAT_NAME_KEYS: Record<ExportFormat, string> = {
  md: 'formatNameMD',
  pdf: 'formatNamePDF',
  html: 'formatNameHTML',
  docx: 'formatNameDOCX',
  txt: 'formatNameTXT',
  json: 'formatNameJSON',
};

function getFormatName(format: ExportFormat): string {
  return getMessage(FORMAT_NAME_KEYS[format]);
}

function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

/**
 * The span of days the conversation itself covers, e.g. `26–29 jul`.
 *
 * Read off the message timestamps, never off today's date: a chat exported
 * weeks later must still show when it happened. Returns `null` when no
 * message carries a usable timestamp — the meta line then drops the segment
 * rather than inventing one. Timestamps arrive over `chrome.tabs.sendMessage`,
 * which JSON-serialises `Date` to a string, so both shapes are accepted.
 */
function conversationDateRange(conversation: Conversation): string | null {
  const times = conversation.pairs
    .flatMap((pair) => [pair.question.timestamp, pair.answer.timestamp])
    .map((value) => (value === undefined ? NaN : new Date(value).getTime()))
    .filter((time) => !isNaN(time));

  if (times.length === 0) return null;

  const formatter = new Intl.DateTimeFormat(getUILanguage(), { day: 'numeric', month: 'short' });
  return formatter.formatRange(new Date(Math.min(...times)), new Date(Math.max(...times)));
}

/**
 * Roughly what fits in the row's two clamped lines. Past it the row grows a
 * `more` link. Measuring the real overflow needs layout the popup does not
 * have at render time, and the spec puts the cut at ≈120 characters anyway.
 */
const CLAMP_CHARS = 120;

/**
 * Where "Copy & report" sends the user. The report is already on their
 * clipboard by then — they paste it wherever they prefer, so this is a
 * convenience, not a submission endpoint. The extension posts nothing.
 * `buildDriftIssueUrl` prefills title/body/labels query params on top of
 * this base URL; it never carries them itself.
 */
const ISSUE_TRACKER_URL = 'https://github.com/nuncaeslupus/ai-chat-exporter/issues/new';

/**
 * ponytail: whitespace split. Undercounts CJK, which has no spaces — fine for
 * a footer estimate, swap in Intl.Segmenter if that ever matters.
 */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/**
 * The day a pair happened on, or `null` when neither of its messages carries a
 * usable timestamp. Timestamps cross `chrome.tabs.sendMessage`, which
 * JSON-serialises `Date` to a string, so both shapes are accepted.
 */
function pairDate(pair: QAPair): Date | null {
  for (const value of [pair.question.timestamp, pair.answer.timestamp]) {
    if (value === undefined) continue;
    const date = new Date(value);
    if (!isNaN(date.getTime())) return date;
  }
  return null;
}

/** Small builder so the row markup below stays readable. */
function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Every filename piece, in the order its add-chip is offered. A piece already
 * in the name drops out of the row; free text never does, since a name can
 * carry several literals.
 */
const PIECE_TYPES: FilenamePieceType[] = [
  'platform',
  'model',
  'time',
  'literal',
  'title',
  'date',
  'pairCount',
];

const PIECE_LABEL_KEYS: Record<FilenamePieceType, string> = {
  platform: 'filenamePiecePlatform',
  model: 'filenamePieceModel',
  title: 'filenamePieceTitle',
  date: 'filenamePieceDate',
  time: 'filenamePieceTime',
  pairCount: 'filenamePiecePairCount',
  literal: 'filenamePieceLiteral',
};

/** Own copy: the default list is a shared constant and must never be edited. */
function clonePieces(pieces: FilenamePiece[]): FilenamePiece[] {
  return pieces.map((piece) => ({ ...piece }));
}

/** Two hairlines with the date between them, e.g. `29 July`. */
function daySeparatorRow(label: string): HTMLElement {
  const item = el('li', 'pair-day-separator');
  item.append(
    el('span', 'pair-day-rule'),
    el('span', 'pair-day-label', label),
    el('span', 'pair-day-rule')
  );
  return item;
}

class PopupController {
  private selectedFormat: ExportFormat = 'md';
  private pairs: QAPair[] = [];
  /** Kept for the filename preview, which needs title / model / created date. */
  private conversation: Conversation | null = null;
  /** Rows showing their full question text (`more` / `less`). */
  private expandedPairIds = new Set<string>();
  private view: PopupView = 'main';
  /**
   * The trigger that opened each view, most recently — restored on the way
   * back (Escape / a back-or-done button) when it is still reachable, so a
   * keyboard user returns to where they left off instead of losing focus to
   * `<body>`. Never written by a back/done button itself (see
   * `handleRouterClick`), so a round trip through a nested view cannot
   * overwrite the entry that opened its parent.
   */
  private viewEntryTrigger = new Map<PopupView, HTMLElement>();
  private formatMenuOpen = false;
  private uiState: UiState = 'detecting';
  private routerBound = false;
  private pageReady = false;
  /** Whether `selectedFormat` is one of the formats Print supports at all. */
  private printableFormat = false;
  /**
   * Exactly what storage holds, `undefined` included: an install that never
   * opened this screen keeps rendering the legacy template string, so its
   * downloads keep the name they had before the builder existed.
   */
  private filenamePieces: FilenamePiece[] | undefined;
  /** Index the current drag started from; `dataTransfer` is not needed. */
  private draggedPieceIndex: number | null = null;
  /** The tab `checkCurrentPage()` last talked to; `requestSkeleton()` asks it again. */
  private currentTabId: number | undefined;
  private drift: DriftReport | undefined;
  /** The exact bytes shown in the preview and written to the clipboard. */
  private reportText: string | null = null;
  private pageOrigin = '';

  async initialize(): Promise<void> {
    // Localize all static text in the HTML
    localizeHtmlPage();
    // WCAG 3.1.1: the popup ships 7 locales but never declared which one is
    // rendered — the AT default-language voice mispronounces every locale
    // but English. `html-exporter.ts` already reads `getUILanguage()` for the
    // exported document; this mirrors it for the popup itself.
    document.documentElement.lang = getUILanguage();

    // Start on the main view, in the detecting state
    this.setView('main');
    this.setFormatMenuOpen(false);
    this.setUiState('detecting');

    // Platform links for the unsupported screen, straight off the registry
    renderPlatformLinks();

    // Show the shipped version
    renderVersion();

    // Load user preferences
    await this.loadPreferences();

    // Set up event listeners
    this.setupEventListeners();

    // Check if we're on a supported page
    await this.checkCurrentPage();
  }

  private async loadPreferences(): Promise<void> {
    // Load last used format
    const lastFormat = localStorage.getItem('lastExportFormat') as ExportFormat;
    if (lastFormat) {
      this.selectedFormat = lastFormat;
    }

    // Always update the button label and print state to match current format
    this.handleFormatChange(this.selectedFormat);

    // Reflect the persisted metadata/timestamp export options in the toggles
    const prefs = await StorageService.getUserPreferences();
    const metaInfoToggle = document.getElementById('option-show-meta-info') as HTMLInputElement;
    if (metaInfoToggle) {
      metaInfoToggle.checked = prefs.showMetaInfo;
    }

    // Preferences saved before the text-size setting existed carry no value;
    // they are `normal`, which is what they have been exporting at all along.
    for (const step of this.fontScaleInputs()) {
      step.checked = step.value === (prefs.fontScale ?? 'normal');
    }

    this.filenamePieces = prefs.filenamePieces ? clonePieces(prefs.filenamePieces) : undefined;
    this.renderFilenameBuilder();

    await this.updateOptionsDot();

    // Popup-only theme (the gear view), stored separately from the export
    // preferences above -- see StorageService.getThemePreference.
    const theme = await StorageService.getThemePreference();
    this.applyTheme(theme);
    for (const input of this.themeInputs()) {
      input.checked = input.value === theme;
    }
  }

  /**
   * Drive the popup's palette from a `data-theme` attribute on the document
   * root. `light`/`dark` override `@media (prefers-color-scheme: dark)` in
   * popup.css in both directions (see that file); `auto` matches neither
   * override selector, so the OS preference alone decides, unchanged.
   */
  private applyTheme(theme: ThemePreference): void {
    document.documentElement.setAttribute('data-theme', theme);
  }

  /** The three theme radios. Empty until the Settings view is in the DOM. */
  private themeInputs(): HTMLInputElement[] {
    return [...document.querySelectorAll<HTMLInputElement>('input[name="settings-theme"]')];
  }

  /** The fixed-height box every view and state renders into. */
  private bodyBox(): HTMLElement | null {
    return document.getElementById('popup-body');
  }

  /**
   * Show one view and hide the rest. Navigation is delegated, so a view added
   * later only needs a `data-nav="<view>"` trigger — no router change.
   */
  private setView(view: PopupView): void {
    const previousView = this.view;
    this.view = view;
    for (const name of VIEWS) {
      const container = document.getElementById(`view-${name}`);
      if (container) container.hidden = name !== view;
    }
    this.bodyBox()?.setAttribute('data-view', view);
    if (previousView !== view) this.focusView(view, previousView);
  }

  /**
   * Every trigger that switches views (`.setting-row`, the gear, `.submenu-back`
   * / `.submenu-done`) lives inside the section `setView()` just hid, so the
   * browser blurs it and drops focus to `<body>` — nothing ever placed it
   * anywhere else. Restore it to the element that opened the view being left,
   * when that element is still reachable in the view now showing; otherwise
   * move it to the new view's heading, which both places focus somewhere real
   * and gets the view name announced.
   */
  private focusView(view: PopupView, previousView: PopupView): void {
    const returnTarget = this.viewEntryTrigger.get(previousView);
    if (returnTarget && document.contains(returnTarget) && !returnTarget.closest('[hidden]')) {
      returnTarget.focus();
      return;
    }
    document
      .getElementById(`view-${view}`)
      ?.querySelector<HTMLElement>('.submenu-title, .conversation-title')
      ?.focus();
  }

  private setFormatMenuOpen(open: boolean): void {
    this.formatMenuOpen = open;
    this.bodyBox()?.setAttribute('data-format-menu-open', String(open));
    const toggle = document.getElementById('format-menu-toggle');
    toggle?.setAttribute('aria-expanded', String(open));
    // Everything behind the floating menu steps out of the tab order and hit
    // testing while it is open, not just visually (opacity alone left it
    // reachable and clickable underneath the menu).
    for (const el of this.formatMenuBackgroundElements()) {
      if (open) {
        el.setAttribute('inert', '');
      } else {
        el.removeAttribute('inert');
      }
    }
    if (open) {
      this.revealSelectedFormatRow();
    } else {
      toggle?.focus();
    }
  }

  private formatMenuBackgroundElements(): HTMLElement[] {
    return [
      document.querySelector<HTMLElement>('.view-scroll'),
      document.querySelector<HTMLElement>('.setting-rows'),
      document.getElementById('print-button'),
    ].filter((el): el is HTMLElement => el !== null);
  }

  /**
   * The menu scrolls; the format already in use has to be the one you see when
   * it opens, not a row you have to hunt for. jsdom ships no `scrollIntoView`,
   * hence the guard. Also moves focus into the menu, onto that same row — the
   * menu declares `role="menu"`, so AT users expect focus to land inside it.
   */
  private revealSelectedFormatRow(): void {
    const row = this.formatRow(this.selectedFormat);
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
    row?.focus();
  }

  /** Arrow/Home/End roving focus between the format rows, while the menu is open. */
  private handleFormatMenuKeydown(event: KeyboardEvent): void {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-format-menu] [data-format]')];
    if (rows.length === 0) return;
    const current = rows.indexOf(document.activeElement as HTMLElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = current < 0 ? 0 : (current + 1) % rows.length;
        break;
      case 'ArrowUp':
        next = current < 0 ? rows.length - 1 : (current - 1 + rows.length) % rows.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = rows.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    rows[next]?.focus();
  }

  private formatRow(format: ExportFormat): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-format-menu] [data-format="${format}"]`);
  }

  /** Mark the chosen row. `aria-checked` is both the a11y state and the cue CSS paints. */
  private syncFormatRows(): void {
    document.querySelectorAll<HTMLElement>('[data-format-menu] [data-format]').forEach((row) => {
      row.setAttribute('aria-checked', String(row.dataset.format === this.selectedFormat));
    });
  }

  /**
   * The single switch every state hangs off. CSS keys the whole box on it, so
   * a state can never half-paint over another. Mirrored onto `<body>` too
   * because the header sits outside the box and the unsupported screen dims it.
   */
  private setUiState(state: UiState): void {
    this.uiState = state;
    this.bodyBox()?.setAttribute('data-ui-state', state);
    document.body.setAttribute('data-ui-state', state);
    // `Export again` vs `Export <format>` depends on the state.
    this.updateExportLabel(this.selectedFormat);
  }

  private handleRouterClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const trigger = target.closest<HTMLElement>('[data-nav]');
    const nav = trigger?.getAttribute('data-nav');
    if (nav && isPopupView(nav) && trigger) {
      // A back/done button already carries the entry the router recorded when
      // its own view was opened — recording it again here as the entry for
      // the view it is returning to would overwrite that view's real trigger
      // with a button that is not reachable there.
      if (!trigger.matches('.submenu-back, .submenu-done')) {
        this.viewEntryTrigger.set(nav, trigger);
      }
      this.setView(nav);
      return;
    }

    if (target.closest('[data-format-menu-toggle]')) {
      this.setFormatMenuOpen(!this.formatMenuOpen);
      return;
    }

    // A format row: choose it and close. The menu is the only place
    // `data-format` appears, so the closest match is unambiguous.
    const format = target.closest<HTMLElement>('[data-format]')?.dataset.format;
    if (format !== undefined && isExportFormat(format)) {
      this.handleFormatChange(format);
      this.setFormatMenuOpen(false);
      return;
    }

    // A click anywhere else closes the format menu.
    if (this.formatMenuOpen && !target.closest('[data-format-menu]')) {
      this.setFormatMenuOpen(false);
    }
  }

  /**
   * Esc closes the format menu first, then backs out of any submenu. While
   * the format menu is open, Arrow/Home/End rove focus between its rows
   * instead — `role="menu"` puts a screen reader into focus mode where those
   * are the keys it expects to work.
   */
  private handleRouterKeydown(event: KeyboardEvent): void {
    if (this.formatMenuOpen && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      this.handleFormatMenuKeydown(event);
      return;
    }
    if (event.key !== 'Escape') return;
    if (this.formatMenuOpen) {
      this.setFormatMenuOpen(false);
      return;
    }
    if (this.view !== 'main') {
      this.setView('main');
    }
  }

  private setupEventListeners(): void {
    // View router (delegated so later views need no wiring here). These sit on
    // the document — Esc must work with nothing focused — so they outlive a
    // re-render of the popup markup: bind them once, or a second initialize
    // would double-handle every click.
    if (!this.routerBound) {
      this.routerBound = true;
      document.addEventListener('click', (e) => {
        this.handleRouterClick(e);
      });
      document.addEventListener('keydown', (e) => {
        this.handleRouterKeydown(e);
      });
    }

    // Export button
    document.getElementById('export-button')?.addEventListener('click', () => {
      void this.handleExport(this.selectedFormat);
    });

    // Q&A pair select-all / select-none toggle
    document.getElementById('qa-selection-toggle-all')?.addEventListener('click', () => {
      this.handleToggleAllPairs();
    });

    // Print button
    document.getElementById('print-button')?.addEventListener('click', () => {
      void this.handlePrint();
    });

    // Reload state: do the reload instead of only explaining how to.
    document.getElementById('reload-button')?.addEventListener('click', () => {
      void chrome.tabs.reload();
      window.close();
    });

    // Warning card: run the same export again.
    document.getElementById('warning-retry-button')?.addEventListener('click', () => {
      void this.handleExport(this.selectedFormat);
    });

    // Export option toggle — one row: a message time is meta-info too.
    document.getElementById('option-show-meta-info')?.addEventListener('change', (e) => {
      void this.persistPreference({ showMetaInfo: (e.target as HTMLInputElement).checked });
    });
    for (const step of this.fontScaleInputs()) {
      step.addEventListener('change', () => {
        void this.persistPreference({ fontScale: step.value as FontScale });
      });
    }

    // Theme (the gear view): a popup-only preference, stored and applied
    // straight away -- it must not touch the Options row's changed dot.
    for (const input of this.themeInputs()) {
      input.addEventListener('change', () => {
        const theme = input.value as ThemePreference;
        this.applyTheme(theme);
        void this.trySavePreference(
          () => StorageService.setThemePreference(theme),
          async () => {
            // Resnap the applied theme and the checked radio to what's
            // actually in storage -- the optimistic apply above must not be
            // left standing for a write that never landed.
            const stored = await StorageService.getThemePreference();
            this.applyTheme(stored);
            for (const themeInput of this.themeInputs()) {
              themeInput.checked = themeInput.value === stored;
            }
          }
        );
      });
    }

    // File name: back to the piece list the extension ships with.
    document.getElementById('filename-restore-default')?.addEventListener('click', () => {
      this.applyPieces(clonePieces(DEFAULT_FILENAME_PIECES));
    });

    document.getElementById('drift-row')?.addEventListener('click', () => {
      void this.openReportView();
    });

    document.getElementById('drift-report-copy')?.addEventListener('click', () => {
      void this.copyReport();
    });

    document.getElementById('drift-report-copy-and-report')?.addEventListener('click', () => {
      void (async () => {
        await this.copyReport();
        // The popup closes when the tab opens. Acceptable: this is the final
        // step, and the full report is already on the clipboard regardless of
        // whether it fit into the URL below.
        const url =
          this.drift && this.reportText
            ? buildDriftIssueUrl(this.drift, this.reportText, ISSUE_TRACKER_URL)
            : ISSUE_TRACKER_URL;
        await chrome.tabs.create({ url });
      })();
    });
  }

  /** The three text-size steps. Empty until the Options view is in the DOM. */
  private fontScaleInputs(): HTMLInputElement[] {
    return [...document.querySelectorAll<HTMLInputElement>('input[name="option-font-scale"]')];
  }

  /** Every preference write goes through here so the Options dot stays honest. */
  private async persistPreference(
    patch: Parameters<typeof StorageService.setUserPreferences>[0]
  ): Promise<void> {
    const saved = await this.trySavePreference(
      () => StorageService.setUserPreferences(patch),
      () => this.loadPreferences()
    );
    if (!saved) return;
    await this.updateOptionsDot();
    await this.updateFilenamePreview();
  }

  /**
   * Write a preference and report `false` on failure instead of letting the
   * caller assume it landed. `StorageService`'s setters rethrow on failure
   * (signed out of sync, an enterprise policy, or a quota limit are all real
   * ways this can happen), but the checkbox/radio has already flipped in the
   * DOM by the time a `change` handler runs this — without `resnap`, the UI
   * keeps showing a value that was never actually saved. `resnap` re-reads
   * storage and puts the control back to what's really there.
   */
  private async trySavePreference(
    write: () => Promise<void>,
    resnap: () => Promise<void>
  ): Promise<boolean> {
    try {
      await write();
      return true;
    } catch (error) {
      console.error('Failed to save preference:', error);
      this.updateStatus('error', getMessage('statusPreferenceSaveFailed'));
      await resnap();
      return false;
    }
  }

  private handleFormatChange(format: ExportFormat): void {
    this.selectedFormat = format;
    localStorage.setItem('lastExportFormat', format);
    this.updateExportLabel(format);
    this.syncFormatRows();
    // The preview carries the extension, so it moves with the format.
    void this.updateFilenamePreview();

    const printableFormats: ExportFormat[] = ['html', 'pdf', 'txt', 'md', 'json'];
    this.printableFormat = printableFormats.includes(format);

    const printButton = document.getElementById('print-button') as HTMLButtonElement;
    if (printButton) {
      const formatName = getFormatName(format);
      // Recomputed inline rather than via a call to `syncExportEnabled()`
      // here: with the single-controller-instance test harness in
      // popup-router.test.ts (one `PopupController` handles every
      // synthetic DOMContentLoaded dispatch across the whole file), calling
      // `syncExportEnabled()` from this method reintroduces a flaky
      // cross-test interaction that drops the export-button click listener
      // on a later test. `syncExportEnabled()` still covers the
      // selection/page-ready cases (see its own call sites).
      printButton.disabled = !this.pageReady || this.nothingSelected() || !this.printableFormat;
      printButton.title = getMessageWithValues(
        this.printableFormat ? 'printButtonFormat' : 'printUnavailableFormat',
        formatName
      );
      printButton.setAttribute('aria-label', printButton.title);
    }
  }

  /** No parser output at all is not a deselection — only an actual empty selection counts. */
  private nothingSelected(): boolean {
    return this.pairs.length > 0 && SelectionService.isNoneSelected(this.pairs);
  }

  private async checkCurrentPage(): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        this.setUiState('error');
        this.updateStatus('error', getMessage('statusNoActiveTab'));
        return;
      }
      this.currentTabId = tab.id;

      // Derived from the parser registry so a newly registered platform is
      // supported here automatically — a second hardcoded list silently gated
      // Gemini out long after its parser shipped.
      const supportedDomains = [...parserRegistry.keys()].flatMap(getUrlsForPlatform);

      const url = tab.url ? new URL(tab.url) : null;
      if (url) this.pageOrigin = url.origin;
      if (!url || !supportedDomains.some((domain) => url.hostname.includes(domain))) {
        this.setUiState('unsupported');
        this.updateStatus('inactive', getMessage('statusNotSupported'));
        return;
      }

      // Try to get conversation from content script. `sendTabMessage` injects
      // one and retries when the tab has none, so the reload screen below is
      // the fallback for when even that fails, not the first answer.
      const message = createMessage<GetConversationMessage>('get_conversation', {});
      const result = await sendTabMessage<MessageResponse<Conversation> | undefined>(
        tab.id,
        message
      );

      if (!result.ok) {
        if (result.reason === 'failed') {
          console.error('Failed to check current page:', result.error);
          this.setUiState('error');
          this.updateStatus('error', getMessage('statusPageCheckFailed'), result.error);
          return;
        }
        // Expected every time the extension is installed, updated or reloaded
        // with a chat tab already open — not an error, just a page that has to
        // come back before it can be read.
        console.debug('No content script in this tab:', result.error);
        this.setUiState('reload');
        this.updateStatus('warning', getMessage('statusReloadNeeded'));
        return;
      }

      const response = result.response;
      // A zero-pair parse is a truthy conversation (`success: true`, `data`
      // non-null) but has nothing to export -- treat it the same as the
      // content script returning no conversation at all (D-19), rather than
      // painting the normal ready screen over an empty export.
      if (response?.success && response.data && response.data.pairs.length > 0) {
        this.setUiState('ready');
        this.updateConversationInfo(response.data);
        this.updateStatus('active', getMessage('statusReady'));
        this.enableButtons();
        this.drift = response.drift;
        void this.renderDriftRow();
      } else {
        // The URL is supported and the content script answered, but the parser
        // found nothing on the page -- a parse bug, not an unsupported page,
        // so it gets its own state rather than the "open one of these pages"
        // screen (lo-72f5).
        this.setUiState('noConversation');
        this.updateStatus('warning', getMessage('statusNoConversation'));
      }
    } catch (error) {
      // Only the tab lookup and URL parsing reach here now — messaging failures
      // come back as a result above. Nothing a page reload would fix.
      console.error('Failed to check current page:', error);
      this.setUiState('error');
      this.updateStatus('error', getMessage('statusPageCheckFailed'));
    }
  }

  /**
   * `text` goes in the header badge, which is a narrow no-wrap 10px label —
   * keep it to a word or two. Anything longer belongs in `detail`, which
   * becomes the badge's tooltip *and*, for an `error` status, the visible
   * `#error-card` panel (`setUiState('error')` is what makes that panel show;
   * every caller here already calls it alongside `updateStatus('error', ...)`)
   * — the tooltip alone is mouse/hover-only and unreachable by keyboard or
   * touch.
   */
  private updateStatus(
    status: 'active' | 'inactive' | 'warning' | 'error',
    text: string,
    detail?: string
  ): void {
    const indicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');

    if (indicator && statusText) {
      indicator.className = `status-indicator ${status}`;
      statusText.textContent = text;
      indicator.title = detail ?? text;
    }

    if (status === 'error') {
      const errorDetail = document.getElementById('error-card-detail');
      if (errorDetail) errorDetail.textContent = detail ?? text;
    }
  }

  private updateConversationInfo(conversation: Conversation): void {
    const platformIcon = document.getElementById('platform-icon') as HTMLImageElement;
    const title = document.getElementById('conversation-title');
    const meta = document.getElementById('conversation-meta');

    if (platformIcon) {
      platformIcon.src =
        PLATFORM_ICONS[conversation.platform] ?? '../assets/icons/chatgpt-logo.svg';
      platformIcon.style.display = 'block';
      platformIcon.alt = '';
    }

    if (title) {
      const titleText = conversation.title || getMessage('conversationUntitled');
      title.textContent = titleText;
      title.title = titleText;
    }

    if (meta) {
      meta.textContent = this.formatConversationMeta(conversation);
    }

    // Own copy: toggling a checkbox must not mutate the conversation object
    // shared with the rest of the popup.
    this.conversation = conversation;
    this.pairs = conversation.pairs.map((pair) => ({ ...pair }));
    this.renderSelectionList();
    void this.updateFilenamePreview();
  }

  /**
   * The name the export would really be saved as — `buildFilename` is the one
   * function the content script's download path calls too, so neither slot can
   * ever advertise a name the file does not get.
   *
   * Pieces come from memory rather than storage so the footer tracks a chip
   * being typed into, which is not written until it loses focus.
   *
   * ponytail: the extension is the format id because every exporter's
   * `extension` matches its format today. Read it off the exporter registry
   * if that ever stops being true.
   */
  private async updateFilenamePreview(): Promise<void> {
    const slots = document.querySelectorAll<HTMLElement>('[data-filename-preview]');
    if (slots.length === 0 || !this.conversation) return;

    const prefs = await StorageService.getUserPreferences();
    const name = FilenameService.buildFilename(
      { ...prefs, filenamePieces: this.filenamePieces },
      FilenameService.getVariablesFromConversation(this.conversation),
      this.selectedFormat
    );
    slots.forEach((slot) => {
      slot.textContent = name;
      slot.title = name;
    });
  }

  /** The pieces on screen: what is stored, or the default list until it is. */
  private currentPieces(): FilenamePiece[] {
    return this.filenamePieces ?? DEFAULT_FILENAME_PIECES;
  }

  /**
   * Adopt a new piece list: repaint, refresh both previews, persist.
   * Every edit below funnels through here so none of them can forget one.
   */
  private applyPieces(pieces: FilenamePiece[]): void {
    this.filenamePieces = pieces;
    this.renderFilenameBuilder();
    void this.persistPreference({ filenamePieces: pieces });
  }

  /** Chips for the composed name, then add-chips for what is left over. */
  private renderFilenameBuilder(): void {
    const field = document.getElementById('filename-pieces');
    const addRow = document.getElementById('filename-add-chips');
    if (!field || !addRow) return;

    const pieces = this.currentPieces();
    const nodes: HTMLElement[] = [];
    pieces.forEach((piece, index) => {
      // The literal `_` the renderer really puts between two pieces.
      if (index > 0) nodes.push(el('span', 'filename-separator', '_'));
      nodes.push(this.pieceChip(piece, index));
    });
    nodes.push(el('span', 'filename-caret'));
    field.replaceChildren(...nodes);

    const used = new Set(pieces.map((piece) => piece.type));
    addRow.replaceChildren(
      ...PIECE_TYPES.filter((type) => type === 'literal' || !used.has(type)).map((type) =>
        this.addChip(type)
      )
    );
  }

  /**
   * One piece: its label (or its text field), a remove button, draggable —
   * and, since dragging is not a keyboard operation (WCAG 2.1.1), also
   * focusable and reorderable with Ctrl+ArrowLeft/Right.
   */
  private pieceChip(piece: FilenamePiece, index: number): HTMLElement {
    const chip = el('span', 'filename-chip');
    chip.draggable = true;
    chip.dataset.pieceType = piece.type;
    chip.dataset.pieceIndex = String(index);
    chip.tabIndex = 0;
    chip.setAttribute('role', 'button');
    chip.setAttribute(
      'aria-label',
      getMessageWithValues(
        'filenameChipPosition',
        getMessage(PIECE_LABEL_KEYS[piece.type]),
        String(index + 1),
        String(this.currentPieces().length)
      )
    );
    chip.addEventListener('dragstart', () => {
      this.draggedPieceIndex = index;
    });
    // Without a default-prevented dragover a browser refuses the drop.
    chip.addEventListener('dragover', (event) => {
      event.preventDefault();
    });
    chip.addEventListener('drop', (event) => {
      event.preventDefault();
      this.movePiece(this.draggedPieceIndex, index);
    });
    // Only when the chip itself is the event target — a literal chip's text
    // input is a descendant and bubbles keydown up here too, and Ctrl+Arrow
    // is the standard "move by word" shortcut while editing text; letting it
    // reorder the chip instead would break typing in the free-text piece.
    chip.addEventListener('keydown', (event) => {
      if (event.target !== chip) return;
      if (!event.ctrlKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      const to = event.key === 'ArrowLeft' ? index - 1 : index + 1;
      if (to < 0 || to >= this.currentPieces().length) return;
      event.preventDefault();
      this.movePiece(index, to);
      document.querySelectorAll<HTMLElement>('#filename-pieces .filename-chip')[to]?.focus();
    });

    if (piece.type === 'literal') {
      chip.appendChild(this.literalInput(piece));
    } else {
      chip.appendChild(el('span', 'filename-chip-label', getMessage(PIECE_LABEL_KEYS[piece.type])));
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'filename-chip-remove';
    const removeLabel = getMessage('filenameRemovePiece');
    remove.setAttribute('aria-label', removeLabel);
    remove.title = removeLabel;
    remove.insertAdjacentHTML(
      'beforeend',
      `<svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
        <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`
    );
    remove.addEventListener('click', () => {
      this.applyPieces(this.currentPieces().filter((_, at) => at !== index));
    });
    chip.appendChild(remove);

    return chip;
  }

  /**
   * Free text edits in place. Keystrokes only move the previews — repainting
   * the field would drop the caret, and a write per character would burn
   * through chrome.storage.sync's quota. The write lands on `change`.
   */
  private literalInput(piece: FilenamePiece): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'filename-chip-input';
    const label = getMessage('filenamePieceLiteral');
    input.setAttribute('aria-label', label);
    input.placeholder = label;
    input.value = piece.text ?? '';
    const fit = (): void => {
      input.size = Math.max(4, input.value.length);
    };
    fit();
    input.addEventListener('input', () => {
      piece.text = input.value;
      fit();
      void this.updateFilenamePreview();
    });
    input.addEventListener('change', () => {
      void this.persistPreference({ filenamePieces: this.currentPieces() });
    });
    // Selecting text inside the chip must not start a chip drag.
    input.addEventListener('dragstart', (event) => {
      event.stopPropagation();
    });
    return input;
  }

  private addChip(type: FilenamePieceType): HTMLElement {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'filename-add-chip';
    chip.dataset.addPiece = type;
    chip.textContent = getMessageWithValues('filenameAddPiece', getMessage(PIECE_LABEL_KEYS[type]));
    chip.addEventListener('click', () => {
      const piece: FilenamePiece = type === 'literal' ? { type, text: '' } : { type };
      this.applyPieces([...this.currentPieces(), piece]);
    });
    return chip;
  }

  /** Drop `from` at `to`, the whole of what dragging a chip does. */
  private movePiece(from: number | null, to: number): void {
    this.draggedPieceIndex = null;
    if (from === null || from === to) return;

    const pieces = clonePieces(this.currentPieces());
    const [moved] = pieces.splice(from, 1);
    if (!moved) return;
    pieces.splice(to, 0, moved);
    this.applyPieces(pieces);
  }

  /**
   * Render the pair rows, the day separators between them, and the footer.
   *
   * A separator marks a *change* of date, so it can never open the list: the
   * previous day starts unset and only the second dated pair onwards can
   * differ from it.
   */
  private renderSelectionList(): void {
    const list = document.getElementById('qa-selection-list');
    if (!list) return;

    const dayFormat = new Intl.DateTimeFormat(getUILanguage(), {
      day: 'numeric',
      month: 'long',
    });
    const rows: HTMLElement[] = [];
    let previousDay: string | null = null;

    this.pairs.forEach((pair) => {
      const date = pairDate(pair);
      if (date !== null) {
        const day = date.toDateString();
        if (previousDay !== null && day !== previousDay) {
          rows.push(daySeparatorRow(dayFormat.format(date)));
        }
        previousDay = day;
      }
      rows.push(this.pairRow(pair));
    });

    list.replaceChildren(...rows);
    this.updateSelectionSummary();
  }

  /** One chooser row: checkbox, pair number, clamped question, `more` link. */
  private pairRow(pair: QAPair): HTMLElement {
    const item = el('li', 'pair-row');
    const expanded = this.expandedPairIds.has(pair.id);
    item.dataset.expanded = String(expanded);
    item.dataset.selected = String(pair.selected);

    const checkboxId = `qa-pair-${pair.id}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = checkboxId;
    checkbox.checked = pair.selected;
    checkbox.addEventListener('change', () => {
      this.pairs = SelectionService.toggleSelection(this.pairs, pair.id);
      this.renderSelectionList();
    });

    const question = pair.question.content.trim();
    const text = question || getMessageWithValues('qaSelectionPairFallbackLabel', pair.index + 1);
    const label = document.createElement('label');
    label.className = 'pair-row-text';
    label.htmlFor = checkboxId;
    label.textContent = text;
    label.title = text;

    const body = el('div', 'pair-row-body');
    body.appendChild(label);

    if (text.length > CLAMP_CHARS) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'pair-row-toggle';
      toggle.textContent = getMessage(expanded ? 'pairChooserLess' : 'pairChooserMore');
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.addEventListener('click', () => {
        // Reveals text and nothing else — the selection must not move with it.
        if (expanded) this.expandedPairIds.delete(pair.id);
        else this.expandedPairIds.add(pair.id);
        this.renderSelectionList();
      });
      body.appendChild(toggle);
    }

    item.append(checkbox, el('span', 'pair-row-number', formatNumber(pair.index + 1)), body);
    return item;
  }

  /** Words in the pairs still selected — the footer's second number. */
  private selectedWordCount(): number {
    return SelectionService.getSelectedPairs(this.pairs).reduce(
      (total, pair) => total + countWords(pair.question.content) + countWords(pair.answer.content),
      0
    );
  }

  private updateSelectionSummary(): void {
    const countEl = document.getElementById('qa-selection-count');
    const toggleAllButton = document.getElementById('qa-selection-toggle-all');

    if (countEl) {
      // `2 of 14 · 4,120 words` — every number through the active locale, so
      // the thousands separator is never hardcoded.
      countEl.textContent = getMessageWithValues(
        'pairChooserSummary',
        formatNumber(SelectionService.getSelectionCount(this.pairs)),
        formatNumber(this.pairs.length),
        formatNumber(this.selectedWordCount())
      );
    }
    if (toggleAllButton) {
      const allSelected = SelectionService.isAllSelected(this.pairs);
      toggleAllButton.textContent = allSelected
        ? getMessage('qaSelectionDeselectAll')
        : getMessage('qaSelectionSelectAll');
    }

    this.updateContentRow();

    // Only the ready/no-selection pair swaps here; a warning or error state
    // must not be cleared by a checkbox.
    if (this.uiState === 'ready' || this.uiState === 'noSelection') {
      this.setUiState(this.nothingSelected() ? 'noSelection' : 'ready');
    }

    this.syncExportEnabled();
  }

  private handleToggleAllPairs(): void {
    this.pairs = SelectionService.isAllSelected(this.pairs)
      ? SelectionService.deselectAll(this.pairs)
      : SelectionService.selectAll(this.pairs);
    this.renderSelectionList();
  }

  /** Indices of the currently selected pairs, sent along with export/print. */
  private selectedPairIndices(): number[] {
    return SelectionService.getSelectedPairs(this.pairs).map((pair) => pair.index);
  }

  /**
   * `Gemini · 14 pairs · 26–29 jul`. The word count deliberately isn't here —
   * it belongs to the pair-chooser footer, where a selection can change it.
   */
  private formatConversationMeta(conversation: Conversation): string {
    const count = conversation.pairs.length;
    const segments = [
      getPlatformName(conversation.platform),
      getMessageWithValues(
        count === 1 ? 'metaPairsSingular' : 'metaPairsPlural',
        formatNumber(count)
      ),
      conversationDateRange(conversation),
    ];
    return segments.filter((segment) => segment !== null && segment !== '').join(' · ');
  }

  /**
   * `Whole conversation`, or `3 of 14 pairs` once something is deselected. With
   * nothing left selected the row is the warning itself: it says so and offers
   * the way out, since the export button beside it has just gone dead.
   */
  private updateContentRow(): void {
    const label = document.querySelector('.setting-row[data-nav="content"] .setting-row-label');
    const value = document.getElementById('content-row-value');
    if (!value) return;

    const selected = SelectionService.getSelectionCount(this.pairs);
    const total = this.pairs.length;

    if (total > 0 && selected === 0) {
      if (label) label.textContent = getMessage('rowContentNoSelection');
      value.textContent = getMessage('rowContentChoosePairs');
      return;
    }

    if (label) label.textContent = getMessage('rowContent');
    value.textContent =
      total > 0 && selected < total
        ? getMessageWithValues('rowContentPartial', formatNumber(selected), formatNumber(total))
        : getMessage('rowContentAll');
  }

  /**
   * Export is possible on a ready page that still has something selected.
   * A conversation with no pairs at all is not a deselection — it exports.
   * Print shares the same gate, plus its own format restriction — it used to
   * be governed by the format alone, so deselecting every pair left it
   * enabled and printing produced a metadata-only document.
   */
  private syncExportEnabled(): void {
    const nothingSelected = this.nothingSelected();

    const button = document.getElementById('export-button') as HTMLButtonElement | null;
    if (button) {
      button.disabled = !this.pageReady || nothingSelected;
    }

    const printButton = document.getElementById('print-button') as HTMLButtonElement | null;
    if (printButton) {
      printButton.disabled = !this.pageReady || nothingSelected || !this.printableFormat;
    }
  }

  /** Green dot on the Options row: some preference is off its default. */
  private async updateOptionsDot(): Promise<void> {
    const dot = document.getElementById('options-changed-dot');
    if (!dot) return;

    const prefs = await StorageService.getUserPreferences();
    const scalarsAtDefault = (
      Object.keys(DEFAULT_PREFERENCES) as (keyof typeof DEFAULT_PREFERENCES)[]
    ).every((key) => prefs[key] === DEFAULT_PREFERENCES[key]);
    // The piece list is not in DEFAULT_PREFERENCES (absent means "untouched",
    // which is what keeps the legacy name), so it is compared by value here.
    const nameAtDefault =
      prefs.filenamePieces === undefined ||
      JSON.stringify(prefs.filenamePieces) === JSON.stringify(DEFAULT_FILENAME_PIECES);
    dot.hidden = scalarsAtDefault && nameAtDefault;
  }

  private updateExportLabel(format: ExportFormat): void {
    const label = document.getElementById('export-button-label');
    if (label) {
      // After a degraded export the same button is the retry-in-full.
      label.textContent =
        this.uiState === 'warning'
          ? getMessage('exportButtonAgain')
          : getMessageWithValues('exportButtonFormat', getFormatName(format));
    }
  }

  private enableButtons(): void {
    this.pageReady = true;
    this.syncExportEnabled();
    // Re-syncs the format-specific print title/aria-label/disabled state
    // now that the page is ready (handleFormatChange computes print's
    // disabled state itself; see the comment there for why).
    this.handleFormatChange(this.selectedFormat);
  }

  private async handleExport(format: ExportFormat): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('errorNoActiveTabFound');
      }

      const message = createMessage<ExportConversationMessage>('export_conversation', {
        format,
        selectedIndices: this.selectedPairIndices(),
      });

      const response: MessageResponse | undefined = await chrome.tabs.sendMessage(tab.id, message);
      if (!response?.success) {
        throw new Error(response?.error ?? 'statusExportFailed');
      }
      if (response.warning) {
        // Degraded export (e.g. artifact contents missing) — keep the popup
        // open so the user actually sees it. Full reason is in the tooltip.
        this.showWarning(response.warning);
        return;
      }
      window.close(); // Close popup after triggering export
    } catch (error) {
      this.reportActionFailure('Export failed:', 'statusExportFailed', error);
    }
  }

  private async handlePrint(): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('errorNoActiveTabFound');
      }

      const message = createMessage<PrintConversationMessage>('print_conversation', {
        format: this.selectedFormat,
        selectedIndices: this.selectedPairIndices(),
      });

      const response: MessageResponse | undefined = await chrome.tabs.sendMessage(tab.id, message);
      if (!response?.success) {
        // Mirrors handleExport: a failure reported by the content script
        // (blocked print popup, zero pairs, exporter throw, an unreadable
        // blob) must not be read as success — it was previously discarded
        // here, so the popup closed on a failed print with no explanation.
        throw new Error(response?.error ?? 'statusPrintFailed');
      }
      if (response.warning) {
        this.showWarning(response.warning);
        return;
      }
      window.close(); // Close popup after triggering print
    } catch (error) {
      this.reportActionFailure('Print failed:', 'statusPrintFailed', error);
    }
  }

  /**
   * `error.message` may be a locale key from the content script (or the
   * fallback key passed above) — `getMessage()` resolves it, or returns it
   * unchanged when it isn't a declared key (an older literal string). The
   * header pill is a narrow no-wrap label (see `updateStatus`), so it always
   * gets the short generic text; the specific reason goes in `detail`, which
   * becomes the pill's tooltip instead of overflowing the fixed popup box.
   */
  private reportActionFailure(logPrefix: string, fallbackKey: string, error: unknown): void {
    console.error(logPrefix, error);
    this.setUiState('error');
    const detail = error instanceof Error ? getMessage(error.message) : undefined;
    this.updateStatus('error', getMessage(fallbackKey), detail);
  }

  /**
   * Degraded export. `reason` is a locale key the content script returns —
   * resolved here with `getMessage()` so the card reads in the UI language
   * (a caller that still returns raw prose degrades gracefully: `getMessage`
   * falls back to its input when the lookup misses). The card's detail line
   * renders the full text (no more two-line clamp); the header badge is a
   * narrow no-wrap label, so it keeps the full text in its `title` instead.
   * Retry is only shown for a reason in `RETRYABLE_WARNING_KEYS` — a cause
   * that can't change on a second attempt gets no dead button.
   */
  private showWarning(reason: string): void {
    this.setUiState('warning');
    const detail = getMessage(reason);
    // D-39: a parser-content warning has nothing to do with missing
    // artifacts — the header must say so, not reuse the Claude-enrichment
    // wording for every warning regardless of cause.
    const headerKey =
      reason === WARNING_KEYS.PARSER_CONTENT ? 'statusExportIncomplete' : 'statusArtifactsMissing';
    this.updateStatus('warning', getMessage(headerKey), detail);

    const detailEl = document.getElementById('warning-card-detail');
    if (detailEl) {
      detailEl.textContent = detail;
    }

    const retryButton = document.getElementById('warning-retry-button');
    if (retryButton) {
      retryButton.hidden = !RETRYABLE_WARNING_KEYS.has(reason);
    }
  }

  /**
   * Show the amber row only for a fingerprint the user has not already dealt
   * with. Suppression is per fingerprint, and the fingerprint embeds the
   * extension version — so shipping a fix brings the prompt back by itself.
   */
  private async renderDriftRow(): Promise<void> {
    const row = document.getElementById('drift-row');
    if (!row) return;
    const drift = this.drift;
    row.hidden = !drift || (await isDriftSuppressed(drift.fingerprint));
  }

  /**
   * Build the report when the view opens, never before: a user who never opens
   * it never has a skeleton built for them.
   */
  private async openReportView(): Promise<void> {
    const preview = document.getElementById('drift-report-preview');
    const status = document.getElementById('drift-report-status');
    const drift = this.drift;
    if (!preview || !drift) return;

    this.setStatusText(status, getMessage('driftReportLoading'));
    const skeleton = await this.requestSkeleton();
    this.reportText = formatDriftReport(drift, skeleton.text, skeleton.origin || this.pageOrigin);
    preview.textContent = this.reportText;
    this.setStatusText(status, '');
  }

  /** Ask the content script for the page skeleton. A failure is not fatal. */
  private async requestSkeleton(): Promise<{ text: string | null; origin: string }> {
    const tabId = this.currentTabId;
    if (tabId === undefined) return { text: null, origin: '' };
    const result = await sendTabMessage<{ success: boolean; skeleton?: string; origin?: string }>(
      tabId,
      { type: MESSAGE_TYPES.GET_DRIFT_SKELETON }
    );
    if (!result.ok || !result.response.success) return { text: null, origin: '' };
    return { text: result.response.skeleton ?? null, origin: result.response.origin ?? '' };
  }

  private setStatusText(element: HTMLElement | null, text: string): void {
    if (element) element.textContent = text;
  }

  /**
   * Copy the report. The popup stays open — `navigator.clipboard.writeText`
   * runs here, so there is no reason to close it, and the confirmation lands
   * inline where the user is looking.
   */
  private async copyReport(): Promise<boolean> {
    const status = document.getElementById('drift-report-status');
    if (!this.reportText) return false;
    try {
      await navigator.clipboard.writeText(this.reportText);
      this.setStatusText(status, getMessage('driftReportCopied'));
      if (this.drift) await suppressDrift(this.drift.fingerprint);
      return true;
    } catch {
      // The <pre> is selectable, so failing to copy is recoverable by hand.
      this.setStatusText(status, getMessage('driftReportCopyFailed'));
      return false;
    }
  }
}

// Initialize popup
const popup = new PopupController();
document.addEventListener('DOMContentLoaded', () => {
  void popup.initialize();
});
