/**
 * DOCX test helpers. A .docx is a ZIP archive; we only need a single entry's
 * text (e.g. word/document.xml) out of it for assertions.
 */
import JSZip from 'jszip';

/**
 * Read a Blob's bytes as a Buffer. The jsdom Blob polyfill used in tests
 * doesn't implement Blob.arrayBuffer(), so fall back to FileReader.
 */
async function blobToBuffer(blob: Blob): Promise<Buffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return Buffer.from(await blob.arrayBuffer());
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(Buffer.from(reader.result as ArrayBuffer));
    };
    reader.onerror = () => {
      reject(new Error('Failed to read blob'));
    };
    reader.readAsArrayBuffer(blob);
  });
}

export async function extractDocxEntry(blob: Blob, entryName: string): Promise<string> {
  const zip = await JSZip.loadAsync(await blobToBuffer(blob));
  const entry = zip.file(entryName);
  if (!entry) throw new Error(`Entry not found in zip: ${entryName}`);
  return entry.async('string');
}
