/**
 * SelectionPanel Component
 * Panel for selecting Q&A pairs to include in export
 */

import type { QAPair } from '../../../core/types/conversation';
import { getMessage } from '../../../shared/i18n';

export interface SelectionPanelOptions {
  pairs?: QAPair[];
  onSelectionChange?: (selectedPairs: QAPair[]) => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  maxHeight?: string;
}

export class SelectionPanel {
  private element: HTMLElement;
  private pairs: QAPair[] = [];
  private options: Required<SelectionPanelOptions>;
  private checkboxes: Map<string, HTMLInputElement> = new Map();

  constructor(options: SelectionPanelOptions = {}) {
    this.options = {
      pairs: [],
      onSelectionChange: () => {},
      onSelectAll: () => {},
      onDeselectAll: () => {},
      maxHeight: '400px',
      ...options,
    };

    this.pairs = this.options.pairs;
    this.element = this.createElement();
    this.attachEventListeners();
  }

  private createElement(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'ace-component ace-panel ace-selection-panel';

    const header = this.createHeader();
    const body = this.createBody();

    panel.appendChild(header);
    panel.appendChild(body);

    return panel;
  }

  private createHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'ace-panel-header ace-selection-header';

    const selectedCount = this.pairs.filter((p) => p.selected).length;
    const totalCount = this.pairs.length;

    header.innerHTML = `
      <div class="ace-selection-header-content">
        <h3 class="ace-panel-title">Select Q&A Pairs</h3>
        <span class="ace-selection-count">${selectedCount} of ${totalCount} selected</span>
      </div>
      <div class="ace-selection-actions">
        <button type="button" class="ace-btn ace-btn-ghost ace-btn-sm ace-select-all-btn">
          Select All
        </button>
        <button type="button" class="ace-btn ace-btn-ghost ace-btn-sm ace-deselect-all-btn">
          Deselect All
        </button>
      </div>
    `;

