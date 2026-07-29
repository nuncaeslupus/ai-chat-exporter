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
} from '../../core/types/config';
import { StorageService } from '../../shared/storage';
import { DEFAULT_PREFERENCES } from '../../shared/constants';
import { SelectionService } from '../../core/services/selection-service';
import { FilenameService } from '../../core/services/filename-service';

/**
 * The popup's four views. Only one is visible at a time and they all render
 * inside the same fixed-height body box, so switching never resizes the popup.
 */
const VIEWS = ['main', 'content', 'options', 'filename'] as const;
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
  private formatMenuOpen = false;
  private uiState: UiState = 'detecting';
  private routerBound = false;
  private pageReady = false;
  /**
   * Exactly what storage holds, `undefined` included: an install that never
   * opened this screen keeps rendering the legacy template string, so its
   * downloads keep the name they had before the builder existed.
   */
  private filenamePieces: FilenamePiece[] | undefined;
  /** Index the current drag started from; `dataTransfer` is not needed. */
  private draggedPieceIndex: number | null = null;

  async initialize(): Promise<void> {
    // Localize all static text in the HTML
    localizeHtmlPage();

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
    const metadataToggle = document.getElementById('option-include-metadata') as HTMLInputElement;
    if (metadataToggle) {
      metadataToggle.checked = prefs.includeMetadata;
    }
    const timestampsToggle = document.getElementById(
      'option-include-timestamps'
    ) as HTMLInputElement;
    if (timestampsToggle) {
      timestampsToggle.checked = prefs.includeTimestamps;
    }

    // Preferences saved before the text-size setting existed carry no value;
    // they are `normal`, which is what they have been exporting at all along.
    for (const step of this.fontScaleInputs()) {
      step.checked = step.value === (prefs.fontScale ?? 'normal');
    }

    this.filenamePieces = prefs.filenamePieces ? clonePieces(prefs.filenamePieces) : undefined;
    this.renderFilenameBuilder();

    await this.updateOptionsDot();
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
    this.view = view;
    for (const name of VIEWS) {
      const container = document.getElementById(`view-${name}`);
      if (container) container.hidden = name !== view;
    }
    this.bodyBox()?.setAttribute('data-view', view);
  }

  private setFormatMenuOpen(open: boolean): void {
    this.formatMenuOpen = open;
    this.bodyBox()?.setAttribute('data-format-menu-open', String(open));
    if (open) this.revealSelectedFormatRow();
  }

  /**
   * The menu scrolls; the format already in use has to be the one you see when
   * it opens, not a row you have to hunt for. jsdom ships no `scrollIntoView`,
   * hence the guard.
   */
  private revealSelectedFormatRow(): void {
    const row = this.formatRow(this.selectedFormat);
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
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

    const nav = target.closest('[data-nav]')?.getAttribute('data-nav');
    if (nav && isPopupView(nav)) {
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

  /** Esc closes the format menu first, then backs out of any submenu. */
  private handleRouterKeydown(event: KeyboardEvent): void {
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

    // Export option toggles
    document.getElementById('option-include-metadata')?.addEventListener('change', (e) => {
      void this.persistPreference({ includeMetadata: (e.target as HTMLInputElement).checked });
    });
    document.getElementById('option-include-timestamps')?.addEventListener('change', (e) => {
      void this.persistPreference({ includeTimestamps: (e.target as HTMLInputElement).checked });
    });
    for (const step of this.fontScaleInputs()) {
      step.addEventListener('change', () => {
        void this.persistPreference({ fontScale: step.value as FontScale });
      });
    }

    // File name: back to the piece list the extension ships with.
    document.getElementById('filename-restore-default')?.addEventListener('click', () => {
      this.applyPieces(clonePieces(DEFAULT_FILENAME_PIECES));
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
    await StorageService.setUserPreferences(patch);
    await this.updateOptionsDot();
    await this.updateFilenamePreview();
  }

  private handleFormatChange(format: ExportFormat): void {
    this.selectedFormat = format;
    localStorage.setItem('lastExportFormat', format);
    this.updateExportLabel(format);
    this.syncFormatRows();
    // The preview carries the extension, so it moves with the format.
    void this.updateFilenamePreview();

    // Disable print button for formats that can't be printed nicely
    const printButton = document.getElementById('print-button') as HTMLButtonElement;
    if (printButton) {
      // Only allow print for HTML, PDF, TXT, MD, and JSON
      const printableFormats: ExportFormat[] = ['html', 'pdf', 'txt', 'md', 'json'];
      const canPrint = printableFormats.includes(format);
      const formatName = getFormatName(format);
      printButton.disabled = !canPrint;
      printButton.title = getMessageWithValues(
        canPrint ? 'printButtonFormat' : 'printUnavailableFormat',
        formatName
      );
      printButton.setAttribute('aria-label', printButton.title);
    }
  }

  private async checkCurrentPage(): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        this.setUiState('error');
        this.updateStatus('error', getMessage('statusNoActiveTab'));
        return;
      }

      // Derived from the parser registry so a newly registered platform is
      // supported here automatically — a second hardcoded list silently gated
      // Gemini out long after its parser shipped.
      const supportedDomains = [...parserRegistry.keys()].flatMap(getUrlsForPlatform);

      const url = tab.url ? new URL(tab.url) : null;
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
      if (response?.success && response.data) {
        this.setUiState('ready');
        this.updateConversationInfo(response.data);
        this.updateStatus('active', getMessage('statusReady'));
        this.enableButtons();
      } else {
        // Content script loaded but no conversation found
        this.setUiState('unsupported');
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
   * becomes the badge's tooltip.
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

  /** One piece: its label (or its text field), a remove button, draggable. */
  private pieceChip(piece: FilenamePiece, index: number): HTMLElement {
    const chip = el('span', 'filename-chip');
    chip.draggable = true;
    chip.dataset.pieceType = piece.type;
    chip.dataset.pieceIndex = String(index);
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
      const nothingSelected =
        this.pairs.length > 0 && SelectionService.getSelectionCount(this.pairs) === 0;
      this.setUiState(nothingSelected ? 'noSelection' : 'ready');
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
   */
  private syncExportEnabled(): void {
    const button = document.getElementById('export-button') as HTMLButtonElement | null;
    if (!button) return;

    const nothingSelected =
      this.pairs.length > 0 && SelectionService.getSelectionCount(this.pairs) === 0;
    button.disabled = !this.pageReady || nothingSelected;
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
    // Print stays governed by the format gate, not by page readiness.
    this.handleFormatChange(this.selectedFormat);
  }

  private async handleExport(format: ExportFormat): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error(getMessage('errorNoActiveTabFound'));
      }

      const message = createMessage<ExportConversationMessage>('export_conversation', {
        format,
        selectedIndices: this.selectedPairIndices(),
      });

      const response: MessageResponse | undefined = await chrome.tabs.sendMessage(tab.id, message);
      if (!response?.success) {
        throw new Error(response?.error ?? getMessage('statusExportFailed'));
      }
      if (response.warning) {
        // Degraded export (e.g. artifact contents missing) — keep the popup
        // open so the user actually sees it. Full reason is in the tooltip.
        this.showWarning(response.warning);
        return;
      }
      window.close(); // Close popup after triggering export
    } catch (error) {
      console.error('Export failed:', error);
      this.setUiState('error');
      this.updateStatus(
        'error',
        error instanceof Error ? error.message : getMessage('statusExportFailed')
      );
    }
  }

  private async handlePrint(): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error(getMessage('errorNoActiveTabFound'));
      }

      const message = createMessage<PrintConversationMessage>('print_conversation', {
        format: this.selectedFormat,
        selectedIndices: this.selectedPairIndices(),
      });

      const response: MessageResponse | undefined = await chrome.tabs.sendMessage(tab.id, message);
      if (response?.warning) {
        this.showWarning(response.warning);
        return;
      }
      window.close(); // Close popup after triggering print
    } catch (error) {
      console.error('Print failed:', error);
      this.setUiState('error');
      this.updateStatus('error', getMessage('statusPrintFailed'));
    }
  }

  /**
   * Degraded export: the amber card carries the reason, the header badge the
   * short label. Both keep the full text in their `title` — the card's detail
   * line is two rows tall and a long reason is clipped there.
   */
  private showWarning(reason: string): void {
    this.setUiState('warning');
    this.updateStatus('warning', getMessage('statusArtifactsMissing'), reason);

    const detail = document.getElementById('warning-card-detail');
    if (detail) {
      detail.textContent = reason;
      detail.title = reason;
    }
  }
}

// Initialize popup
const popup = new PopupController();
document.addEventListener('DOMContentLoaded', () => {
  void popup.initialize();
});
