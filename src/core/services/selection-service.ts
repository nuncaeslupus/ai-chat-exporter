/**
 * Selection Service
 * Handles selection state management for Q&A pairs
 */

import type { QAPair } from '../types/conversation';

/**
 * Service for managing selection state of Q&A pairs
 */
export class SelectionService {
  /**
   * Toggle selection state of a specific pair
   */
  static toggleSelection(pairs: QAPair[], id: string): QAPair[] {
    return pairs.map((pair) =>
      pair.id === id ? { ...pair, selected: !pair.selected } : { ...pair }
    );
  }

  /**
   * Select all pairs
   */
  static selectAll(pairs: QAPair[]): QAPair[] {
    return pairs.map((pair) => ({ ...pair, selected: true }));
  }

  /**
   * Deselect all pairs
   */
  static deselectAll(pairs: QAPair[]): QAPair[] {
    return pairs.map((pair) => ({ ...pair, selected: false }));
  }

  /**
   * Get only the selected pairs
   */
  static getSelectedPairs(pairs: QAPair[]): QAPair[] {
    return pairs.filter((pair) => pair.selected);
  }

  /**
   * Get count of selected pairs
   */
  static getSelectionCount(pairs: QAPair[]): number {
    return pairs.filter((pair) => pair.selected).length;
  }

  /**
   * Check if all pairs are selected
   */
  static isAllSelected(pairs: QAPair[]): boolean {
    if (pairs.length === 0) {
      return true;
    }
    return pairs.every((pair) => pair.selected);
  }

  /**
   * Check if no pairs are selected
   */
  static isNoneSelected(pairs: QAPair[]): boolean {
    return pairs.every((pair) => !pair.selected);
  }

  /**
   * Select a range of pairs (inclusive)
   */
  static selectRange(pairs: QAPair[], start: number, end: number): QAPair[] {
    const min = Math.min(start, end);
    const max = Math.max(start, end);

    return pairs.map((pair, index) =>
      index >= min && index <= max ? { ...pair, selected: true } : { ...pair }
    );
  }

  /**
   * Invert selection (selected becomes unselected and vice versa)
   */
  static invertSelection(pairs: QAPair[]): QAPair[] {
    return pairs.map((pair) => ({ ...pair, selected: !pair.selected }));
  }
}
