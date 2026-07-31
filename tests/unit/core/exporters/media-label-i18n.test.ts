/**
 * I18N-1: `BaseExporter.mediaLabel()` hardcoded the "Video"/"Audio" kind word
 * as an English literal, so a media block reached every human-readable
 * format in English even inside an otherwise fully-localised document.
 * French is used here (not German) because "Vidéo"/"Audio" for de would
 * happen to equal the English word and not catch a regression.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { blobToText } from '../../../utils/exporter-helpers';

const originalChrome = globalThis.chrome;

afterEach(() => {
  globalThis.chrome = originalChrome;
});

function installLocale(locale: string): Record<string, { message: string }> {
  const bundle = JSON.parse(
    readFileSync(resolve(__dirname, `../../../../_locales/${locale}/messages.json`), 'utf-8')
  ) as Record<string, { message: string }>;
  globalThis.chrome = {
    ...originalChrome,
    i18n: {
      getUILanguage: () => locale,
      getMessage: (key: string) => bundle[key]?.message ?? '',
    },
  } as unknown as typeof chrome;
  return bundle;
}

describe('BaseExporter.mediaLabel() locale support', () => {
  it('renders the French kind word for a video block, not the English literal', async () => {
    const fr = installLocale('fr');
    const pair = {
      id: 'p1',
      index: 0,
      selected: true,
      question: { id: 'q1', role: 'user', content: 'hi', timestamp: new Date() },
      answer: {
        id: 'a1',
        role: 'assistant',
        content: 'here',
        metadata: {
          media: [{ kind: 'video', src: 'https://example.com/clip.mp4', duration: 8 }],
        },
      },
    } as unknown as QAPair;
    const conversation = {
      id: 'c1',
      title: 'Media i18n',
      platform: 'gemini',
      url: 'https://gemini.google.com/app/1',
      createdAt: new Date(),
      pairs: [pair],
    } as unknown as Conversation;

    const result = await new TextExporter().export(conversation, [pair], {
      format: 'txt',
      filename: 'test',
      showMetaInfo: false,
    });
    const text = await blobToText(result.blob!);

    expect(text).toContain(`[${fr.mediaKindVideo!.message} (0:08)]`);
    expect(text).not.toContain('[Video');
  });
});
