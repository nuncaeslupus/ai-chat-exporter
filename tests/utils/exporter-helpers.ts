/**
 * Test utilities for exporters
 */

import type { QAPair } from '../../src/core/types';

/**
 * Convert a Blob to text for testing purposes
 * Works with both browser Blob and Node.js Buffer-based blobs
 */
export async function blobToText(blob: Blob): Promise<string> {
  // Try modern Blob.text() first
  if (typeof blob.text === 'function') {
    return blob.text();
  }

  // Try arrayBuffer approach
  if (typeof blob.arrayBuffer === 'function') {
    const buffer = await blob.arrayBuffer();
    return new TextDecoder().decode(buffer);
  }

  // Fallback: use FileReader (works in JSDOM)
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { resolve(reader.result as string); };
    reader.onerror = () => { reject(new Error('Failed to read blob')); };
    reader.readAsText(blob);
  });
}

/**
 * Create a simple test message
 */
export function createTestMessage(
  role: 'user' | 'assistant',
  content: string,
  id?: string
) {
  return {
    id: id ?? `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    role,
    content,
    timestamp: new Date('2025-01-01T12:00:00Z'),
  };
}

/**
 * Create a test Q&A pair
 */
export function createTestQAPair(
  index: number,
  question: string,
  answer: string,
  selected = true
) {
  return {
    id: `pair-${index}`,
    index,
    question: createTestMessage('user', question, `q-${index}`),
    answer: createTestMessage('assistant', answer, `a-${index}`),
    selected,
  };
}

/**
 * Create a test conversation
 */
export function createTestConversation(pairs: QAPair[]) {
  return {
    id: 'test-conversation',
    title: 'Test Conversation',
    platform: 'chatgpt' as const,
    model: 'gpt-4',
    pairs,
    url: 'https://chatgpt.com/c/test',
    createdAt: new Date('2025-01-01T12:00:00Z'),
  };
}
