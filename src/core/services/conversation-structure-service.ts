/**
 * Conversation Structure Service
 * Converts basic conversations to structured format with rich content
 */

import type {
  Conversation,
  StructuredConversation,
  StructuredQAPair,
  StructuredMessage,
} from '../types';
import { HtmlContentParser } from './html-content-parser';

export class ConversationStructureService {
  /**
   * Convert a basic conversation to structured format
   */
  static toStructured(conversation: Conversation): StructuredConversation {
    return {
      id: conversation.id,
      title: conversation.title,
      platform: conversation.platform,
      model: conversation.model || '',
      url: conversation.url,
      createdAt: conversation.createdAt || new Date(),
      pairs: conversation.pairs.map((pair, index) => this.convertPair(pair, index)),
    };
  }

  /**
   * Convert a Q&A pair to structured format
   */
  private static convertPair(pair: any, index: number): StructuredQAPair {
    return {
      id: pair.id,
      index,
      question: this.convertMessage(pair.question),
      answer: this.convertMessage(pair.answer),
      selected: pair.selected,
    };
  }

  /**
   * Convert a message to structured format
   */
  private static convertMessage(message: any): StructuredMessage {
    // Check if message has special content (web searches, artifacts) that need markers
    const hasSpecialContent = message.metadata?.webSearches || message.metadata?.artifacts;

    // If message has web searches or artifacts, use plain content (which includes markers like [Web Search:])
    // Otherwise, parse HTML content for rich formatting if available
    const blocks = hasSpecialContent
      ? [
          {
            type: 'paragraph' as const,
            content: [{ type: 'text' as const, text: message.content }],
          },
        ]
      : message.htmlContent
      ? HtmlContentParser.parse(message.htmlContent)
      : [
          {
            type: 'paragraph' as const,
            content: [{ type: 'text' as const, text: message.content }],
          },
        ];

    // Add images from metadata if present
    if (message.metadata?.images && Array.isArray(message.metadata.images)) {
      for (const image of message.metadata.images) {
        if (image.src) {
          const imageBlock: any = {
            type: 'image' as const,
            url: image.src,
            alt: image.alt || 'Image',
          };

          // Add dimensions if available
          if (image.width) {
            imageBlock.width = image.width;
          }
          if (image.height) {
            imageBlock.height = image.height;
          }

          blocks.push(imageBlock);
        }
      }
    }

    const structuredMessage: StructuredMessage = {
      id: message.id,
      role: message.role,
      timestamp: message.timestamp,
      blocks,
    };

    // Preserve metadata if it exists
    if (message.metadata) {
      structuredMessage.metadata = message.metadata;
    }

    return structuredMessage;
  }
}