    return header;
  }

  private createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'ace-panel-body ace-selection-body';
    body.style.maxHeight = this.options.maxHeight;

    if (this.pairs.length === 0) {
      body.innerHTML = `
        <div class="ace-selection-empty">
          <p>No Q&A pairs found in this conversation.</p>
        </div>
      `;
      return body;
    }

    const list = document.createElement('div');
    list.className = 'ace-selection-list';

    this.pairs.forEach((pair) => {
      const item = this.createPairItem(pair);
      list.appendChild(item);
    });

    body.appendChild(list);
    return body;
  }

  private createPairItem(pair: QAPair): HTMLElement {
    const item = document.createElement('label');
    item.className = 'ace-checkbox ace-selection-item';
    item.dataset.pairId = pair.id;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'ace-checkbox-input';
    checkbox.checked = pair.selected;
    checkbox.dataset.pairId = pair.id;

    this.checkboxes.set(pair.id, checkbox);

    const content = document.createElement('div');
    content.className = 'ace-selection-item-content';

    const questionPreview = this.truncateText(pair.question.content, 100);
    const answerPreview = this.truncateText(pair.answer.content, 100);

    // Detect content types for tags
    const tags = this.getContentTags(pair);
    const tagsHtml = tags.length > 0
      ? `<div class="ace-content-tags">${tags.map(tag => this.createTag(tag)).join('')}</div>`
      : '';

    content.innerHTML = `
      <div class="ace-selection-item-header">
        <span class="ace-selection-item-number">Q&A #${pair.index + 1}</span>
        ${tagsHtml}
      </div>
      <div class="ace-selection-item-preview">
        <div class="ace-selection-question">
          <strong>Q:</strong>
          <span>${this.escapeHtml(questionPreview)}</span>
        </div>
        <div class="ace-selection-answer">
          <strong>A:</strong>
          <span>${this.escapeHtml(answerPreview)}</span>
        </div>
      </div>
    `;

    item.appendChild(checkbox);
    item.appendChild(content);

    return item;
  }

  private getContentTags(pair: QAPair): Array<{type: string; label: string; icon: string}> {
    const tags: Array<{type: string; label: string; icon: string}> = [];

    // Check for code blocks
    const hasCode = pair.answer.content?.includes('```') ||
                    pair.answer.htmlContent?.includes('<code') ||
                    pair.answer.htmlContent?.includes('<pre');
    if (hasCode) {
      tags.push({ type: 'code', label: getMessage('contentTagCode'), icon: '💻' });
    }

    // Check for images
    const images = pair.answer.metadata?.images;
    const hasImages = images && Array.isArray(images) && images.length > 0;
    if (hasImages) {
      const imageCount = (images as any[]).length;
      const label = imageCount > 1
        ? getMessage('contentTagImages', imageCount.toString())
        : getMessage('contentTagImage');
      tags.push({
        type: 'image',
        label,
        icon: '🖼️'
      });
    }

    // Check for canvas content
    const hasCanvas = pair.answer.content?.includes('[Canvas Content]');
    if (hasCanvas) {
      tags.push({ type: 'canvas', label: getMessage('contentTagCanvas'), icon: '📄' });
    }

    // Check for deep research
    const hasResearch = pair.answer.metadata?.research;
    if (hasResearch) {
      tags.push({ type: 'research', label: getMessage('contentTagDeepResearch'), icon: '🔍' });
    }

    return tags;
  }

  private createTag(tag: {type: string; label: string; icon: string}): string {
    return `<span class="ace-content-tag ace-tag-${tag.type}" title="${tag.label}">${tag.icon} ${tag.label}</span>`;
  }

  private attachEventListeners(): void {
    // Select all button
    const selectAllBtn = this.element.querySelector('.ace-select-all-btn');
    selectAllBtn?.addEventListener('click', () => {
      this.selectAll();
      this.options.onSelectAll();
    });

    // Deselect all button
    const deselectAllBtn = this.element.querySelector('.ace-deselect-all-btn');
    deselectAllBtn?.addEventListener('click', () => {
      this.deselectAll();
      this.options.onDeselectAll();
    });

    // Individual checkboxes
    this.element.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement;
      if (target.classList.contains('ace-checkbox-input')) {
        const pairId = target.dataset.pairId;
        if (pairId) {
          this.togglePair(pairId, target.checked);
        }
      }
    });
  }

  private togglePair(pairId: string, selected: boolean): void {
    const pair = this.pairs.find((p) => p.id === pairId);
    if (pair) {
      pair.selected = selected;
      this.updateSelectionCount();
      this.notifySelectionChange();
    }
  }

  private selectAll(): void {
    this.pairs.forEach((pair) => {
      pair.selected = true;
      const checkbox = this.checkboxes.get(pair.id);
      if (checkbox) {
        checkbox.checked = true;
      }
    });
    this.updateSelectionCount();
    this.notifySelectionChange();
  }

  private deselectAll(): void {
    this.pairs.forEach((pair) => {
      pair.selected = false;
      const checkbox = this.checkboxes.get(pair.id);
      if (checkbox) {
        checkbox.checked = false;
      }
    });
    this.updateSelectionCount();
    this.notifySelectionChange();
  }

  private updateSelectionCount(): void {
    const selectedCount = this.pairs.filter((p) => p.selected).length;
    const totalCount = this.pairs.length;
    const countElement = this.element.querySelector('.ace-selection-count');
    if (countElement) {
      countElement.textContent = `${selectedCount} of ${totalCount} selected`;
    }
  }

  private notifySelectionChange(): void {
    const selectedPairs = this.pairs.filter((p) => p.selected);
    this.options.onSelectionChange(selectedPairs);
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength) + '...';
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  public setPairs(pairs: QAPair[]): void {
    this.pairs = pairs;
    this.checkboxes.clear();

    // Rebuild the panel
    const header = this.element.querySelector('.ace-panel-header');
    const body = this.element.querySelector('.ace-panel-body');

    if (header && body) {
      const newHeader = this.createHeader();
      const newBody = this.createBody();

      this.element.replaceChild(newHeader, header);
      this.element.replaceChild(newBody, body);
    }

    this.attachEventListeners();
  }

  public getSelectedPairs(): QAPair[] {
    return this.pairs.filter((p) => p.selected);
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public destroy(): void {
    this.checkboxes.clear();
    this.element.remove();
  }
}
