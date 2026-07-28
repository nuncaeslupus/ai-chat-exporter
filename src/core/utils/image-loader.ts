/**
 * Image loading utilities for PDF export
 */

import { TOAST_DURATION } from '../../shared/constants';

/**
 * Loaded image data for PDF embedding
 */
export interface LoadedImage {
  dataUrl: string;
  format: 'PNG' | 'JPEG' | 'WEBP' | 'GIF';
  width: number;
  height: number;
}

/**
 * Load an image from a URL and convert it to a base64 data URL
 * @param url - The image URL to load
 * @param maxWidth - Maximum width to scale the image (default: 800)
 * @param timeoutMs - Give up and skip the image if it hasn't decoded by then (default: 5000)
 * @returns Promise with loaded image data or null if loading fails
 */
export async function loadImageAsDataUrl(
  url: string,
  maxWidth: number = 800,
  timeoutMs = 5000
): Promise<LoadedImage | null> {
  try {
    // Create an image element to load the image
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Enable CORS if needed

    // Load the image. Some data: URIs (e.g. a malformed/unsupported
    // image/svg+xml source) never fire onload or onerror, which would hang
    // the whole export forever -- race against a timeout so a single bad
    // image is skipped (see lo-4b7f) instead of blocking export().
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out loading image'));
      }, timeoutMs);
      img.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Failed to load image'));
      };
      img.src = url;
    });

    // Calculate scaled dimensions
    let width = img.naturalWidth;
    let height = img.naturalHeight;

    if (width > maxWidth) {
      const scale = maxWidth / width;
      width = maxWidth;
      height = height * scale;
    }

    // Create a canvas to convert the image to base64
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('Failed to get canvas context');
      return null;
    }

    // Draw the image on the canvas
    ctx.drawImage(img, 0, 0, width, height);

    // Determine image format from URL or use PNG as default
    let format: LoadedImage['format'] = 'PNG';
    const urlLower = url.toLowerCase();
    if (urlLower.includes('.jpg') || urlLower.includes('.jpeg')) {
      format = 'JPEG';
    } else if (urlLower.includes('.webp')) {
      format = 'WEBP';
    } else if (urlLower.includes('.gif')) {
      format = 'GIF';
    }

    // Convert to data URL
    const mimeType = `image/${format.toLowerCase()}`;
    const dataUrl = canvas.toDataURL(mimeType, 0.9);

    return {
      dataUrl,
      format,
      width,
      height,
    };
  } catch (error) {
    // A tainted canvas (drawImage succeeded but the CDN didn't grant this
    // origin CORS access) throws a SecurityError specifically from
    // toDataURL(), distinct from a network/decode failure -- call it out so
    // it's diagnosable instead of looking like every other failure.
    if (error instanceof DOMException && error.name === 'SecurityError') {
      console.error(
        `Failed to load image (blocked by CORS policy -- the source did not grant this page permission to read the image data): ${url}`,
        error
      );
    } else {
      console.error('Failed to load image:', url, error);
    }
    return null;
  }
}

/**
 * Show a brief, self-dismissing in-page notice so a user actually sees that
 * some images couldn't be embedded, instead of them silently vanishing from
 * the export with only a console.error nobody looks at (see lo-cef8).
 */
function notifyEmbedFailures(failedCount: number): void {
  if (typeof document === 'undefined' || failedCount === 0) {
    return;
  }

  const notice = document.createElement('div');
  notice.setAttribute('role', 'alert');
  notice.textContent =
    failedCount === 1
      ? '1 image could not be embedded in the export and was replaced with a text placeholder.'
      : `${String(failedCount)} images could not be embedded in the export and were replaced with text placeholders.`;
  notice.style.cssText =
    'position:fixed;bottom:16px;right:16px;z-index:2147483647;max-width:320px;' +
    'padding:10px 14px;background:#7c2d12;color:#fff;font:13px sans-serif;' +
    'border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.3);';
  document.body.appendChild(notice);
  setTimeout(() => {
    notice.remove();
  }, TOAST_DURATION);
}

/**
 * Load multiple images in parallel with a concurrency limit
 * @param urls - Array of image URLs to load
 * @param maxWidth - Maximum width to scale images
 * @param concurrency - Number of images to load in parallel (default: 3)
 * @returns Map of URL to loaded image data (null for failed loads)
 */
export async function loadImagesParallel(
  urls: string[],
  maxWidth: number = 800,
  concurrency: number = 3
): Promise<Map<string, LoadedImage | null>> {
  const results = new Map<string, LoadedImage | null>();

  // Process URLs in batches
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        const image = await loadImageAsDataUrl(url, maxWidth);
        return { url, image };
      })
    );

    // Store results in map
    for (const { url, image } of batchResults) {
      results.set(url, image);
    }
  }

  const failedCount = Array.from(results.values()).filter((image) => image === null).length;
  notifyEmbedFailures(failedCount);

  return results;
}
