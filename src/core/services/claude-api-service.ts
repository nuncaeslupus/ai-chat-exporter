/**
 * Service for handling Claude API data
 * Extracts artifact content from Claude API responses
 */

import type {
  ClaudeApiConversationResponse,
  ClaudeApiRequest,
  ClaudeApiChatMessage,
  Artifact,
  Conversation,
  QAPair,
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
   * Pair up each Q&A pair with the API messages that produced it.
   *
   * The DOM exposes no id related to the API's uuid, so the match is
   * *positional*: the Nth pair is the Nth human message and the Nth assistant
   * message. That assumption breaks when the two disagree in shape (an edited,
   * regenerated or deleted turn), so both counts are validated up front and a
   * mismatch bails out with a user-facing warning rather than guessing.
   */
  private static matchPairsToApiMessages(
    conversation: Conversation,
    apiData: ClaudeApiConversationResponse
  ):
    | {
        matched: {
          pair: QAPair;
          human: ClaudeApiChatMessage | undefined;
          assistant: ClaudeApiChatMessage | undefined;
        }[];
      }
    | { warning: string } {
    const humanMessages = apiData.chat_messages.filter((m) => m.sender === 'human');
    const assistantMessages = apiData.chat_messages.filter((m) => m.sender === 'assistant');
    const pairCount = conversation.pairs.length;

    if (assistantMessages.length !== pairCount || humanMessages.length !== pairCount) {
      // Always state the actual measured counts for both sides (never just
      // the one the brief's original wording assumed was the culprit) so the
      // message can never claim two equal counts while reporting a mismatch.
      const plural = (n: number, noun: string): string =>
        `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
      const warning =
        `Artifact contents and message times were left out of this export: the page shows ${String(pairCount)} ` +
        `Q&A pairs, but Claude reports ${plural(humanMessages.length, 'human message')} and ` +
        `${plural(assistantMessages.length, 'assistant message')}, so they could not be matched to the right ` +
        'turn (this happens when a turn was edited, regenerated or deleted). Reload the conversation and ' +
        'export again.';
      console.warn(`[Claude API Service] ${warning}`);
      return { warning };
    }

    return {
      matched: conversation.pairs.map((pair, index) => ({
        pair,
        human: humanMessages[index],
        assistant: assistantMessages[index],
      })),
    };
  }

  /** An API `created_at` as a Date, or undefined when it is absent or unparseable. */
  private static parseApiTime(iso?: string): Date | undefined {
    if (!iso) return undefined;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  /**
   * Enrich conversation with artifact content and per-message timestamps
   * from the API.
   *
   * The DOM scrape and the API response are independently sourced and share
   * no common identifier: the API exposes a stable `uuid` per message, but
   * the DOM-scraped `Message.id` is generated locally by the parser and has
   * no relationship to it. So a Q&A pair can only be matched to its API
   * message *positionally* — by assuming the Nth DOM pair corresponds to the
   * Nth human message and Nth assistant message in the API response (see
   * `matchPairsToApiMessages`).
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
  static enrichConversation(
    conversation: Conversation,
    apiData: ClaudeApiConversationResponse
  ): EnrichmentResult {
    const artifactsByMessageUuid = this.extractArtifacts(apiData);
    const match = this.matchPairsToApiMessages(conversation, apiData);

    if ('warning' in match) {
      return { conversation, warning: match.warning };
    }

    const enrichedPairs = match.matched.map(({ pair, human, assistant }) => {
      const apiArtifacts = assistant ? artifactsByMessageUuid.get(assistant.uuid) : undefined;
      const questionTime = this.parseApiTime(human?.created_at);
      const answerTime = this.parseApiTime(assistant?.created_at);

      return {
        ...pair,
        question: {
          ...pair.question,
          ...(questionTime && { timestamp: questionTime }),
        },
        answer: {
          ...pair.answer,
          ...(answerTime && { timestamp: answerTime }),
          ...(apiArtifacts && {
            metadata: { ...pair.answer.metadata, artifacts: apiArtifacts },
          }),
        },
      };
    });

    return { conversation: { ...conversation, pairs: enrichedPairs } };
  }
}
