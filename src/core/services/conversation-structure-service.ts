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
    // Parse HTML content if available, otherwise use plain text
    const blocks = message.htmlContent
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

    return {
      id: message.id,
      role: message.role,
      timestamp: message.timestamp,
      blocks,
    };
  }
}
