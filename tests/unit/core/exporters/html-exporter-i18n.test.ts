/**
 * HTML Exporter i18n tests
 *
 * Kept separate from html-exporter.test.ts (the security suite) - both were
 * added independently and collided on the same filename.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';
import {
  blobToText,
  createTestQAPair,
  createTestConversation,
} from '../../../utils/exporter-helpers';

// Real German translations, mirroring _locales/de/messages.json
const DE_MESSAGES: Record<string, string> = {
  metadataFieldPlatform: 'Plattform',
  metadataFieldModel: 'Modell',
  metadataFieldExported: 'Exportiert',
  metadataFieldURL: 'URL',
  roleUser: 'Benutzer',
  roleAssistant: 'Assistent',
  roleChatGPT: 'ChatGPT',
  roleClaude: 'Claude',
  roleGemini: 'Gemini',
  platformChatGPT: 'ChatGPT',
  exportedWithChatExporter: 'Exportiert mit AI Chat Exporter',
};

describe('HtmlExporter', () => {
  let exporter: HtmlExporter;
  let conversation: Conversation;
  let selectedPairs: QAPair[];
  const originalChrome = globalThis.chrome;

  beforeEach(() => {
    exporter = new HtmlExporter();
    const pairs = [
      createTestQAPair(0, 'What is TypeScript?', 'TypeScript is a typed superset of JavaScript.'),
    ];
    conversation = createTestConversation(pairs);
    selectedPairs = pairs;
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
  });

  describe('locale support', () => {
    it('uses German labels and lang attribute when the UI locale is German', async () => {
      globalThis.chrome = {
        ...originalChrome,
        i18n: {
          getUILanguage: () => 'de',
          getMessage: (key: string) => DE_MESSAGES[key] ?? '',
        },
      } as unknown as typeof chrome;

      const result = await exporter.export(conversation, selectedPairs, {
        format: 'html',
        filename: 'test',
        showMetaInfo: true,
      });
      const html = await blobToText(result.blob!);

      expect(html).toContain('<html lang="de">');
      expect(html).toContain('Plattform');
      expect(html).toContain('Benutzer');
      expect(html).toContain('Exportiert mit AI Chat Exporter');
      expect(html).not.toContain('>Platform<');
      expect(html).not.toContain('>User<');
    });

    it('takes the date-range label from the locale bundle, not an English fallback', async () => {
      // Reads the real bundle, so a deleted/renamed key fails here rather than
      // silently rendering English into a German export header.
      const de = JSON.parse(
        readFileSync(resolve(__dirname, '../../../../_locales/de/messages.json'), 'utf-8')
      ) as Record<string, { message: string }>;

      globalThis.chrome = {
        ...originalChrome,
        i18n: {
          getUILanguage: () => 'de',
          getMessage: (key: string) => de[key]?.message ?? '',
        },
      } as unknown as typeof chrome;

      const result = await exporter.export(conversation, selectedPairs, {
        format: 'html',
        filename: 'test',
        showMetaInfo: true,
      });
      const html = await blobToText(result.blob!);

      expect(html).toContain(de.metadataFieldDateRange?.message);
      expect(html).not.toContain('Date range');
    });

    it('names the assistant after the platform, not the generic role label', async () => {
      // `roleChatGPT` is the declared key; a lookup that misses it falls through
      // to `roleAssistant`, so a German ChatGPT export reads "Assistent".
      globalThis.chrome = {
        ...originalChrome,
        i18n: {
          getUILanguage: () => 'de',
          getMessage: (key: string) => DE_MESSAGES[key] ?? '',
        },
      } as unknown as typeof chrome;

      const result = await exporter.export(conversation, selectedPairs, {
        format: 'html',
        filename: 'test',
        showMetaInfo: true,
      });
      const html = await blobToText(result.blob!);

      expect(html).toContain('<p class="message-role">ChatGPT</p>');
      expect(html).not.toContain('Assistent');
    });

    it('falls back to English labels and lang="en" when i18n is unavailable', async () => {
      globalThis.chrome = { ...originalChrome, i18n: undefined } as unknown as typeof chrome;

      const result = await exporter.export(conversation, selectedPairs, {
        format: 'html',
        filename: 'test',
        showMetaInfo: true,
      });
      const html = await blobToText(result.blob!);

      expect(html).toContain('<html lang="en">');
    });
  });
});
