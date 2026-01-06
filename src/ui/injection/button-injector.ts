/**
 * ButtonInjector
 * Utility for injecting export and print buttons into AI chat interfaces
 */

import type { IParser } from '../../core/types/parser';

export interface ButtonInjectorOptions {
  parser: IParser;
  buttons: HTMLElement[];
  containerClass?: string;
  position?: 'before' | 'after' | 'prepend' | 'append';
  retryAttempts?: number;
  retryDelay?: number;
}

export interface InjectionResult {
  success: boolean;
  container?: HTMLElement;
  injectionPoint?: HTMLElement;
  error?: string;
}

export class ButtonInjector {
  private options: Required<ButtonInjectorOptions>;
  private container?: HTMLElement;
  private observer?: MutationObserver;

  constructor(options: ButtonInjectorOptions) {
    const defaults = {
      containerClass: 'ace-button-container',
      position: 'before' as const,
      retryAttempts: 10,
      retryDelay: 500,
    };

    this.options = {
      ...defaults,
      ...options,
    } as Required<ButtonInjectorOptions>;
  }

  /**
   * Inject buttons into the page
   */
  public async inject(): Promise<InjectionResult> {
    // Try to find injection point
    const injectionPoint = await this.findInjectionPoint();

    if (!injectionPoint) {
      return {
        success: false,
        error: 'Could not find suitable injection point',
      };
    }

    // Create container for buttons
    this.container = this.createContainer();

    // Add buttons to container
    this.options.buttons.forEach((button) => {
      this.container!.appendChild(button);
    });

    // Load theme styles
    this.loadThemeStyles();

    // Inject container into page
    this.injectContainer(injectionPoint);

    // Watch for DOM changes that might remove our buttons
    this.setupObserver(injectionPoint);

    return {
      success: true,
      container: this.container,
      injectionPoint,
    };
  }

  /**
   * Find the injection point on the page with retries
   */
  private async findInjectionPoint(): Promise<HTMLElement | null> {
    for (let attempt = 0; attempt < this.options.retryAttempts; attempt++) {
      const injectionPoint = this.options.parser.getButtonInjectionPoint();

      if (injectionPoint) {
        return injectionPoint;
      }

      // Wait before retrying
      await this.sleep(this.options.retryDelay);
    }

    return null;
  }

  /**
   * Create container element for buttons
   */
  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = `ace-component ${this.options.containerClass}`;

    // Add inline styles for container
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '0.5rem';
    container.style.marginRight = '0.5rem';

    return container;
  }

  /**
   * Load theme-specific styles
   */
  private loadThemeStyles(): void {
    const theme = this.options.parser.getTheme();
    const styleId = `ace-theme-${theme}`;

    // Don't load if already loaded
    if (document.getElementById(styleId)) {
      return;
    }

    // Load base styles
    this.loadStylesheet('ace-base-styles', this.getStylePath('base.css'));

    // Load theme-specific styles
    this.loadStylesheet(styleId, this.getStylePath(`${theme}.css`));

    // Load component styles
    this.loadComponentStyles();
  }

  /**
   * Load a stylesheet
   */
  private loadStylesheet(id: string, href: string): void {
    if (document.getElementById(id)) {
      return;
    }

    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  /**
   * Load all component styles
   */
  private loadComponentStyles(): void {
    const components = [
      'export-button',
      'format-dropdown',
      'print-button',
      'selection-panel',
      'confirmation-modal',
      'toast',
    ];

    components.forEach((component) => {
      this.loadStylesheet(
        `ace-${component}-styles`,
        this.getComponentStylePath(component),
      );
    });
  }

  /**
   * Get path to theme stylesheet
   */
  private getStylePath(filename: string): string {
    // In production, these would be from the extension's resources
    // For now, assume they're served from a specific path
    return chrome?.runtime?.getURL(`ui/themes/${filename}`) || `/ui/themes/${filename}`;
  }

  /**
   * Get path to component stylesheet
   */
  private getComponentStylePath(component: string): string {
    return (
      chrome?.runtime?.getURL(`ui/components/${component}/${component}.css`) ||
      `/ui/components/${component}/${component}.css`
    );
  }

  /**
   * Inject container into the page at the specified position
   */
  private injectContainer(injectionPoint: HTMLElement): void {
    switch (this.options.position) {
      case 'before':
        injectionPoint.parentElement?.insertBefore(this.container!, injectionPoint);
        break;
      case 'after':
        injectionPoint.parentElement?.insertBefore(
          this.container!,
          injectionPoint.nextSibling,
        );
        break;
      case 'prepend':
        injectionPoint.insertBefore(this.container!, injectionPoint.firstChild);
        break;
      case 'append':
        injectionPoint.appendChild(this.container!);
        break;
    }
  }

  /**
   * Setup observer to watch for DOM changes
   */
  private setupObserver(injectionPoint: HTMLElement): void {
    this.observer = new MutationObserver(() => {
      // Check if our container is still in the DOM
      if (this.container && !document.body.contains(this.container)) {
        // Re-inject if removed
        this.injectContainer(injectionPoint);
      }
    });

    this.observer.observe(injectionPoint.parentElement || document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Remove injected buttons and clean up
   */
  public remove(): void {
    if (this.observer) {
      this.observer.disconnect();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).observer = undefined;
    }

    if (this.container) {
      this.container.remove();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).container = undefined;
    }
  }

  /**
   * Check if buttons are currently injected
   */
  public isInjected(): boolean {
    return this.container !== undefined && document.body.contains(this.container);
  }

  /**
   * Get the container element
   */
  public getContainer(): HTMLElement | undefined {
    return this.container;
  }

  /**
   * Utility: sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
