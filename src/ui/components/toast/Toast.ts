/**
 * Toast Component
 * Notification toast messages
 */

export type ToastType = 'success' | 'error' | 'info';

export interface ToastOptions {
  title?: string;
  message: string;
  type?: ToastType;
  duration?: number;
  onClose?: () => void;
}

export class Toast {
  private element: HTMLElement;
  private options: Required<ToastOptions>;
  private timeoutId?: number;

  constructor(options: ToastOptions) {
    const defaults = {
      title: '',
      type: 'info' as ToastType,
      duration: 5000,
      onClose: () => {},
    };

    this.options = {
      ...defaults,
      ...options,
    } as Required<ToastOptions>;

    this.element = this.createElement();
    this.attachEventListeners();
  }

  private createElement(): HTMLElement {
    const toast = document.createElement('div');
    toast.className = `ace-component ace-toast ace-toast-${this.options.type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');

    const icon = this.getIcon(this.options.type);

    toast.innerHTML = `
      ${icon}
      <div class="ace-toast-content">
        ${this.options.title ? `<div class="ace-toast-title">${this.escapeHtml(this.options.title)}</div>` : ''}
        <div class="ace-toast-message">${this.escapeHtml(this.options.message)}</div>
      </div>
      <button type="button" class="ace-toast-close" aria-label="Close notification">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    `;

    return toast;
  }

  private getIcon(type: ToastType): string {
    const icons = {
      success: `
        <svg class="ace-toast-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="10" cy="10" r="9" stroke="currentColor" stroke-width="1.5" fill="none"/>
          <path d="M6 10L9 13L14 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `,
      error: `
        <svg class="ace-toast-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="10" cy="10" r="9" stroke="currentColor" stroke-width="1.5" fill="none"/>
          <path d="M10 6V11M10 14V14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      `,
      info: `
        <svg class="ace-toast-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="10" cy="10" r="9" stroke="currentColor" stroke-width="1.5" fill="none"/>
          <path d="M10 14V10M10 6V6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      `,
    };

    return icons[type];
  }

  private attachEventListeners(): void {
    const closeBtn = this.element.querySelector('.ace-toast-close');
    closeBtn?.addEventListener('click', () => {
      this.close();
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  public show(container?: HTMLElement): void {
    const targetContainer = container || this.getOrCreateContainer();
    targetContainer.appendChild(this.element);

    // Auto-close after duration
    if (this.options.duration > 0) {
      this.timeoutId = window.setTimeout(() => {
        this.close();
      }, this.options.duration);
    }
  }

  public close(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.element.style.opacity = '0';
    this.element.style.transform = 'translateX(2rem)';

    setTimeout(() => {
      this.element.remove();
      this.options.onClose();
    }, 200);
  }

  private getOrCreateContainer(): HTMLElement {
    let container = document.querySelector('.ace-toast-container') as HTMLElement;

    if (!container) {
      container = document.createElement('div');
      container.className = 'ace-component ace-toast-container';
      document.body.appendChild(container);
    }

    return container;
  }

  public getElement(): HTMLElement {
    return this.element;
  }
}

// Convenience factory methods
export class ToastService {
  private static container?: HTMLElement;

  private static getContainer(): HTMLElement {
    if (!ToastService.container) {
      ToastService.container = document.createElement('div');
      ToastService.container.className = 'ace-component ace-toast-container';
      document.body.appendChild(ToastService.container);
    }
    return ToastService.container;
  }

  public static success(message: string, title?: string, duration?: number): Toast {
    const options: ToastOptions = {
      message,
      type: 'success',
    };
    if (title !== undefined) options.title = title;
    if (duration !== undefined) options.duration = duration;

    const toast = new Toast(options);
    toast.show(ToastService.getContainer());
    return toast;
  }

  public static error(message: string, title?: string, duration?: number): Toast {
    const options: ToastOptions = {
      message,
      type: 'error',
      duration: duration ?? 7000, // Errors stay longer by default
    };
    if (title !== undefined) options.title = title;

    const toast = new Toast(options);
    toast.show(ToastService.getContainer());
    return toast;
  }

  public static info(message: string, title?: string, duration?: number): Toast {
    const options: ToastOptions = {
      message,
      type: 'info',
    };
    if (title !== undefined) options.title = title;
    if (duration !== undefined) options.duration = duration;

    const toast = new Toast(options);
    toast.show(ToastService.getContainer());
    return toast;
  }
}
