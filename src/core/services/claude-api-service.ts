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

/**
 * Service for enriching conversations with Claude API data
 */
export class ClaudeApiService {
  /**
   * Extract organization ID from DOM
   * Claude stores the org ID in various places in the page
   */
  static extractOrganizationId(document: Document): string | null {
    // Try multiple approaches to find the organization ID
    console.log('[Claude API Service] Starting organization ID extraction...');

    // 1. Check for next.js data
    const nextData = document.getElementById('__NEXT_DATA__');
    console.log('[Claude API Service] __NEXT_DATA__ element exists:', !!nextData);
    if (nextData?.textContent) {
      try {
        const data = JSON.parse(nextData.textContent);
        console.log('[Claude API Service] __NEXT_DATA__ parsed successfully');
        console.log('[Claude API Service] __NEXT_DATA__ keys:', Object.keys(data));

        // Navigate through potential paths where org ID might be
        if (data?.props?.pageProps?.organizationId) {
          console.log('[Claude API Service] Found org ID in __NEXT_DATA__.props.pageProps.organizationId');
          return data.props.pageProps.organizationId;
        }
        if (data?.props?.pageProps?.selectedOrganization?.uuid) {
          console.log('[Claude API Service] Found org ID in __NEXT_DATA__.props.pageProps.selectedOrganization.uuid');
          return data.props.pageProps.selectedOrganization.uuid;
        }
        console.log('[Claude API Service] __NEXT_DATA__ props.pageProps:', data?.props?.pageProps ? Object.keys(data.props.pageProps) : 'undefined');
      } catch (error) {
        console.warn('[Claude API Service] Failed to parse __NEXT_DATA__:', error);
      }
    }

    // 2. Check for org ID in localStorage (Claude might store it there)
    try {
      const storedOrgId = localStorage.getItem('lastOrganizationId');
      console.log('[Claude API Service] localStorage lastOrganizationId:', storedOrgId ? 'found' : 'not found');
      if (storedOrgId) {
        console.log('[Claude API Service] Found org ID in localStorage');
        return storedOrgId;
      }
    } catch (error) {
      console.warn('[Claude API Service] localStorage not accessible:', error);
    }

    // 3. Check for organization ID in page HTML (often in script tags or meta tags)
    // Claude sends org ID in Statsig analytics - search for it in the page source
    const htmlContent = document.documentElement.innerHTML;
    console.log('[Claude API Service] Searching HTML content (length:', htmlContent.length, 'chars)');
    console.log('[Claude API Service] HTML preview (first 1000 chars):', htmlContent.substring(0, 1000));

    const patterns = [
      /"organizationID":"([a-f0-9-]{36})"/i,
      /"organizationUUID":"([a-f0-9-]{36})"/i,
      /"organization_id":"([a-f0-9-]{36})"/i
    ];

    for (const [index, pattern] of patterns.entries()) {
      const match = htmlContent.match(pattern);
      console.log(`[Claude API Service] Pattern ${index + 1} match:`, match ? match[1] : 'no match');
      if (match && match[1]) {
        console.log('[Claude API Service] Found organization ID in page content');
        return match[1];
      }
    }

    // 4. Check for org ID in image/file URLs (Claude uses /api/{orgId}/files/... pattern)
    const images = document.querySelectorAll('img[src^="/api/"]');
    console.log('[Claude API Service] Found images with /api/ URLs:', images.length);
    for (const img of images) {
      const src = img.getAttribute('src');
      if (src) {
        const apiMatch = src.match(/^\/api\/([a-f0-9-]{36})\//);
        if (apiMatch && apiMatch[1]) {
          console.log('[Claude API Service] Found org ID in image URL:', src);
          return apiMatch[1];
        }
      }
    }

    // 5. Check URL parameters (some Claude URLs include org ID)
    const urlParams = new URLSearchParams(window.location.search);
    const orgIdParam = urlParams.get('orgId') || urlParams.get('organizationId');
    console.log('[Claude API Service] URL parameters check:', orgIdParam ? 'found' : 'not found');
    if (orgIdParam) {
      return orgIdParam;
    }

    // 6. Check for React props in DOM elements
    const allElements = document.querySelectorAll('[data-organization-id]');
    for (const element of allElements) {
      const orgId = element.getAttribute('data-organization-id');
      if (orgId) {
        return orgId;
      }
    }

    console.warn('[Claude API Service] Could not find organization ID in DOM');
    return null;
  }

  /**
   * Extract conversation ID and organization ID from Claude page
   */
  static extractIdsFromPage(
    url: string,
    document: Document
  ): ClaudeApiRequest | null {
    try {
      const urlObj = new URL(url);

      // Example URL: https://claude.ai/chat/0ee665c3-eaa5-485b-83aa-184065da1977
      const pathMatch = urlObj.pathname.match(/\/chat\/([a-f0-9-]+)/);
      if (!pathMatch || !pathMatch[1]) {
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
      const response = await chrome.runtime.sendMessage({
        type: 'fetch_claude_api_data',
        data: request,
      });

      if (!response.success || !response.data) {
        console.error('[Claude API Service] Failed to fetch data:', response.error);
        return null;
      }

      console.log('[Claude API Service] API response received, messages:', response.data.chat_messages?.length);
      return response.data as ClaudeApiConversationResponse;
    } catch (error) {
      console.error('[Claude API Service] Error fetching conversation data:', error);
      return null;
    }
  }

  /**
   * Extract all artifacts from Claude API response
   */
  static extractArtifacts(apiData: ClaudeApiConversationResponse): Map<number, Artifact[]> {
    const artifactsByMessageIndex = new Map<number, Artifact[]>();
    console.log('[Claude API Service] extractArtifacts: Processing', apiData.chat_messages.length, 'messages');

    for (const message of apiData.chat_messages) {
      // Only process assistant messages
      if (message.sender !== 'assistant') {
        continue;
      }

      const artifacts: Artifact[] = [];
      console.log(`[Claude API Service] Message ${message.index}: ${message.content?.length || 0} content blocks`);

      // Look for artifact tool use in content
      for (const content of message.content || []) {
        console.log(`[Claude API Service] Content block type:`, content.type, 'name:', (content as any).name);
        if (isArtifactContent(content)) {
          const input = content.input;
          console.log(`[Claude API Service] Found artifact:`, input.title, 'type:', input.type, 'contentLength:', input.content?.length || 0);

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
        console.log(`[Claude API Service] Message ${message.index}: Found ${artifacts.length} artifacts`);
        artifactsByMessageIndex.set(message.index, artifacts);
      }
    }

    console.log('[Claude API Service] Total messages with artifacts:', artifactsByMessageIndex.size);
    return artifactsByMessageIndex;
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
   * Enrich conversation with artifact content from API
   */
  static enrichConversationWithArtifacts(
    conversation: Conversation,
    apiData: ClaudeApiConversationResponse
  ): Conversation {
    // Extract artifacts by message index
    const artifactsByIndex = this.extractArtifacts(apiData);

    if (artifactsByIndex.size === 0) {
      console.log('[Claude API Service] No artifacts found in API response');
      return conversation;
    }

    console.log(
      `[Claude API Service] Found artifacts in ${artifactsByIndex.size} messages`
    );

    // Enrich conversation pairs with artifact content
    const enrichedPairs = conversation.pairs.map((pair, pairIndex) => {
      // Claude API uses absolute message indices: user=0, assistant=1, user=2, assistant=3, etc.
      // For pair N, the assistant message is at index (N * 2 + 1)
      const assistantMessageIndex = pairIndex * 2 + 1;
      const apiArtifacts = artifactsByIndex.get(assistantMessageIndex);

      console.log(`[Claude API Service] Pair ${pairIndex}: Looking for artifacts at message index ${assistantMessageIndex}`);
      console.log(`[Claude API Service] Pair ${pairIndex}: API artifacts found:`, !!apiArtifacts);
      console.log(`[Claude API Service] Pair ${pairIndex}: Existing artifacts:`, pair.answer.metadata?.artifacts?.length || 0);

      if (!apiArtifacts) {
        console.log(`[Claude API Service] Pair ${pairIndex}: No API artifacts at index ${assistantMessageIndex}`);
        return pair;
      }

      // Merge API artifacts with existing artifacts in metadata
      const existingArtifacts = pair.answer.metadata?.artifacts || [];
      console.log(`[Claude API Service] Pair ${pairIndex}: Merging ${apiArtifacts.length} API artifacts with ${existingArtifacts.length} existing artifacts`);

      // Match artifacts by title and update content
      const mergedArtifacts: Artifact[] = existingArtifacts.map((existing) => {
        const apiArtifact = apiArtifacts.find((api) => api.title === existing.title);

        if (apiArtifact && apiArtifact.content) {
          console.log(
            `[Claude API Service] Enriching artifact "${existing.title}" with content from API`
          );

          const enriched: Artifact = {
            ...existing,
            content: apiArtifact.content,
          };

          // Only update language if API provides one
          if (apiArtifact.language) {
            enriched.language = apiArtifact.language;
          }

          return enriched;
        }

        return existing;
      });

      // Add any API artifacts that weren't in the existing list
      for (const apiArtifact of apiArtifacts) {
        if (!mergedArtifacts.find((a) => a.title === apiArtifact.title)) {
          console.log(
            `[Claude API Service] Adding new artifact "${apiArtifact.title}" from API`
          );
          mergedArtifacts.push(apiArtifact);
        }
      }

      // Update the answer metadata
      return {
        ...pair,
        answer: {
          ...pair.answer,
          metadata: {
            ...pair.answer.metadata,
            artifacts: mergedArtifacts,
          },
        },
      };
    });

    return {
      ...conversation,
      pairs: enrichedPairs,
    };
  }
}
