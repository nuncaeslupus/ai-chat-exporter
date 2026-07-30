/**
 * Service for handling Claude API data
 * Extracts artifact content from Claude API responses
 */

import type {
  ClaudeApiConversationResponse,
  ClaudeApiRequest,
  Artifact,
  Conversation,
} from '../types';
import { isArtifactContent } from '../types';
import type { MessageResponse } from '../../shared/messages';

/** The slice of Claude's `__NEXT_DATA__` blob this service reads. */
interface NextData {
  props?: {
    pageProps?: {
      organizationId?: string;
      selectedOrganization?: { uuid?: string };
    };
  };
}

/**
 * Outcome of an enrichment attempt.
 *
 * `warning` is set when the export is degraded — artifact contents could not
 * be recovered — so the caller can tell the user rather than shipping an
 * export that is silently missing them.
 */
export interface EnrichmentResult {
  conversation: Conversation;
  warning?: string;
}

/**
 * Service for enriching conversations with Claude API data
 */
export class ClaudeApiService {
  /**
   * Resolved organization IDs, keyed by document instance. `extractIdsFromPage`
   * runs on every export and print click in the same page session, so without
   * this the full-document HTML fallback below (step 6) would re-serialize the
   * whole page every time.
   */
  private static organizationIdCache = new WeakMap<Document, string | null>();

  /**
   * Extract organization ID from DOM
   * Claude stores the org ID in various places in the page
   */
  static extractOrganizationId(document: Document): string | null {
    if (this.organizationIdCache.has(document)) {
      return this.organizationIdCache.get(document) ?? null;
    }

    const organizationId = this.findOrganizationId(document);
    this.organizationIdCache.set(document, organizationId);
    return organizationId;
  }

