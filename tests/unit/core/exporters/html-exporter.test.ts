/**
 * HTML Exporter Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
        includeMetadata: true,
        includeTimestamps: false,
      });
      const html = await blobToText(result.blob!);

      expect(html).toContain('<html lang="de">');
      expect(html).toContain('Plattform');
      expect(html).toContain('Benutzer');
      expect(html).toContain('Exportiert mit AI Chat Exporter');
      expect(html).not.toContain('>Platform<');
      expect(html).not.toContain('>User<');
    });

    it('falls back to English labels and lang="en" when i18n is unavailable', async () => {
      globalThis.chrome = { ...originalChrome, i18n: undefined } as unknown as typeof chrome;

      const result = await exporter.export(conversation, selectedPairs, {
        format: 'html',
        filename: 'test',
        includeMetadata: true,
        includeTimestamps: false,
      });
      const html = await blobToText(result.blob!);

      expect(html).toContain('<html lang="en">');
    });
  });
});
