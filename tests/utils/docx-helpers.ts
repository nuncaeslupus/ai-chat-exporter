/**
 * Minimal ZIP reader for DOCX test assertions.
 * A .docx file is a standard ZIP archive; we only need to pull a single
 * entry's text (e.g. word/document.xml) out of it for assertions.
 */
import { inflateRawSync } from 'node:zlib';

/**
 * Read a Blob's bytes as a Buffer. The jsdom Blob polyfill used in tests
 * doesn't implement Blob.arrayBuffer(), so fall back to FileReader.
 */
export async function blobToBuffer(blob: Blob): Promise<Buffer> {
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

export function extractDocxEntry(buffer: Buffer, entryName: string): string {
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Not a valid zip file (no EOCD found)');

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  for (let i = 0; i < entryCount; i++) {
    const compressionMethod = buffer.readUInt16LE(cdOffset + 10);
    const compressedSize = buffer.readUInt32LE(cdOffset + 20);
    const nameLength = buffer.readUInt16LE(cdOffset + 28);
    const extraLength = buffer.readUInt16LE(cdOffset + 30);
    const commentLength = buffer.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(cdOffset + 42);
    const name = buffer.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLength);

    if (name === entryName) {
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      const data = compressionMethod === 0 ? compressed : inflateRawSync(compressed);
      return data.toString('utf8');
    }

    cdOffset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`Entry not found in zip: ${entryName}`);
}
