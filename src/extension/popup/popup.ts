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
import type { Conversation, QAPair } from '../../core/types/conversation';
import type { ExportFormat } from '../../core/types/exporter';
import {
  getMessage,
  getMessageWithValues,
  formatNumber,
  getPlatformName,
  getUILanguage,
} from '../../shared/i18n';
import { parserRegistry } from '../../core/parsers';
import { StorageService } from '../../shared/storage';
import { DEFAULT_PREFERENCES } from '../../shared/constants';
import { SelectionService } from '../../core/services/selection-service';

/**
 * Platform information for display
 */
interface PlatformInfo {
  name: string;
  urls: string[];
}

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
 * Get URL patterns for a platform
 */
function getUrlsForPlatform(platform: string): string[] {
  switch (platform) {
    case 'chatgpt':
      return ['chat.openai.com', 'chatgpt.com'];
    case 'claude':
      return ['claude.ai'];
    case 'gemini':
      return ['gemini.google.com'];
    default:
      return [];
  }
}

/**
 * Render the version from the manifest, the single source of truth. Hardcoding
 * it here previously left the popup advertising v1.0.0 while shipping 1.1.1.
 */
function renderVersion(): void {
  const el = document.getElementById('popup-version');
  if (!el) return;
  el.textContent = `v${chrome.runtime.getManifest().version}`;
}

/**
 * Populate the supported platforms list dynamically
 */
function populateSupportedPlatforms(): void {
  const platformsList = document.getElementById('supported-platforms-list');
  if (!platformsList) return;

  const platforms: PlatformInfo[] = [];

  // Get all registered platforms
  for (const [platform] of parserRegistry) {
    platforms.push({
      name: getPlatformName(platform),
      urls: getUrlsForPlatform(platform),
    });
  }

  // Generate HTML for platform list
  const platformsHtml = platforms
    .map(p => `<br>• ${p.name} (${p.urls.join(', ')})`)
    .join('');

  platformsList.innerHTML = platformsHtml;
}

/**
 * Replace all elements with data-i18n attribute with their translated text.
 *
 * `data-i18n-label` is the icon-only variant: those buttons have no text node
 * to translate, so the string becomes their accessible name and tooltip.
 */
