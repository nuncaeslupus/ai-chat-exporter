/**
 * ConfirmationModal Component
 * Modal dialog for confirming export with options
 */

import type { ExportFormat } from '../../../core/types/exporter';

export interface ConfirmationModalOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: (options: ExportModalOptions) => void;
  onCancel?: () => void;
  showFormatSelection?: boolean;
  showMetadataOption?: boolean;
  defaultFormat?: ExportFormat;
  defaultIncludeMetadata?: boolean;
}

export interface ExportModalOptions {
  format?: ExportFormat;
  includeMetadata: boolean;
}

export class ConfirmationModal {
  private element: HTMLElement;
  private overlay: HTMLElement;
  private isOpen = false;
  private options: Required<ConfirmationModalOptions>;
  private selectedFormat: ExportFormat;
  private includeMetadata: boolean;

  constructor(options: ConfirmationModalOptions = {}) {
    this.options = {
      title: 'Confirm Export',
      message: 'Are you sure you want to export this conversation?',
      confirmLabel: 'Export',
      cancelLabel: 'Cancel',
      onConfirm: () => {},
      onCancel: () => {},
      showFormatSelection: true,
      showMetadataOption: true,
      defaultFormat: 'pdf',
      defaultIncludeMetadata: true,
      ...options,
    };

    this.selectedFormat = this.options.defaultFormat;
    this.includeMetadata = this.options.defaultIncludeMetadata;

    this.overlay = this.createOverlay();
    this.element = this.createElement();
    this.overlay.appendChild(this.element);
    this.attachEventListeners();
  }

  private createOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'ace-component ace-modal-overlay ace-hidden';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'ace-modal-title');
    return overlay;
  }

  private createElement(): HTMLElement {
    const modal = document.createElement('div');
    modal.className = 'ace-modal ace-confirmation-modal';

    const header = this.createHeader();
    const body = this.createBody();
    const footer = this.createFooter();

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);

    return modal;
  }

  private createHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'ace-modal-header';

    header.innerHTML = `
      <h2 id="ace-modal-title" class="ace-modal-title">${this.escapeHtml(this.options.title)}</h2>
    `;

    return header;
  }

  private createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'ace-modal-body ace-confirmation-body';

    let content = `
      <p class="ace-confirmation-message">${this.escapeHtml(this.options.message)}</p>
    `;

    if (this.options.showFormatSelection) {
      content += `
        <div class="ace-confirmation-option">
          <label class="ace-confirmation-label">Export Format</label>
          <select class="ace-confirmation-select ace-format-select">
            <option value="pdf" ${this.selectedFormat === 'pdf' ? 'selected' : ''}>PDF</option>
            <option value="md" ${this.selectedFormat === 'md' ? 'selected' : ''}>Markdown</option>
            <option value="txt" ${this.selectedFormat === 'txt' ? 'selected' : ''}>Plain Text</option>
            <option value="json" ${this.selectedFormat === 'json' ? 'selected' : ''}>JSON</option>
            <option value="docx" ${this.selectedFormat === 'docx' ? 'selected' : ''}>Word Document</option>
          </select>
        </div>
      `;
    }

    if (this.options.showMetadataOption) {
      content += `
        <div class="ace-confirmation-option">
          <label class="ace-checkbox">
            <input
              type="checkbox"
              class="ace-checkbox-input ace-metadata-checkbox"
              ${this.includeMetadata ? 'checked' : ''}
            />
            <span class="ace-checkbox-label">Include metadata (date, model, platform)</span>
          </label>
        </div>
      `;
    }

    body.innerHTML = content;
    return body;
  }

  private createFooter(): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'ace-modal-footer';

    footer.innerHTML = `
      <button type="button" class="ace-btn ace-btn-secondary ace-cancel-btn">
        ${this.escapeHtml(this.options.cancelLabel)}
      </button>
      <button type="button" class="ace-btn ace-btn-primary ace-confirm-btn">
        ${this.escapeHtml(this.options.confirmLabel)}
      </button>
    `;

    return footer;
  }

  private attachEventListeners(): void {
    // Close on overlay click
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) {
        this.cancel();
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen) {
        this.cancel();
      }
    });

    // Format selection
    const formatSelect = this.element.querySelector('.ace-format-select') as HTMLSelectElement;
    if (formatSelect) {
      formatSelect.addEventListener('change', () => {
        this.selectedFormat = formatSelect.value as ExportFormat;
      });
    }

    // Metadata checkbox
    const metadataCheckbox = this.element.querySelector(
      '.ace-metadata-checkbox',
    ) as HTMLInputElement;
    if (metadataCheckbox) {
      metadataCheckbox.addEventListener('change', () => {
        this.includeMetadata = metadataCheckbox.checked;
      });
    }

    // Confirm button
    const confirmBtn = this.element.querySelector('.ace-confirm-btn');
    confirmBtn?.addEventListener('click', () => {
      this.confirm();
    });

    // Cancel button
    const cancelBtn = this.element.querySelector('.ace-cancel-btn');
    cancelBtn?.addEventListener('click', () => {
      this.cancel();
    });
  }

  private confirm(): void {
    const exportOptions: ExportModalOptions = {
      includeMetadata: this.includeMetadata,
    };

    // Only include format if format selection is shown and a format is selected
    if (this.options.showFormatSelection && this.selectedFormat) {
      exportOptions.format = this.selectedFormat;
    }

    this.options.onConfirm(exportOptions);
    this.close();
  }

  private cancel(): void {
    this.options.onCancel();
    this.close();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  public open(): void {
    if (this.isOpen) return;

    this.isOpen = true;
    document.body.appendChild(this.overlay);
    this.overlay.classList.remove('ace-hidden');

    // Focus the confirm button
    setTimeout(() => {
      const confirmBtn = this.element.querySelector(
        '.ace-confirm-btn',
      ) as HTMLButtonElement;
      confirmBtn?.focus();
    }, 100);
  }

  public close(): void {
    if (!this.isOpen) return;

    this.isOpen = false;
    this.overlay.classList.add('ace-hidden');

    setTimeout(() => {
      if (this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
    }, 200);
  }

  public setTitle(title: string): void {
    this.options.title = title;
    const titleElement = this.element.querySelector('#ace-modal-title');
    if (titleElement) {
      titleElement.textContent = title;
    }
  }

  public setMessage(message: string): void {
    this.options.message = message;
    const messageElement = this.element.querySelector('.ace-confirmation-message');
    if (messageElement) {
      messageElement.textContent = message;
    }
  }

  public getElement(): HTMLElement {
    return this.overlay;
  }

  public destroy(): void {
    this.close();
    this.overlay.remove();
  }
}
