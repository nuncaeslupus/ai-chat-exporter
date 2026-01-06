/**
 * PrintButton Component
 * Button to trigger print functionality
 */

export interface PrintButtonOptions {
  onClick?: () => void;
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

export class PrintButton {
  private element: HTMLButtonElement;
  private options: Required<PrintButtonOptions>;

  constructor(options: PrintButtonOptions = {}) {
    this.options = {
      onClick: () => {},
      label: 'Print',
      variant: 'secondary',
      size: 'md',
      disabled: false,
      ...options,
    };

    this.element = this.createElement();
    this.attachEventListeners();
  }

  private createElement(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ace-component ace-btn ace-btn-${this.options.variant} ace-btn-${this.options.size} ace-print-button`;
    button.disabled = this.options.disabled;
    button.setAttribute('aria-label', this.options.label);

    button.innerHTML = `
      <svg class="ace-print-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 5V1H12V5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M4 11H3C2.46957 11 1.96086 10.7893 1.58579 10.4142C1.21071 10.0391 1 9.53043 1 9V6C1 5.46957 1.21071 4.96086 1.58579 4.58579C1.96086 4.21071 2.46957 4 3 4H13C13.5304 4 14.0391 4.21071 14.4142 4.58579C14.7893 4.96086 15 5.46957 15 6V9C15 9.53043 14.7893 10.0391 14.4142 10.4142C14.0391 10.7893 13.5304 11 13 11H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M4 8H12V15H4V8Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>${this.options.label}</span>
    `;

    return button;
  }

  private attachEventListeners(): void {
    this.element.addEventListener('click', () => {
      if (!this.options.disabled) {
        this.options.onClick();
      }
    });
  }

  public setLabel(label: string): void {
    this.options.label = label;
    const span = this.element.querySelector('span');
    if (span) {
      span.textContent = label;
    }
  }

  public setDisabled(disabled: boolean): void {
    this.options.disabled = disabled;
    this.element.disabled = disabled;
  }

  public setLoading(loading: boolean): void {
    if (loading) {
      this.element.classList.add('ace-print-button-loading');
      this.element.disabled = true;
    } else {
      this.element.classList.remove('ace-print-button-loading');
      this.element.disabled = this.options.disabled;
    }
  }

  public getElement(): HTMLButtonElement {
    return this.element;
  }

  public destroy(): void {
    this.element.remove();
  }
}