function localizeHtmlPage(): void {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    if (key) {
      element.textContent = getMessage(key);
    }
  });

  document.querySelectorAll('[data-i18n-label]').forEach(element => {
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

class PopupController {
  private selectedFormat: ExportFormat = 'md';
  private pairs: QAPair[] = [];
  private view: PopupView = 'main';
  private formatMenuOpen = false;
  private uiState: UiState = 'detecting';
  private routerBound = false;

  async initialize(): Promise<void> {
    // Localize all static text in the HTML
    localizeHtmlPage();

    // Start on the main view, in the detecting state
    this.setView('main');
    this.setFormatMenuOpen(false);
    this.setUiState('detecting');

    // Populate supported platforms list dynamically
    populateSupportedPlatforms();

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
    const timestampsToggle = document.getElementById('option-include-timestamps') as HTMLInputElement;
    if (timestampsToggle) {
      timestampsToggle.checked = prefs.includeTimestamps;
    }

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
  }

  private setUiState(state: UiState): void {
    this.uiState = state;
    this.bodyBox()?.setAttribute('data-ui-state', state);
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

    // Export option toggles
    document.getElementById('option-include-metadata')?.addEventListener('change', (e) => {
      void this.persistPreference({ includeMetadata: (e.target as HTMLInputElement).checked });
    });
    document.getElementById('option-include-timestamps')?.addEventListener('change', (e) => {
      void this.persistPreference({ includeTimestamps: (e.target as HTMLInputElement).checked });
    });

    // Footer links
    document.getElementById('report-issue')?.addEventListener('click', (e) => {
      e.preventDefault();
      void chrome.tabs.create({
        url: 'https://github.com/nuncaeslupus/ai-chat-exporter/issues',
      });
    });
  }

  /** Every preference write goes through here so the Options dot stays honest. */
  private async persistPreference(patch: Parameters<typeof StorageService.setUserPreferences>[0]): Promise<void> {
    await StorageService.setUserPreferences(patch);
    await this.updateOptionsDot();
  }

  private handleFormatChange(format: ExportFormat): void {
    this.selectedFormat = format;
    localStorage.setItem('lastExportFormat', format);
    this.updateExportLabel(format);

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
        this.showNotSupportedMessage();
        return;
      }

      // Try to get conversation from content script
      const message = createMessage<GetConversationMessage>('get_conversation', {});
      const response = await chrome.tabs.sendMessage<unknown, MessageResponse<Conversation> | undefined>(
        tab.id,
        message
      );

      if (response?.success && response.data) {
        this.setUiState('ready');
        this.updateConversationInfo(response.data);
        this.updateStatus('active', getMessage('statusReady'));
        this.enableButtons();
        this.showMainContent();
      } else {
        // Content script loaded but no conversation found
        this.setUiState('unsupported');
        this.updateStatus('warning', getMessage('statusNoConversation'));
        this.showNotSupportedMessage();
      }
    } catch (error) {
      console.error('Failed to check current page:', error);
      // Content script not responding - likely needs page reload
      this.setUiState('reload');
      this.updateStatus('warning', getMessage('statusReloadNeeded'));
      this.showReloadMessage();
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
      // Marks, not wordmarks: at 13px the Gemini logotype is illegible, so the
      // spark is the only readable Gemini asset here.
      const icons: Record<string, string> = {
        chatgpt: '../assets/icons/chatgpt-logo.svg',
        claude: '../assets/icons/claude-logo.svg',
        gemini: '../assets/icons/gemini-spark.svg',
      };
      const defaultIcon = '../assets/icons/chatgpt-logo.svg';
      const iconPath = icons[conversation.platform] ?? defaultIcon;
      platformIcon.src = iconPath;
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
    this.pairs = conversation.pairs.map((pair) => ({ ...pair }));
    this.renderSelectionList();
  }

  /**
   * Render the per-pair checkbox list plus the select-all/select-none toggle
   * and the "N of M selected" summary.
   */
  private renderSelectionList(): void {
    const section = document.getElementById('qa-selection-section');
    const list = document.getElementById('qa-selection-list');
    if (!section || !list) return;

    if (this.pairs.length === 0) {
      section.style.display = 'none';
      this.updateContentRow();
      return;
    }
    section.style.display = 'block';

    list.innerHTML = '';
    this.pairs.forEach((pair) => {
      const item = document.createElement('li');
      item.className = 'qa-selection-item';

      const checkboxId = `qa-pair-${pair.id}`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = checkboxId;
      checkbox.checked = pair.selected;
      checkbox.addEventListener('change', () => {
        this.pairs = SelectionService.toggleSelection(this.pairs, pair.id);
        this.renderSelectionList();
      });

      const label = document.createElement('label');
      label.htmlFor = checkboxId;
      const preview = pair.question.content.trim();
      label.textContent = preview || getMessageWithValues('qaSelectionPairFallbackLabel', pair.index + 1);
      label.title = label.textContent;

      item.appendChild(checkbox);
      item.appendChild(label);
      list.appendChild(item);
    });

    this.updateSelectionSummary();
  }

  private updateSelectionSummary(): void {
    const countEl = document.getElementById('qa-selection-count');
    const toggleAllButton = document.getElementById('qa-selection-toggle-all');

    if (countEl) {
      countEl.textContent = getMessageWithValues(
        'qaSelectionCount',
        SelectionService.getSelectionCount(this.pairs),
        this.pairs.length
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

  /** `Whole conversation`, or `3 of 14 pairs` once something is deselected. */
  private updateContentRow(): void {
    const value = document.getElementById('content-row-value');
    if (!value) return;

    const selected = SelectionService.getSelectionCount(this.pairs);
    const total = this.pairs.length;
    value.textContent =
      total > 0 && selected < total
        ? getMessageWithValues('rowContentPartial', formatNumber(selected), formatNumber(total))
        : getMessage('rowContentAll');
  }

  /** Green dot on the Options row: some preference is off its default. */
  private async updateOptionsDot(): Promise<void> {
    const dot = document.getElementById('options-changed-dot');
    if (!dot) return;

    const prefs = await StorageService.getUserPreferences();
    dot.hidden = (Object.keys(DEFAULT_PREFERENCES) as (keyof typeof DEFAULT_PREFERENCES)[]).every(
      (key) => prefs[key] === DEFAULT_PREFERENCES[key]
    );
  }

  private updateExportLabel(format: ExportFormat): void {
    const label = document.getElementById('export-button-label');
    if (label) {
      label.textContent = getMessageWithValues('exportButtonFormat', getFormatName(format));
    }
  }

  private enableButtons(): void {
    const exportButton = document.getElementById('export-button') as HTMLButtonElement;
    if (exportButton) exportButton.disabled = false;
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
        this.setUiState('warning');
        this.updateStatus('warning', getMessage('statusArtifactsMissing'), response.warning);
        return;
      }
      window.close(); // Close popup after triggering export
    } catch (error) {
      console.error('Export failed:', error);
      this.setUiState('error');
      this.updateStatus('error', error instanceof Error ? error.message : getMessage('statusExportFailed'));
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
        this.setUiState('warning');
        this.updateStatus('warning', getMessage('statusArtifactsMissing'), response.warning);
        return;
      }
      window.close(); // Close popup after triggering print
    } catch (error) {
      console.error('Print failed:', error);
      this.setUiState('error');
      this.updateStatus('error', getMessage('statusPrintFailed'));
    }
  }

  private showNotSupportedMessage(): void {
    const notSupportedSection = document.getElementById('not-supported-section');
    const mainContent = document.getElementById('main-content');

    if (notSupportedSection) {
      notSupportedSection.style.display = 'block';
    }
    if (mainContent) {
      mainContent.style.display = 'none';
    }
  }

  private showMainContent(): void {
    const notSupportedSection = document.getElementById('not-supported-section');
    const mainContent = document.getElementById('main-content');

    if (notSupportedSection) {
      notSupportedSection.style.display = 'none';
    }
    if (mainContent) {
      // Flex, not block: the setting rows rely on `margin-top:auto` inside it.
      mainContent.style.display = 'flex';
    }
  }

  private showReloadMessage(): void {
    const notSupportedSection = document.getElementById('not-supported-section');
    const mainContent = document.getElementById('main-content');

    if (mainContent) {
      mainContent.style.display = 'none';
    }

    if (notSupportedSection) {
      notSupportedSection.style.display = 'block';
      // Replace the message with reload instructions
      notSupportedSection.innerHTML = `
        <div class="not-supported-message">
          <svg class="not-supported-icon" width="48" height="48" viewBox="0 0 24 24" fill="none">
            <path d="M21 10C21 10 18.995 7.26822 17.3662 5.63824C15.7373 4.00827 13.4864 3 11 3C6.02944 3 2 7.02944 2 12C2 16.9706 6.02944 21 11 21C15.1031 21 18.5649 18.2543 19.6482 14.5M21 10V4M21 10H15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <h3 class="not-supported-title">${getMessage('reloadRequiredTitle')}</h3>
          <p class="not-supported-text">
            ${getMessage('reloadRequiredMessage')}
            <br><br>
            <strong>${getMessage('howToReload')}</strong>
            <br>• ${getMessage('reloadInstructionKeyboard')}
            <br>• ${getMessage('reloadInstructionButton')}
          </p>
        </div>
      `;
    }
  }
}

// Initialize popup
const popup = new PopupController();
document.addEventListener('DOMContentLoaded', () => {
  void popup.initialize();
});
