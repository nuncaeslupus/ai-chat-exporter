import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadImageAsDataUrl } from '../../../../src/core/utils/image-loader';

describe('loadImageAsDataUrl', () => {
  const OriginalImage = global.Image;

  afterEach(() => {
    global.Image = OriginalImage;
    vi.restoreAllMocks();
  });

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
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await loadImageAsDataUrl('data:image/svg+xml,whatever', 800, 20);

    expect(result).toBeNull();
  });
});
