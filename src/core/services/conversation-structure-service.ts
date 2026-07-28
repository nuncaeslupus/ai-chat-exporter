/**
 * Conversation Structure Service
 * Converts basic conversations to structured format with rich content
 */

import type {
  Conversation,
  StructuredConversation,
  StructuredQAPair,
  StructuredMessage,
  StructuredContentBlock,
  Artifact,
  WebSearchResult,
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
    // Parse HTML content for rich formatting when available; fall back to plain text.
    const blocks: StructuredContentBlock[] = message.htmlContent
      ? HtmlContentParser.parse(message.htmlContent)
      : [
          {
            type: 'paragraph' as const,
            content: [{ type: 'text' as const, text: message.content }],
          },
        ];

    // Web searches and artifacts don't live in htmlContent (they're rendered from
    // separate DOM elements), so append them as marker paragraphs rather than
    // letting them replace the parsed rich content.
    const webSearches: WebSearchResult[] | undefined = message.metadata?.webSearches;
    if (Array.isArray(webSearches)) {
      for (const search of webSearches) {
        blocks.push({
          type: 'paragraph' as const,
          content: [{ type: 'text' as const, text: `[Web Search: ${search.query}]` }],
        });
      }
    }
    const artifacts: Artifact[] | undefined = message.metadata?.artifacts;
    if (Array.isArray(artifacts)) {
      for (const artifact of artifacts) {
        // Every exporter renders a full "Artifacts" section (title, type, content)
        // for any artifact that has content, so the marker would just repeat the
        // same title a second time. Only fall back to the marker when there's no
        // fuller rendering downstream to announce the artifact.
        if (artifact.content) {
          continue;
        }
        blocks.push({
          type: 'paragraph' as const,
          content: [
            {
              type: 'text' as const,
              text: `[${artifact.typeLabel ?? artifact.type}: ${artifact.title}]`,
            },
          ],
        });
      }
    }

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
