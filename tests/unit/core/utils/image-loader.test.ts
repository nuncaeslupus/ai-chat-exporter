import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { loadImageAsDataUrl, loadImagesParallel } from '../../../../src/core/utils/image-loader';

/** Minimal Image test double that resolves onload asynchronously with given dimensions. */
class SucceedingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = '';
  naturalWidth = 1000;
  naturalHeight = 500;
  private _src = '';
  set src(value: string) {
    this._src = value;
    queueMicrotask(() => this.onload?.());
  }
  get src() {
    return this._src;
  }
}

/** Minimal Image test double that always fails to load. */
class FailingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = '';
  private _src = '';
  set src(value: string) {
    this._src = value;
    queueMicrotask(() => this.onerror?.());
  }
  get src() {
    return this._src;
  }
}

describe('image-loader', () => {
  const OriginalImage = global.Image;

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,mockdata'
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    document.body.innerHTML = '';
  });

  afterEach(() => {
    global.Image = OriginalImage;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('loadImageAsDataUrl', () => {
    it('resolves to null instead of hanging forever when onload/onerror never fire (lo-4b7f)', async () => {
      // Mirrors the real-world hang lo-4b7f found: an artifact-preview SVG
      // data URI never fires onload or onerror in this environment, so the
      // decode promise used to hang export() forever.
      class NeverSettlingImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';
        src = '';
      }
      // @ts-expect-error -- minimal test double, not a full Image implementation
      global.Image = NeverSettlingImage;

      const result = await loadImageAsDataUrl('data:image/svg+xml,whatever', 800, 20);

      expect(result).toBeNull();
    });

    it('returns the loaded image data on success, scaled to maxWidth', async () => {
      // @ts-expect-error -- minimal test double, not a full Image implementation
      global.Image = SucceedingImage;

      const result = await loadImageAsDataUrl('https://example.com/photo.jpg', 500);

      expect(result).toEqual({
        dataUrl: 'data:image/png;base64,mockdata',
        format: 'JPEG',
        width: 500,
        height: 250, // scaled down proportionally from 1000x500
      });
    });

    it('resolves to null when the image element fires onerror', async () => {
      // @ts-expect-error -- minimal test double, not a full Image implementation
      global.Image = FailingImage;

      const result = await loadImageAsDataUrl('https://example.com/missing.png');

      expect(result).toBeNull();
    });

    it('resolves to null and logs distinctly when canvas.toDataURL throws SecurityError (CORS taint)', async () => {
      // A tainted canvas is the CORS-restricted-CDN failure mode this task is
      // about: the image loads fine (onload fires) but the CDN didn't grant
      // this origin CORS access, so reading pixel data back out throws.
      // @ts-expect-error -- minimal test double, not a full Image implementation
      global.Image = SucceedingImage;
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      });
      const errorSpy = vi.spyOn(console, 'error');

      const result = await loadImageAsDataUrl('https://cdn.example.com/blocked.png');

      expect(result).toBeNull();
      // Distinguish CORS-taint from a generic failure so it's diagnosable.
      expect(
        errorSpy.mock.calls.some((call) =>
          call.some((arg) => typeof arg === 'string' && /cors/i.test(arg))
        )
      ).toBe(true);
    });
  });

  describe('loadImagesParallel', () => {
    it('maps every URL to its loaded image or null on failure', async () => {
      // @ts-expect-error -- minimal test double, not a full Image implementation
      global.Image = SucceedingImage;

      const results = await loadImagesParallel(['https://example.com/a.png']);

      expect(results.get('https://example.com/a.png')).not.toBeNull();
    });

    it('surfaces a visible in-page notice when one or more images fail to embed', async () => {
      // @ts-expect-error -- minimal test double, not a full Image implementation
      global.Image = FailingImage;

      await loadImagesParallel(['https://example.com/a.png', 'https://example.com/b.png']);

      // The failure must be visible to the user, not just a console.error --
      // assert a real DOM element was surfaced, not merely logged.
      expect(document.body.textContent).toMatch(/2 images/i);
    });

    it('does not surface a notice when every image embeds successfully', async () => {
      // @ts-expect-error -- minimal test double, not a full Image implementation
      global.Image = SucceedingImage;

      await loadImagesParallel(['https://example.com/a.png']);

      expect(document.body.innerHTML).toBe('');
    });
  });
});
