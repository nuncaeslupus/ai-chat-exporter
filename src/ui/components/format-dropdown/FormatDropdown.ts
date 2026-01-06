/**
 * FormatDropdown Component
 * Dropdown menu for selecting export format
 */

import type { ExportFormat } from '../../../core/types/exporter';

export interface FormatOption {
  format: ExportFormat;
  label: string;
  description?: string;
  icon?: string;
}

export interface FormatDropdownOptions {
  formats?: FormatOption[];
  onSelect?: (format: ExportFormat) => void;
  selectedFormat?: ExportFormat;
  anchorElement?: HTMLElement;
}

const DEFAULT_FORMATS: FormatOption[] = [
  {
    format: 'md',
    label: 'Markdown',
    description: 'Plain text with formatting',
    icon: 'markdown',
  },
  {
    format: 'html',
    label: 'HTML Document',
    description: 'Web page format',
    icon: 'html',
  },
  {
    format: 'pdf',
    label: 'PDF',
    description: 'Portable Document Format',
    icon: 'pdf',
  },
  {
    format: 'docx',
    label: 'Word Document',
    description: 'Microsoft Word format',
    icon: 'word',
  },
  {
    format: 'txt',
    label: 'Plain Text',
    description: 'Simple text file',
    icon: 'text',
  },
  {
    format: 'json',
    label: 'JSON',
    description: 'Structured data format',
    icon: 'json',
  },
];

export class FormatDropdown {
  private element: HTMLElement;
  private isOpen = false;
  private options: Required<FormatDropdownOptions>;
  private clickOutsideHandler: (event: MouseEvent) => void;

  constructor(options: FormatDropdownOptions = {}) {
    this.options = {
      formats: DEFAULT_FORMATS,
      onSelect: () => {},
      selectedFormat: 'pdf',
      anchorElement: document.body,
      ...options,
    };

    this.element = this.createElement();
    this.clickOutsideHandler = this.handleClickOutside.bind(this);
    this.attachEventListeners();
  }

  private createElement(): HTMLElement {
    const dropdown = document.createElement('div');
    dropdown.className = 'ace-component ace-dropdown-menu ace-format-dropdown ace-hidden';
    dropdown.setAttribute('role', 'menu');
    dropdown.setAttribute('aria-label', 'Export format selection');

    const items = this.options.formats
      .map((formatOption) => {
        const isSelected = formatOption.format === this.options.selectedFormat;
        return `
        <button
          type="button"
          class="ace-dropdown-item ace-format-item ${isSelected ? 'ace-format-item-selected' : ''}"
          role="menuitem"
          data-format="${formatOption.format}"
          aria-label="Export as ${formatOption.label}"
        >
          <span class="ace-format-icon ace-format-icon-${formatOption.icon || formatOption.format}"></span>
          <div class="ace-format-details">
            <div class="ace-format-label">${formatOption.label}</div>
            ${formatOption.description ? `<div class="ace-format-description">${formatOption.description}</div>` : ''}
          </div>
          ${isSelected ? '<span class="ace-format-check">✓</span>' : ''}
        </button>
      `;
      })
      .join('');

    dropdown.innerHTML = items;
    return dropdown;
  }

  private attachEventListeners(): void {
    this.element.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const item = target.closest('.ace-format-item') as HTMLButtonElement;

      if (item && item.dataset.format) {
        const format = item.dataset.format as ExportFormat;
        this.selectFormat(format);
      }
    });
  }

  private handleClickOutside(event: MouseEvent): void {
    const target = event.target as Node;
    if (!this.element.contains(target) && !this.options.anchorElement?.contains(target)) {
      this.close();
    }
  }

  private selectFormat(format: ExportFormat): void {
    this.options.selectedFormat = format;
    this.updateSelectedState();
    this.options.onSelect(format);
    this.close();
  }

  private updateSelectedState(): void {
    const items = this.element.querySelectorAll('.ace-format-item');
    items.forEach((item) => {
      const button = item as HTMLButtonElement;
      const format = button.dataset.format;
      const isSelected = format === this.options.selectedFormat;

      button.classList.toggle('ace-format-item-selected', isSelected);

      // Update check mark
      const existingCheck = button.querySelector('.ace-format-check');
      if (isSelected && !existingCheck) {
        const check = document.createElement('span');
        check.className = 'ace-format-check';
        check.textContent = '✓';
        button.appendChild(check);
      } else if (!isSelected && existingCheck) {
        existingCheck.remove();
      }
    });
  }

  public open(): void {
    if (this.isOpen) return;

    this.isOpen = true;
    this.element.classList.remove('ace-hidden');

    // Position dropdown relative to anchor
    this.positionDropdown();

    // Listen for clicks outside
    setTimeout(() => {
      document.addEventListener('click', this.clickOutsideHandler);
    }, 0);
  }

  public close(): void {
    if (!this.isOpen) return;

    this.isOpen = false;
    this.element.classList.add('ace-hidden');
    document.removeEventListener('click', this.clickOutsideHandler);
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private positionDropdown(): void {
    if (!this.options.anchorElement) return;

    const anchorRect = this.options.anchorElement.getBoundingClientRect();
    const dropdownRect = this.element.getBoundingClientRect();

    // Position below the anchor
    let top = anchorRect.bottom + 4;
    let left = anchorRect.left;

    // Adjust if dropdown goes off-screen to the right
    if (left + dropdownRect.width > window.innerWidth) {
      left = anchorRect.right - dropdownRect.width;
    }

    // Adjust if dropdown goes off-screen to the bottom
    if (top + dropdownRect.height > window.innerHeight) {
      top = anchorRect.top - dropdownRect.height - 4;
    }

    this.element.style.position = 'fixed';
    this.element.style.top = `${top}px`;
    this.element.style.left = `${left}px`;
  }

  public setAnchor(element: HTMLElement): void {
    this.options.anchorElement = element;
  }

  public setSelectedFormat(format: ExportFormat): void {
    this.options.selectedFormat = format;
    this.updateSelectedState();
  }

  public getSelectedFormat(): ExportFormat {
    return this.options.selectedFormat;
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public destroy(): void {
    this.close();
    this.element.remove();
  }
}
