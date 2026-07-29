/**
 * Platform / role display names.
 *
 * The locale bundles spell these keys the way the vendor does — `platformChatGPT`,
 * `roleChatGPT` — which no capitalizer derives from the id `chatgpt`. When the
 * lookup misses, the hardcoded fallback happens to return the same English string,
 * so an assertion against `'ChatGPT'` passes either way and proves nothing.
 *
 * Every locale value mocked below is therefore deliberately distinct from the
 * fallback: these tests fail if the bundle value is not what comes back.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getPlatformName, getRoleName } from '../../../src/shared/i18n';

const MESSAGES: Record<string, string> = {
  platformChatGPT: 'ChatGPT[locale]',
  platformClaude: 'Claude[locale]',
  platformGemini: 'Gemini[locale]',
  platformMistral: 'Mistral[locale]',
  platformGrok: 'Grok[locale]',
  roleChatGPT: 'ChatGPT[locale]',
  roleClaude: 'Claude[locale]',
  roleGemini: 'Gemini[locale]',
  roleUser: 'User[locale]',
  roleAssistant: 'Assistant[locale]',
};

const originalChrome = globalThis.chrome;

function withLocale(): void {
  globalThis.chrome = {
    ...originalChrome,
    i18n: {
      getUILanguage: () => 'en',
      getMessage: (key: string) => MESSAGES[key] ?? '',
    },
  } as unknown as typeof chrome;
}

describe('getPlatformName', () => {
  afterEach(() => {
    globalThis.chrome = originalChrome;
  });

  it.each([
    ['chatgpt', 'ChatGPT[locale]'],
    ['claude', 'Claude[locale]'],
    ['gemini', 'Gemini[locale]'],
    ['mistral', 'Mistral[locale]'],
    ['grok', 'Grok[locale]'],
  ])('resolves the declared bundle key for %s', (id, expected) => {
    withLocale();
    expect(getPlatformName(id)).toBe(expected);
  });

  it('falls back to the vendor-cased name when i18n is unavailable', () => {
    globalThis.chrome = { ...originalChrome, i18n: undefined } as unknown as typeof chrome;
    expect(getPlatformName('chatgpt')).toBe('ChatGPT');
  });

  it('capitalizes an id the bundles do not declare', () => {
    withLocale();
    expect(getPlatformName('perplexity')).toBe('Perplexity');
  });
});

describe('getRoleName', () => {
  afterEach(() => {
    globalThis.chrome = originalChrome;
  });

  it.each([
    ['chatgpt', 'ChatGPT[locale]'],
    ['claude', 'Claude[locale]'],
    ['gemini', 'Gemini[locale]'],
    ['user', 'User[locale]'],
    ['assistant', 'Assistant[locale]'],
  ])('resolves the declared bundle key for %s', (role, expected) => {
    withLocale();
    expect(getRoleName(role)).toBe(expected);
  });

  it('falls back to the vendor-cased name when i18n is unavailable', () => {
    globalThis.chrome = { ...originalChrome, i18n: undefined } as unknown as typeof chrome;
    expect(getRoleName('chatgpt')).toBe('ChatGPT');
  });
});
