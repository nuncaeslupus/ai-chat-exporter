# Payload: lo-cef8 — PDF images may silently vanish

**Gate**: confirmed evidence of whether images from each platform's CDN can be embedded at all, and a visible failure when they cannot.

`src/core/utils/image-loader.ts` (no tests) sets `img.crossOrigin = 'anonymous'` then calls `canvas.toDataURL()`. If the CDN serving ChatGPT/Claude/Gemini images does not return permissive CORS headers — common for signed S3/blob URLs — the canvas is tainted and `toDataURL()` throws `SecurityError`, which the existing try/catch turns into a `null` and a `console.error`. Every image silently disappears from the PDF.

Nobody has verified whether these CDNs actually send usable CORS headers. **Check that first** — the answer determines whether this is a latent risk or a shipping bug that makes PDF image export not work at all.

If it does fail: fetch through the background service worker (which has host permissions) instead of tainting a canvas, and surface a real error when an image cannot be embedded.
