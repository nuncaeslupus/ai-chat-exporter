/**
 * Selection Service Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../../src/core/services/selection-service';
import type { QAPair } from '../../../../src/core/types/conversation';
import { createTestQAPair } from '../../../utils/exporter-helpers';

describe('SelectionService', () => {
  let pairs: QAPair[];

  beforeEach(() => {
    pairs = [
      createTestQAPair(0, 'Question 1', 'Answer 1', true),
      createTestQAPair(1, 'Question 2', 'Answer 2', true),
      createTestQAPair(2, 'Question 3', 'Answer 3', false),
    ];
  });

  describe('toggleSelection()', () => {
    it('toggles a selected pair to unselected', () => {
      const result = SelectionService.toggleSelection(pairs, 'pair-0');
      expect(result[0]!.selected).toBe(false);
      expect(result[1]!.selected).toBe(true);
      expect(result[2]!.selected).toBe(false);
    });

    it('toggles an unselected pair to selected', () => {
      const result = SelectionService.toggleSelection(pairs, 'pair-2');
      expect(result[0]!.selected).toBe(true);
      expect(result[1]!.selected).toBe(true);
      expect(result[2]!.selected).toBe(true);
    });

    it('does not mutate the original array', () => {
      // Snapshot primitives: a shallow array copy shares the pair objects and
      // would compare equal even if toggleSelection mutated them in place.
      const original = pairs.map((pair) => pair.selected);
      SelectionService.toggleSelection(pairs, 'pair-0');
      expect(pairs.map((pair) => pair.selected)).toEqual(original);
    });

    it('only toggles the specified pair', () => {
      const result = SelectionService.toggleSelection(pairs, 'pair-1');
      expect(result[0]!.selected).toBe(true);
      expect(result[1]!.selected).toBe(false);
      expect(result[2]!.selected).toBe(false);
    });

    it('handles non-existent ID gracefully', () => {
      const result = SelectionService.toggleSelection(pairs, 'non-existent');
      expect(result[0]!.selected).toBe(true);
      expect(result[1]!.selected).toBe(true);
      expect(result[2]!.selected).toBe(false);
    });

    it('handles empty array', () => {
      const result = SelectionService.toggleSelection([], 'pair-0');
      expect(result).toEqual([]);
    });
  });

  describe('selectAll()', () => {
    it('selects all pairs', () => {
      const result = SelectionService.selectAll(pairs);
      expect(result[0]!.selected).toBe(true);
      expect(result[1]!.selected).toBe(true);
      expect(result[2]!.selected).toBe(true);
    });

    it('does not mutate the original array', () => {
      const original = [...pairs];
      SelectionService.selectAll(pairs);
      expect(pairs[2]!.selected).toBe(original[2]!.selected);
    });

    it('handles already selected pairs', () => {
      const allSelected = pairs.map((p) => ({ ...p, selected: true }));
      const result = SelectionService.selectAll(allSelected);
      expect(result[0]!.selected).toBe(true);
      expect(result[1]!.selected).toBe(true);
      expect(result[2]!.selected).toBe(true);
    });

    it('handles empty array', () => {
      const result = SelectionService.selectAll([]);
      expect(result).toEqual([]);
    });
  });

  describe('deselectAll()', () => {
    it('deselects all pairs', () => {
      const result = SelectionService.deselectAll(pairs);
      expect(result[0]!.selected).toBe(false);
      expect(result[1]!.selected).toBe(false);
      expect(result[2]!.selected).toBe(false);
    });

    it('does not mutate the original array', () => {
      const original = [...pairs];
      SelectionService.deselectAll(pairs);
      expect(pairs[0]!.selected).toBe(original[0]!.selected);
    });

    it('handles already deselected pairs', () => {
      const noneSelected = pairs.map((p) => ({ ...p, selected: false }));
      const result = SelectionService.deselectAll(noneSelected);
      expect(result[0]!.selected).toBe(false);
      expect(result[1]!.selected).toBe(false);
      expect(result[2]!.selected).toBe(false);
    });

    it('handles empty array', () => {
      const result = SelectionService.deselectAll([]);
      expect(result).toEqual([]);
    });
  });

  describe('getSelectedPairs()', () => {
    it('returns only selected pairs', () => {
      const result = SelectionService.getSelectedPairs(pairs);
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('pair-0');
      expect(result[1]!.id).toBe('pair-1');
    });

    it('returns empty array when none are selected', () => {
      const noneSelected = pairs.map((p) => ({ ...p, selected: false }));
      const result = SelectionService.getSelectedPairs(noneSelected);
      expect(result).toEqual([]);
    });

    it('returns all pairs when all are selected', () => {
      const allSelected = pairs.map((p) => ({ ...p, selected: true }));
      const result = SelectionService.getSelectedPairs(allSelected);
      expect(result).toHaveLength(3);
    });

    it('does not mutate the original array', () => {
      const original = [...pairs];
      SelectionService.getSelectedPairs(pairs);
      expect(pairs).toEqual(original);
    });

    it('handles empty array', () => {
      const result = SelectionService.getSelectedPairs([]);
      expect(result).toEqual([]);
    });
  });

  describe('getSelectionCount()', () => {
    it('returns count of selected pairs', () => {
      const count = SelectionService.getSelectionCount(pairs);
      expect(count).toBe(2);
    });

    it('returns 0 when none are selected', () => {
      const noneSelected = pairs.map((p) => ({ ...p, selected: false }));
      const count = SelectionService.getSelectionCount(noneSelected);
      expect(count).toBe(0);
    });

    it('returns total when all are selected', () => {
      const allSelected = pairs.map((p) => ({ ...p, selected: true }));
      const count = SelectionService.getSelectionCount(allSelected);
      expect(count).toBe(3);
    });

    it('handles empty array', () => {
      const count = SelectionService.getSelectionCount([]);
      expect(count).toBe(0);
    });
  });

  describe('isAllSelected()', () => {
    it('returns false when not all are selected', () => {
      const result = SelectionService.isAllSelected(pairs);
      expect(result).toBe(false);
    });

    it('returns true when all are selected', () => {
      const allSelected = pairs.map((p) => ({ ...p, selected: true }));
      const result = SelectionService.isAllSelected(allSelected);
      expect(result).toBe(true);
    });

    it('returns false when none are selected', () => {
      const noneSelected = pairs.map((p) => ({ ...p, selected: false }));
      const result = SelectionService.isAllSelected(noneSelected);
      expect(result).toBe(false);
    });

    it('returns true for empty array', () => {
      const result = SelectionService.isAllSelected([]);
      expect(result).toBe(true);
    });

    it('returns false when only one is not selected', () => {
      const mostlySelected = [
        createTestQAPair(0, 'Q1', 'A1', true),
        createTestQAPair(1, 'Q2', 'A2', true),
        createTestQAPair(2, 'Q3', 'A3', false),
      ];
      const result = SelectionService.isAllSelected(mostlySelected);
      expect(result).toBe(false);
    });
  });

  describe('isNoneSelected()', () => {
    it('returns false when some are selected', () => {
      const result = SelectionService.isNoneSelected(pairs);
      expect(result).toBe(false);
    });

    it('returns false when all are selected', () => {
      const allSelected = pairs.map((p) => ({ ...p, selected: true }));
      const result = SelectionService.isNoneSelected(allSelected);
      expect(result).toBe(false);
    });

    it('returns true when none are selected', () => {
      const noneSelected = pairs.map((p) => ({ ...p, selected: false }));
      const result = SelectionService.isNoneSelected(noneSelected);
      expect(result).toBe(true);
    });

    it('returns true for empty array', () => {
      const result = SelectionService.isNoneSelected([]);
      expect(result).toBe(true);
    });

    it('returns false when only one is selected', () => {
      const oneSelected = [
        createTestQAPair(0, 'Q1', 'A1', false),
        createTestQAPair(1, 'Q2', 'A2', true),
        createTestQAPair(2, 'Q3', 'A3', false),
      ];
      const result = SelectionService.isNoneSelected(oneSelected);
      expect(result).toBe(false);
    });
  });
});
