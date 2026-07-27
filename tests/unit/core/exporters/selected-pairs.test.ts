/**
 * Shared test: every registered exporter must honour `selectedPairs`.
 *
 * Iterates `exporterRegistry` so a future 7th exporter is covered
 * automatically, instead of copy-pasting a per-exporter test.
 */

import { describe, it, expect } from 'vitest';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { exporterRegistry } from '../../../../src/core/exporters';
import {
  blobToText,
  createTestQAPair,
  createTestConversation,
} from '../../../utils/exporter-helpers';

describe('every registered exporter honours selectedPairs', () => {
  const allPairs: QAPair[] = [
    createTestQAPair(0, 'FirstQuestionMarker', 'FirstAnswerMarker'),
    createTestQAPair(1, 'SecondQuestionMarker', 'SecondAnswerMarker'),
    createTestQAPair(2, 'ThirdQuestionMarker', 'ThirdAnswerMarker'),
  ];
  // Two of three selected: the middle pair is deselected.
  const selectedPairs: QAPair[] = [allPairs[0]!, allPairs[2]!];
  const conversation: Conversation = createTestConversation(allPairs);

  const baseOptions = {
    filename: 'test',
    includeMetadata: true,
    includeTimestamps: false,
  };

  for (const [format, factory] of exporterRegistry) {
    it(`${format} exporter exports only the selected pairs`, async () => {
      const exporter = factory();

      const fullResult = await exporter.export(conversation, allPairs, {
        ...baseOptions,
        format,
      });
      const subsetResult = await exporter.export(conversation, selectedPairs, {
        ...baseOptions,
        format,
      });

      expect(subsetResult.success).toBe(true);
      expect(subsetResult.blob).toBeInstanceOf(Blob);

      if (
        subsetResult.mimeType?.startsWith('text/') ||
        subsetResult.mimeType === 'application/json'
      ) {
        // Text-based formats: verify the excluded pair's content is absent
        // and the selected pairs' content is present.
        const text = await blobToText(subsetResult.blob!);
        expect(text).toContain('FirstQuestionMarker');
        expect(text).toContain('ThirdQuestionMarker');
        expect(text).not.toContain('SecondQuestionMarker');
        expect(text).not.toContain('SecondAnswerMarker');
      } else {
        // Binary formats (pdf, docx): dropping a whole pair must shrink the
        // output relative to exporting every pair.
        expect(subsetResult.blob!.size).toBeLessThan(fullResult.blob!.size);
      }
    });
  }
});
