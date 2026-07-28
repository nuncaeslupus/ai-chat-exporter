/**
 * Conversation Structure Service
 * Converts basic conversations to structured format with rich content
 */

import type {
  Conversation,
  Message,
  QAPair,
  StructuredConversation,
  StructuredQAPair,
  StructuredMessage,
  StructuredContentBlock,
  Artifact,
  ImageBlock,
  MediaBlock,
  MediaItem,
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
  private static convertPair(pair: QAPair, index: number): StructuredQAPair {
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
  private static convertMessage(message: Message): StructuredMessage {
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
        // Every exporter renders a full sources section for a search that has
        // results, so the marker would just repeat the query above it. Only
        // fall back to the marker when there is nothing downstream to announce
        // the search: md / txt / docx skip a result-less search entirely, and
        // it would vanish from those exports.
        // ponytail: html / pdf do render their section from the query alone, so
        // a result-less search is announced twice there — the cheap price for
        // one guard in the shared converter instead of three per-format ones.
        if (search.results?.length) {
          continue;
        }
        blocks.push({
          type: 'paragraph' as const,
          content: [{ type: 'text' as const, text: `[Web Search: ${search.query}]` }],
        });
      }
    }
    // Deep research stats (ChatGPT) are three numbers, not renderable content —
    // a marker paragraph is enough, and it reaches every format through the same
    // route [Web Search: …] takes instead of six per-exporter sections.
    const research = message.metadata?.research;
    if (research) {
      const parts = [
        research.duration,
        research.sources ? `${research.sources} sources` : '',
        research.searches ? `${research.searches} searches` : '',
      ].filter(Boolean);
      if (parts.length > 0) {
        blocks.push({
          type: 'paragraph' as const,
          content: [{ type: 'text' as const, text: `[Deep Research: ${parts.join(', ')}]` }],
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

    // Add media from metadata if present. `metadata.images` is the legacy
    // image-only alias for `metadata.media`, so both feed the same loop.
    const legacyImages: MediaItem[] = Array.isArray(message.metadata?.images)
      ? message.metadata.images.map((image) => ({ ...image, kind: 'image' as const }))
      : [];
    const media: MediaItem[] = Array.isArray(message.metadata?.media)
      ? message.metadata.media
      : [];

    for (const item of [...legacyImages, ...media]) {
      if (!item.src) {
        continue;
      }

      if (item.kind === 'image') {
        const imageBlock: ImageBlock = {
          type: 'image',
          url: item.src,
          alt: item.alt ?? 'Image',
        };
        if (item.width) {
          imageBlock.width = item.width;
        }
        if (item.height) {
          imageBlock.height = item.height;
        }
        blocks.push(imageBlock);
        continue;
      }

      const mediaBlock: MediaBlock = {
        type: 'media',
        kind: item.kind,
        url: item.src,
        alt: item.alt ?? (item.kind === 'video' ? 'Video' : 'Audio'),
      };
      if (item.mimeType) {
        mediaBlock.mimeType = item.mimeType;
      }
      if (item.duration) {
        mediaBlock.duration = item.duration;
      }
      blocks.push(mediaBlock);
    }

    const structuredMessage: StructuredMessage = {
      id: message.id,
      role: message.role,
      // `Message.timestamp` is optional (parsers don't always find one);
      // `StructuredMessage.timestamp` is required, so fall back to now.
      timestamp: message.timestamp || new Date(),
      blocks,
    };

    // Preserve metadata if it exists
    if (message.metadata) {
      structuredMessage.metadata = message.metadata;
    }

    return structuredMessage;
  }
}
