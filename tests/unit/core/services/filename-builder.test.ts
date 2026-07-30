/**
 * Filename builder (lo-aa0c / R6)
 *
 * The filename stops being a fixed pattern and becomes an ordered list of
 * pieces. Two things must hold forever:
 *
 * 1. A user who never opens the new screen keeps the name they have today —
 *    an absent `filenamePieces` reproduces the legacy template byte for byte.
 * 2. The popup preview and the export path agree, because there is exactly
 *    one renderer. The last test in this file is the structural guard for
 *    that: neither call site is allowed to assemble a name itself.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { FilenameService } from '../../../../src/core/services/filename-service';
import {
  DEFAULT_FILENAME_PIECES,
  type FilenamePiece,
  type FilenamePreferences,
} from '../../../../src/core/types/config';
import { DEFAULT_PREFERENCES } from '../../../../src/shared/constants';

const CONVERSATION = {
  id: 'c1',
  title: 'My Chat',
  platform: 'chatgpt' as const,
  model: 'gpt-4',
  pairs: [{}, {}, {}] as never[],
  url: 'https://chatgpt.com',
  createdAt: new Date('2026-07-29T14:30:00'),
};

const VARIABLES = FilenameService.getVariablesFromConversation(CONVERSATION);

function prefs(pieces?: FilenamePiece[]): FilenamePreferences {
  return { filenameTemplate: DEFAULT_PREFERENCES.filenameTemplate, filenamePieces: pieces };
}

describe('an absent template reproduces today’s filename', () => {
  it('renders exactly what the legacy string path renders', () => {
    const legacy = FilenameService.addExtension(
      FilenameService.generateFilename(DEFAULT_PREFERENCES.filenameTemplate, VARIABLES),
      'md'
    );

    expect(FilenameService.buildFilename(prefs(), VARIABLES, 'md')).toBe(legacy);
    expect(legacy).toBe('My-Chat_2026-07-29.md');
  });

  it('keeps a stored legacy template that has no pieces beside it', () => {
    const stored: FilenamePreferences = { filenameTemplate: '{platform}_{datetime}' };
    expect(FilenameService.buildFilename(stored, VARIABLES, 'pdf')).toBe(
      'ChatGPT_2026-07-29_14-30.pdf'
    );
  });

  it('renders the default piece list identically to the default template', () => {
    expect(FilenameService.buildFilename(prefs(DEFAULT_FILENAME_PIECES), VARIABLES, 'md')).toBe(
      FilenameService.buildFilename(prefs(), VARIABLES, 'md')
    );
  });
});

describe('piece rendering', () => {
  it.each([
    [[{ type: 'platform' }, { type: 'title' }, { type: 'date' }], 'ChatGPT_My-Chat_2026-07-29.txt'],
    [[{ type: 'model' }, { type: 'time' }], 'gpt-4_14-30.txt'],
    [[{ type: 'title' }, { type: 'pairCount' }], 'My-Chat_3.txt'],
    [[{ type: 'literal', text: 'chat' }, { type: 'date' }], 'chat_2026-07-29.txt'],
  ] as [FilenamePiece[], string][])('renders %j as %s', (pieces, expected) => {
    expect(FilenameService.buildFilename(prefs(pieces), VARIABLES, 'txt')).toBe(expected);
  });

  it('drops a model piece on a conversation that has no model', () => {
    const { model: _model, ...withoutModel } = CONVERSATION;
    const noModel = FilenameService.getVariablesFromConversation(withoutModel);
    const pieces: FilenamePiece[] = [{ type: 'model' }, { type: 'title' }, { type: 'date' }];

    expect(FilenameService.buildFilename(prefs(pieces), noModel, 'json')).toBe(
      'My-Chat_2026-07-29.json'
    );
  });

  it('reorders the output when the pieces are reordered', () => {
    const forwards: FilenamePiece[] = [{ type: 'platform' }, { type: 'date' }];
    const backwards: FilenamePiece[] = [{ type: 'date' }, { type: 'platform' }];

    expect(FilenameService.buildFilename(prefs(forwards), VARIABLES, 'md')).toBe(
      'ChatGPT_2026-07-29.md'
    );
    expect(FilenameService.buildFilename(prefs(backwards), VARIABLES, 'md')).toBe(
      '2026-07-29_ChatGPT.md'
    );
  });

  it('never lets a literal smuggle in a variable of its own', () => {
    const pieces: FilenamePiece[] = [{ type: 'literal', text: '{title}' }, { type: 'date' }];
    expect(FilenameService.buildFilename(prefs(pieces), VARIABLES, 'md')).toBe(
      'title_2026-07-29.md'
    );
  });
});

describe('the name can never collapse', () => {
  it.each([
    ['no pieces at all', [] as FilenamePiece[]],
    ['only empty literals', [{ type: 'literal', text: '' }] as FilenamePiece[]],
    ['a piece with nothing behind it', [{ type: 'title' }] as FilenamePiece[]],
  ])('falls back to a real name with %s', (_label, pieces) => {
    const empty = FilenameService.getVariablesFromConversation({ ...CONVERSATION, title: '' });
    const name = FilenameService.buildFilename(prefs(pieces), empty, 'md');

    expect(name).not.toBe('');
    expect(name).not.toBe('.md');
    expect(name.startsWith('.')).toBe(false);
    expect(name.endsWith('.md')).toBe(true);
  });
});

describe('one renderer, shared by the preview and the export', () => {
  const sources = ['src/extension/popup/popup.ts', 'src/extension/content/content-script.ts'];

  it.each(sources)('%s builds its name through buildFilename alone', (path) => {
    const source = readFileSync(resolve(__dirname, '../../../../', path), 'utf-8');

    expect(source).toContain('FilenameService.buildFilename(');
    // Assembling a name locally is how the preview and the download drift apart.
    expect(source).not.toContain('FilenameService.generateFilename(');
    expect(source).not.toContain('FilenameService.addExtension(');
  });
});
