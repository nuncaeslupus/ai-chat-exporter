/**
 * ExportButton Component
 * Main export button that opens format dropdown or triggers last used export
 */

export interface ExportButtonOptions {
  onClick?: () => void;
  onDropdownToggle?: (isOpen: boolean) => void;
  label?: string;
  showDropdown?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

export class ExportButton {
  private element: HTMLElement;
  private button: HTMLButtonElement;
  private dropdownButton?: HTMLButtonElement;
  private isDropdownOpen = false;
  private options: Required<ExportButtonOptions>;

  constructor(options: ExportButtonOptions = {}) {
    this.options = {
      onClick: () => {},
      onDropdownToggle: () => {},
      label: 'Export',
      showDropdown: true,
      variant: 'primary',
      size: 'md',
      disabled: false,
      ...options,
    };

    this.element = this.createElement();
    this.button = this.element.querySelector(
      '.ace-export-button-main',
    ) as HTMLButtonElement;

    if (this.options.showDropdown) {
      this.dropdownButton = this.element.querySelector(
        '.ace-export-button-dropdown',
      ) as HTMLButtonElement;
    }

    this.attachEventListeners();
  }

  private createElement(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'ace-component ace-export-button-container';

    if (this.options.showDropdown) {
      // Button with dropdown arrow
      container.innerHTML = `
        <div class="ace-export-button-group">
          <button
            type="button"
            class="ace-btn ace-btn-${this.options.variant} ace-btn-${this.options.size} ace-export-button-main"
            ${this.options.disabled ? 'disabled' : ''}
            aria-label="${this.options.label}"
          >
            <svg class="ace-export-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 1V10M8 10L5 7M8 10L11 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2 10V13C2 13.5304 2.21071 14.0391 2.58579 14.4142C2.96086 14.7893 3.46957 15 4 15H12C12.5304 15 13.0391 14.7893 13.4142 14.4142C13.7893 14.0391 14 13.5304 14 13V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>${this.options.label}</span>
          </button>
          <button
            type="button"
            class="ace-btn ace-btn-${this.options.variant} ace-btn-${this.options.size} ace-export-button-dropdown"
            ${this.options.disabled ? 'disabled' : ''}
            aria-label="Show export options"
            aria-expanded="false"
            aria-haspopup="true"
          >
            <svg class="ace-dropdown-icon" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      `;
    } else {
      // Simple button without dropdown
      container.innerHTML = `
        <button
          type="button"
          class="ace-btn ace-btn-${this.options.variant} ace-btn-${this.options.size} ace-export-button-main"
          ${this.options.disabled ? 'disabled' : ''}
          aria-label="${this.options.label}"
        >
          <svg class="ace-export-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 1V10M8 10L5 7M8 10L11 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 10V13C2 13.5304 2.21071 14.0391 2.58579 14.4142C2.96086 14.7893 3.46957 15 4 15H12C12.5304 15 13.0391 14.7893 13.4142 14.4142C13.7893 14.0391 14 13.5304 14 13V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>${this.options.label}</span>
        </button>
      `;
    }

    return container;
  }

  private attachEventListeners(): void {
    this.button.addEventListener('click', () => {
      if (!this.options.disabled) {
        this.options.onClick();
      }
    });

    if (this.dropdownButton) {
      this.dropdownButton.addEventListener('click', () => {
        if (!this.options.disabled) {
          this.toggleDropdown();
        }
      });
    }
  }

  private toggleDropdown(): void {
    this.isDropdownOpen = !this.isDropdownOpen;
    if (this.dropdownButton) {
      this.dropdownButton.setAttribute(
        'aria-expanded',
        this.isDropdownOpen.toString(),
      );
    }
    this.options.onDropdownToggle(this.isDropdownOpen);
  }

  public setLabel(label: string): void {
    this.options.label = label;
    const span = this.button.querySelector('span');
    if (span) {
      span.textContent = label;
    }
  }

  public setDisabled(disabled: boolean): void {
    this.options.disabled = disabled;
    this.button.disabled = disabled;
    if (this.dropdownButton) {
      this.dropdownButton.disabled = disabled;
    }
  }

  public setLoading(loading: boolean): void {
    if (loading) {
      this.button.classList.add('ace-export-button-loading');
      this.button.disabled = true;
      if (this.dropdownButton) {
        this.dropdownButton.disabled = true;
      }
    } else {
      this.button.classList.remove('ace-export-button-loading');
      this.button.disabled = this.options.disabled;
      if (this.dropdownButton) {
        this.dropdownButton.disabled = this.options.disabled;
      }
    }
  }

  public closeDropdown(): void {
    if (this.isDropdownOpen) {
      this.toggleDropdown();
    }
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public destroy(): void {
    this.element.remove();
  }
}