  /**
   * Checks are ordered cheapest-first. Step 6 (full-document HTML scrape) is
   * a last resort: it serializes the entire page, which is multi-MB and
   * synchronous on a long conversation, so it must only run once every
   * cheaper source below has failed.
   */
  private static findOrganizationId(document: Document): string | null {
    // Try multiple approaches to find the organization ID

    // 1. Check for next.js data
    const nextData = document.getElementById('__NEXT_DATA__');
    if (nextData?.textContent) {
      try {
        const data = JSON.parse(nextData.textContent) as NextData;

        // Navigate through potential paths where org ID might be
        if (data?.props?.pageProps?.organizationId) {
          return data.props.pageProps.organizationId;
        }
        if (data?.props?.pageProps?.selectedOrganization?.uuid) {
          return data.props.pageProps.selectedOrganization.uuid;
        }
      } catch (error) {
        console.warn('[Claude API Service] Failed to parse __NEXT_DATA__:', error);
      }
    }

    // 2. Check for org ID in localStorage (Claude might store it there)
    try {
      const storedOrgId = localStorage.getItem('lastOrganizationId');
      if (storedOrgId) {
        return storedOrgId;
      }
    } catch (error) {
      console.warn('[Claude API Service] localStorage not accessible:', error);
    }

    // 3. Check URL parameters (some Claude URLs include org ID)
    const urlParams = new URLSearchParams(window.location.search);
    const orgIdParam = urlParams.get('orgId') || urlParams.get('organizationId');
    if (orgIdParam) {
      return orgIdParam;
    }

    // 4. Check for React props in DOM elements
    const allElements = document.querySelectorAll('[data-organization-id]');
    for (const element of allElements) {
      const orgId = element.getAttribute('data-organization-id');
      if (orgId) {
        return orgId;
      }
    }

    // 5. Check for org ID in image/file URLs (Claude uses /api/{orgId}/files/... pattern)
    const images = document.querySelectorAll('img[src^="/api/"]');
    for (const img of images) {
      const src = img.getAttribute('src');
      if (src) {
        const apiMatch = /^\/api\/([a-f0-9-]{36})\//.exec(src);
        if (apiMatch?.[1]) {
          return apiMatch[1];
        }
      }
    }

    // 6. Last resort: check for organization ID in page HTML (often in script
    // tags or meta tags; Claude sends org ID in Statsig analytics). This
    // serializes the entire document, so it only runs once every cheap
    // source above has failed.
    const htmlContent = document.documentElement.innerHTML;

    const patterns = [
      /"organizationID":"([a-f0-9-]{36})"/i,
      /"organizationUUID":"([a-f0-9-]{36})"/i,
      /"organization_id":"([a-f0-9-]{36})"/i,
    ];

    for (const pattern of patterns) {
      const match = htmlContent.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    console.warn('[Claude API Service] Could not find organization ID in DOM');
    return null;
  }

  /**
   * Extract conversation ID and organization ID from Claude page
   */
  static extractIdsFromPage(url: string, document: Document): ClaudeApiRequest | null {
    try {
      const urlObj = new URL(url);

      // Example URL: https://claude.ai/chat/00000000-0000-4000-8000-000000000000
      const pathMatch = /\/chat\/([a-f0-9-]+)/.exec(urlObj.pathname);
      if (!pathMatch?.[1]) {
        console.warn('[Claude API Service] Could not extract conversation ID from URL:', url);
        return null;
      }

      const conversationId = pathMatch[1];
      const organizationId = this.extractOrganizationId(document);

      if (!organizationId) {
        console.warn(
          '[Claude API Service] Organization ID not found. API enrichment will not be available.'
        );
        return null;
      }

      return { organizationId, conversationId };
    } catch (error) {
      console.error('[Claude API Service] Error extracting IDs:', error);
      return null;
    }
  }

  /**
   * Fetch conversation data from Claude API via background script
   */
  static async fetchConversationData(
    request: ClaudeApiRequest
  ): Promise<ClaudeApiConversationResponse | null> {
    try {
      const response = await chrome.runtime.sendMessage<
        unknown,
        MessageResponse<ClaudeApiConversationResponse>
      >({
        type: 'fetch_claude_api_data',
        data: request,
      });

      if (!response.success || !response.data) {
        console.error('[Claude API Service] Failed to fetch data:', response.error);
        return null;
      }

      return response.data;
    } catch (error) {
      console.error('[Claude API Service] Error fetching conversation data:', error);
      return null;
    }
  }

  /**
   * Extract all artifacts from Claude API response, keyed by the message's
   * stable API uuid (never by array position or title).
   */
  static extractArtifacts(apiData: ClaudeApiConversationResponse): Map<string, Artifact[]> {
    const artifactsByMessageUuid = new Map<string, Artifact[]>();

    for (const message of apiData.chat_messages) {
      // Only process assistant messages
      if (message.sender !== 'assistant') {
        continue;
      }

      const artifacts: Artifact[] = [];

      // Look for artifact tool use in content
      for (const content of message.content || []) {
        if (isArtifactContent(content)) {
          const input = content.input;

          // Map Claude API artifact type to our artifact type
          let type = 'unknown';
          let language: string | undefined;

          if (input.type.includes('svg')) {
            type = 'image';
            language = 'svg';
          } else if (input.type.includes('html')) {
            // Pure HTML files
            if (input.language === 'react' || input.type.includes('vnd.ant.react')) {
              // React/JSX artifacts
              type = 'react';
              language = 'tsx';
            } else {
              // Plain HTML
              type = 'react'; // Keep type as 'react' for backwards compatibility
              language = 'html';
            }
          } else if (input.type.includes('vnd.ant.react')) {
            type = 'react';
            language = 'tsx';
          } else if (input.type.includes('markdown')) {
            type = 'document';
            language = 'markdown';
          } else if (input.language === 'mermaid') {
            type = 'diagram';
            language = 'mermaid';
          } else {
            type = 'code';
            language = input.language;
          }

          artifacts.push({
            type,
            title: input.title,
            ...(language && { language }),
            content: input.content,
            typeLabel: this.getTypeLabelFromType(type),
          });
        }
      }

      if (artifacts.length > 0) {
        artifactsByMessageUuid.set(message.uuid, artifacts);
      }
    }

    return artifactsByMessageUuid;
  }

  /**
   * Get a human-readable type label from artifact type
   */
  private static getTypeLabelFromType(type: string): string {
    const typeLabels: Record<string, string> = {
      image: 'Image',
      react: 'Interactive Artifact',
      document: 'Document',
      diagram: 'Diagram',
      code: 'Code',
    };

    return typeLabels[type] || 'Artifact';
  }

  /**
   * Enrich conversation with artifact content from API.
   *
   * The DOM scrape and the API response are independently sourced and share
   * no common identifier: the API exposes a stable `uuid` per message, but
   * the DOM-scraped `Message.id` is generated locally by the parser and has
   * no relationship to it. So a Q&A pair can only be matched to its API
   * message *positionally* — by assuming the Nth DOM pair corresponds to the
   * Nth assistant message in the API response.
   *
   * That assumption breaks when the two disagree in shape (an edited or
   * regenerated turn, a deleted message, ...). Rather than guess, this bails
   * out of enrichment entirely when the counts don't match and returns a
   * `warning` so the caller can surface the degraded export to the user — a
   * console.warn alone left the user with an artifact-less export and no
   * signal at all. Once a pair IS matched to its API message, all further
   * artifact data for that pair comes straight from the API's own artifact
   * list (keyed by the API's own stable message uuid) — never from
   * title-matching, which silently collides when two artifacts share a
   * title.
   */
  static enrichConversationWithArtifacts(
    conversation: Conversation,
    apiData: ClaudeApiConversationResponse
  ): EnrichmentResult {
    const artifactsByMessageUuid = this.extractArtifacts(apiData);

    if (artifactsByMessageUuid.size === 0) {
      return { conversation };
    }

    const assistantMessages = apiData.chat_messages.filter(
      (message) => message.sender === 'assistant'
    );

    if (assistantMessages.length !== conversation.pairs.length) {
      const warning =
        `Artifact contents were left out of this export: the page shows ${String(conversation.pairs.length)} ` +
        `replies but Claude reports ${String(assistantMessages.length)}, so artifacts could not be ` +
        'matched to the right reply (this happens when a turn was edited, regenerated ' +
        'or deleted). Reload the conversation and export again.';
      console.warn(`[Claude API Service] ${warning}`);
      return { conversation, warning };
    }

    // Enrich conversation pairs with artifact content, matching each pair to
    // its API message by ordinal position (validated above) and its
    // artifacts by the message's own stable uuid.
    const enrichedPairs = conversation.pairs.map((pair, pairIndex) => {
      const assistantMessage = assistantMessages[pairIndex];
      const apiArtifacts = assistantMessage
        ? artifactsByMessageUuid.get(assistantMessage.uuid)
        : undefined;

      if (!apiArtifacts) {
        return pair;
      }

      return {
        ...pair,
        answer: {
          ...pair.answer,
          metadata: {
            ...pair.answer.metadata,
            artifacts: apiArtifacts,
          },
        },
      };
    });

    return {
      conversation: {
        ...conversation,
        pairs: enrichedPairs,
      },
    };
  }
}
