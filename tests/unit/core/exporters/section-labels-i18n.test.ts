/**
 * I18N-1: exported documents mix localised metadata with hardcoded English
 * section labels ("Artifacts", "Type", "Sources — <query>", "View SVG Code")
 * in md/txt/docx/html. Each exporter must resolve these through the locale
 * bundle instead of emitting raw English literals next to already-localised
 * metadata.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';
import { blobToText } from '../../../utils/exporter-helpers';
import { extractDocxEntry, docxRunText } from '../../../utils/docx-helpers';

type Bundle = Record<string, { message: string }>;

function loadBundle(locale: string): Bundle {
  return JSON.parse(
    readFileSync(resolve(__dirname, `../../../../_locales/${locale}/messages.json`), 'utf-8')
  ) as Bundle;
}

function installLocale(locale: string): Bundle {
  const bundle = loadBundle(locale);
  globalThis.chrome = {
    ...globalThis.chrome,
    i18n: {
      getUILanguage: () => locale,
      // Mirrors chrome.i18n.getMessage's positional $1/$2/... substitution.
      getMessage: (key: string, substitutions?: string | string[]) => {
        const message = bundle[key]?.message ?? '';
        const values = substitutions === undefined ? [] : ([] as string[]).concat(substitutions);
        return values.reduce((acc, value, i) => acc.replaceAll(`$${i + 1}`, value), message);
      },
    },
  } as unknown as typeof chrome;
  return bundle;
}

function buildConversation(): { conversation: Conversation; pairs: QAPair[] } {
  const pair = {
    id: 'pair-0',
    index: 0,
    selected: true,
    question: {
      id: 'q-0',
      role: 'user',
      content: 'plain question',
      timestamp: new Date('2025-01-01T12:00:00Z'),
    },
    answer: {
      id: 'a-0',
      role: 'assistant',
      content: 'plain answer',
      timestamp: new Date('2025-01-01T12:00:00Z'),
      metadata: {
        artifacts: [
          {
            type: 'code',
            title: 'my-script.js',
            typeLabel: 'Code',
            language: 'javascript',
            content: 'console.log(1);',
          },
        ],
        webSearches: [
          {
            query: 'weather today',
            resultCount: 2,
            results: [{ title: 'Result one', url: 'https://example.com/1', domain: 'example.com' }],
          },
        ],
      },
    },
  } as unknown as QAPair;

  const conversation = {
    id: 'test-conversation',
    title: 'i18n section labels',
    platform: 'chatgpt',
    model: 'gpt-4',
    pairs: [pair],
    url: 'https://chatgpt.com/c/test',
    createdAt: new Date('2025-01-01T12:00:00Z'),
  } as unknown as Conversation;

  return { conversation, pairs: [pair] };
}

const originalChrome = globalThis.chrome;

afterEach(() => {
  globalThis.chrome = originalChrome;
});

describe('StructuredMarkdownExporter section labels (German locale)', () => {
  it('localises Artifacts/Type/Sources/View SVG Code and drops the English literals', async () => {
    const de = installLocale('de');
    const { conversation, pairs } = buildConversation();

    const result = await new StructuredMarkdownExporter().export(conversation, pairs, {
      format: 'md',
      filename: 'test',
      showMetaInfo: true,
    });
    const text = await blobToText(result.blob!);

    expect(text).toContain(`### ${de.exportSectionArtifacts?.message}`);
    expect(text).toContain(`*${de.exportArtifactType?.message}: Code*`);
    expect(text).toContain(`### ${de.exportSectionSources?.message} — weather today`);
    expect(text).not.toContain('### Artifacts');
    expect(text).not.toContain('*Type: Code*');
    expect(text).not.toContain('Sources — weather today');
  });
});

describe('TextExporter section labels (German locale)', () => {
  it('localises Artifacts/Type/Sources and drops the English literals', async () => {
    const de = installLocale('de');
    const { conversation, pairs } = buildConversation();

    const result = await new TextExporter().export(conversation, pairs, {
      format: 'txt',
      filename: 'test',
      showMetaInfo: true,
    });
    const text = await blobToText(result.blob!);

    expect(text).toContain(`${de.exportSectionArtifacts?.message}:`);
    expect(text).toContain(`${de.exportArtifactType?.message}: Code`);
    expect(text).toContain(`${de.exportSectionSources?.message} — weather today:`);
    expect(text).not.toContain('Artifacts:');
    expect(text).not.toContain('Type: Code');
    expect(text).not.toContain('Sources — weather today');
  });

  it('localises the Platform/Model/Exported/URL metadata labels and role names, not just dateRange', async () => {
    const de = installLocale('de');
    const { conversation, pairs } = buildConversation();

    const result = await new TextExporter().export(conversation, pairs, {
      format: 'txt',
      filename: 'test',
      showMetaInfo: true,
    });
    const text = await blobToText(result.blob!);

    expect(text).toContain(`${de.metadataFieldPlatform?.message}:`);
    expect(text).toContain(`${de.metadataFieldModel?.message}:`);
    expect(text).toContain(`${de.metadataFieldExported?.message}:`);
    expect(text).toContain(`${de.metadataFieldURL?.message}:`);
    expect(text).toContain(de.roleUser!.message.toUpperCase());
    expect(text).not.toContain('Platform:');
    expect(text).not.toContain('Model:');
    expect(text).not.toContain('Exported:');
    expect(text).not.toContain('USER');
  });
});

describe('DocxExporter section labels (German locale)', () => {
  it('localises Artifacts/Type/Sources and drops the English literals', async () => {
    const de = installLocale('de');
    const { conversation, pairs } = buildConversation();

    const result = await new DocxExporter().export(conversation, pairs, {
      format: 'docx',
      filename: 'test',
      showMetaInfo: true,
    });
    const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
    const text = docxRunText(xml);

    expect(text).toContain(de.exportSectionArtifacts!.message);
    expect(text).toContain(`${de.exportArtifactType?.message}: Code`);
    expect(text).toContain(`${de.exportSectionSources?.message} — weather today`);
    expect(text).not.toContain('Artifacts');
    expect(text).not.toContain('Type: Code');
    expect(text).not.toContain('Sources — weather today');
  });

  it('localises the Platform/Model/Exported/URL metadata labels and role names', async () => {
    const de = installLocale('de');
    const { conversation, pairs } = buildConversation();

    const result = await new DocxExporter().export(conversation, pairs, {
      format: 'docx',
      filename: 'test',
      showMetaInfo: true,
    });
    const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
    const text = docxRunText(xml);

    expect(text).toContain(`${de.metadataFieldPlatform?.message}:`);
    expect(text).toContain(`${de.metadataFieldModel?.message}:`);
    expect(text).toContain(`${de.metadataFieldExported?.message}:`);
    expect(text).toContain(`${de.metadataFieldURL?.message}:`);
    expect(text).toContain(de.roleUser!.message);
    expect(text).not.toContain('Platform:');
    expect(text).not.toContain('Model:');
    expect(text).not.toContain('Exported:');
  });
});

describe('HtmlExporter section labels (German locale)', () => {
  it('localises Artifacts/Type/Web Search Results/results-found and drops the English literals', async () => {
    const de = installLocale('de');
    const { conversation, pairs } = buildConversation();

    const result = await new HtmlExporter().export(conversation, pairs, {
      format: 'html',
      filename: 'test',
      showMetaInfo: true,
    });
    const html = await blobToText(result.blob!);

    // A11Y-1 promotes the section heading to h2 when the body has no
    // headings of its own (h1 is the document title).
    expect(html).toContain(`<h2>${de.exportSectionArtifacts?.message}</h2>`);
    expect(html).toContain(`${de.exportArtifactType?.message}: Code`);
    expect(html).toContain(`<h2>${de.exportSectionWebSearchResults?.message}</h2>`);
    const expectedCount = de.exportSearchResultCount!.message.replace('$1', '2');
    expect(html).toContain(expectedCount);
    expect(html).not.toContain('<h2>Artifacts</h2>');
    expect(html).not.toContain('Type: Code');
    expect(html).not.toContain('<h2>Web Search Results</h2>');
    expect(html).not.toContain('2 results found');
  });
});
