/**
 * Popup script for AI Chat Exporter extension
 */

import { createMessage, type GetConversationMessage } from '../../shared/messages';
import type { Conversation } from '../../core/types/conversation';
import type { ExportFormat } from '../../core/types/exporter';
import { getMessage, formatNumber, getPlatformName } from '../../shared/i18n';
import { parserRegistry } from '../../core/parsers';

/**
 * Platform information for display
 */
interface PlatformInfo {
  name: string;
  urls: string[];
}

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
 * Replace all elements with data-i18n attribute with their translated text
 */
function localizeHtmlPage(): void {
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(element => {
    const key = element.getAttribute('data-i18n');
    if (key) {
      const message = getMessage(key);
      element.textContent = message;
    }
  });
}

class PopupController {
  private selectedFormat: ExportFormat = 'pdf';

  async initialize(): Promise<void> {
    // Localize all static text in the HTML
    localizeHtmlPage();

    // Populate supported platforms list dynamically
    populateSupportedPlatforms();

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
      const formatSelect = document.getElementById('format-select') as HTMLSelectElement;
      if (formatSelect) {
        formatSelect.value = lastFormat;
      }
      // Update icon and print button state
      this.updateFormatIcon(lastFormat);
      this.handleFormatChange(lastFormat);
    }
  }

  private setupEventListeners(): void {
    // Format selection
    document.getElementById('format-select')?.addEventListener('change', (e) => {
      const format = (e.target as HTMLSelectElement).value as ExportFormat;
      this.handleFormatChange(format);
      this.updateFormatIcon(format);
    });

    // Export button
    document.getElementById('export-button')?.addEventListener('click', () => {
      this.handleExport(this.selectedFormat);
    });

    // Print button
    document.getElementById('print-button')?.addEventListener('click', () => {
      this.handlePrint();
    });

    // Footer links
    document.getElementById('report-issue')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({
        url: 'https://github.com/nuncaeslupus/ai-chat-exporter/issues',
      });
    });
  }

  private handleFormatChange(format: ExportFormat): void {
    this.selectedFormat = format;
    localStorage.setItem('lastExportFormat', format);

    // Disable print button for formats that can't be printed nicely
    const printButton = document.getElementById('print-button') as HTMLButtonElement;
    if (printButton) {
      // Only allow print for HTML, PDF, TXT, MD, and JSON
      const printableFormats: ExportFormat[] = ['html', 'pdf', 'txt', 'md', 'json'];
      const canPrint = printableFormats.includes(format);
      printButton.disabled = !canPrint;
      printButton.title = canPrint ? `Print ${format.toUpperCase()}` : `Print not available for ${format.toUpperCase()}`;
    }
  }

  private updateFormatIcon(format: ExportFormat): void {
    const formatIcon = document.getElementById('format-icon') as HTMLImageElement;
    if (formatIcon) {
      formatIcon.src = `../assets/icons/${format}-icon.svg`;
    }
  }

  private async checkCurrentPage(): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        this.updateStatus('error', 'No active tab');
        return;
      }

      // Check if we're on a supported page
      const supportedDomains = [
        'chat.openai.com',
        'chatgpt.com',
        // TODO: Add when parsers are implemented
        // 'claude.ai',
        // 'gemini.google.com',
      ];

      const url = tab.url ? new URL(tab.url) : null;
      if (!url || !supportedDomains.some((domain) => url.hostname.includes(domain))) {
        this.updateStatus('inactive', getMessage('statusNotSupported'));
        this.showNotSupportedMessage();
        return;
      }

      // Try to get conversation from content script
      const message = createMessage<GetConversationMessage>('get_conversation', {});
      const response = await chrome.tabs.sendMessage(tab.id, message);

      if (response?.success && response.data) {
        this.updateConversationInfo(response.data);
        this.updateStatus('active', getMessage('statusReady'));
        this.enableButtons();
        this.showMainContent();
      } else {
        // Content script loaded but no conversation found
        this.updateStatus('warning', getMessage('statusNoConversation'));
        this.showNotSupportedMessage();
      }
    } catch (error) {
      console.error('Failed to check current page:', error);
      // Content script not responding - likely needs page reload
      this.updateStatus('warning', getMessage('statusReloadNeeded'));
      this.showReloadMessage();
    }
  }

  private updateStatus(status: 'active' | 'inactive' | 'warning' | 'error', text: string): void {
    const indicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');

    if (indicator && statusText) {
      indicator.className = `status-indicator ${status}`;
      statusText.textContent = text;
    }
  }

  private updateConversationInfo(conversation: Conversation): void {
    const platformIcon = document.getElementById('platform-icon') as HTMLImageElement;
    const title = document.getElementById('conversation-title');
    const meta = document.getElementById('conversation-meta');

    if (platformIcon) {
      // Set platform icon based on platform
      const icons: Record<string, string> = {
        chatgpt: '../assets/icons/chatgpt-logo.svg',
        claude: '../assets/icons/claude-logo.svg',
        gemini: '../assets/icons/gemini-logo.svg',
      };
      const defaultIcon = '../assets/icons/chatgpt-logo.svg';
      const iconPath = icons[conversation.platform] ?? defaultIcon;
      platformIcon.src = iconPath;
      platformIcon.style.display = 'block';
      platformIcon.alt = `${conversation.platform} logo`;
    }

    if (title) {
      const titleText = conversation.title || 'Untitled';
      title.textContent = titleText;
      title.title = titleText;
    }

    if (meta) {
      const stats = this.calculateConversationStats(conversation);
      meta.innerHTML = this.formatConversationStats(stats);
    }
  }

  private calculateConversationStats(conversation: Conversation) {
    const pairCount = conversation.pairs.length;
    let wordCount = 0;
    let hasCode = false;
    let hasImages = false;

    // Count words and check for code/images
    conversation.pairs.forEach(pair => {
      // Count words in question
      wordCount += this.countWords(pair.question.content);

      // Count words in answer
      wordCount += this.countWords(pair.answer.content);

      // Check for code snippets in both content and htmlContent
      if (!hasCode) {
        hasCode = this.hasCodeContent(pair.question.content) ||
                  this.hasCodeContent(pair.answer.content) ||
                  this.hasCodeContent(pair.question.htmlContent || '') ||
                  this.hasCodeContent(pair.answer.htmlContent || '');
      }

      // Check for images in both content and htmlContent
      if (!hasImages) {
        hasImages = this.hasImageContent(pair.question.content) ||
                    this.hasImageContent(pair.answer.content) ||
                    this.hasImageContent(pair.question.htmlContent || '') ||
                    this.hasImageContent(pair.answer.htmlContent || '');
      }
    });

    return { pairCount, wordCount, hasCode, hasImages };
  }

  private countWords(text: string): number {
    // Remove code blocks to avoid counting code as words
    const textWithoutCode = text.replace(/```[\s\S]*?```/g, '')
                                .replace(/`[^`]+`/g, '');
    // Split by whitespace and filter empty strings
    return textWithoutCode.split(/\s+/).filter(word => word.length > 0).length;
  }

  private hasCodeContent(text: string): boolean {
    // Check for markdown code blocks, inline code, or HTML code tags
    return /```[\s\S]*?```/.test(text) ||
           /`[^`]+`/.test(text) ||
           /<code[\s>]/.test(text) ||
           /<pre[\s>]/.test(text);
  }

  private hasImageContent(text: string): boolean {
    // Check for markdown images or HTML img tags
    return /!\[.*?\]\(.*?\)/.test(text) || /<img[\s>]/.test(text);
  }

  private formatConversationStats(stats: { pairCount: number; wordCount: number; hasCode: boolean; hasImages: boolean }): string {
    const items: string[] = [];

    // Q&A pairs: x
    const pairLabel = stats.pairCount === 1 ? getMessage('qaPairSingular') : getMessage('qaPairPlural');
    items.push(`${pairLabel.charAt(0).toUpperCase() + pairLabel.slice(1)}: ${formatNumber(stats.pairCount)}`);

    // Words: y
    const wordLabel = getMessage('wordCount');
    items.push(`${wordLabel.charAt(0).toUpperCase() + wordLabel.slice(1)}: ${formatNumber(stats.wordCount)}`);

    // Badges as inline tags
    const tags: string[] = [];
    if (stats.hasCode) {
      tags.push(getMessage('badgeCode'));
    }
    if (stats.hasImages) {
      tags.push(getMessage('badgeImages'));
    }

    // Join with semicolons, add tags at the end if present
    let result = items.join('; ');
    if (tags.length > 0) {
      result += '; ' + tags.join(' ');
    }

    return result;
  }

  private enableButtons(): void {
    const exportButton = document.getElementById('export-button') as HTMLButtonElement;
    const printButton = document.getElementById('print-button') as HTMLButtonElement;
    const formatSelect = document.getElementById('format-select') as HTMLSelectElement;

    if (exportButton) exportButton.disabled = false;
    if (printButton) printButton.disabled = false;
    if (formatSelect) formatSelect.disabled = false;
  }

  private async handleExport(format: ExportFormat): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('No active tab found');
      }

      const message = {
        type: 'export_conversation',
        format,
        timestamp: Date.now(),
      };

      await chrome.tabs.sendMessage(tab.id, message);
      window.close(); // Close popup after triggering export
    } catch (error) {
      console.error('Export failed:', error);
      this.updateStatus('error', 'Export failed');
    }
  }

  private async handlePrint(): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('No active tab found');
      }

      const message = {
        type: 'print_conversation',
        format: this.selectedFormat,
        timestamp: Date.now(),
      };

      await chrome.tabs.sendMessage(tab.id, message);
      window.close(); // Close popup after triggering print
    } catch (error) {
      console.error('Print failed:', error);
      this.updateStatus('error', 'Print failed');
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
      mainContent.style.display = 'block';
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
  popup.initialize();
});
