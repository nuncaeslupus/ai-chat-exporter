/**
 * Service for handling ChatGPT's backend conversation API data.
 *
 * Mirrors `claude-api-service.ts`: read the real per-message time from the
 * backend payload instead of the DOM. ChatGPT's DOM renders no timestamp at
 * all (unlike Claude's HH:MM-only label), so there is nothing to fall back
 * to -- this is the only source, and when it is unavailable the result is
 * `undefined`, never a guess (D-18, #141).
 */

import type {
  ChatGPTApiConversationResponse,
  ChatGPTApiMessage,
  ChatGPTApiNode,
  ChatGPTApiRequest,
} from '../types';
import type { Conversation } from '../types';
import type { MessageResponse } from '../../shared/messages';

/**
 * Outcome of an enrichment attempt. `warning` is set when the export is
 * degraded -- real per-message timestamps could not be attached -- so the
 * caller can tell the user instead of shipping a silently degraded export.
 */
export interface ChatGPTEnrichmentResult {
  conversation: Conversation;
  warning?: string;
}

/**
 * Service for enriching ChatGPT conversations with per-message timestamps
 * from the backend conversation endpoint.
 */
export class ChatGPTApiService {
  /**
   * Extract the conversation id from a ChatGPT URL.
   *
   * Unlike Claude's API, ChatGPT's conversation endpoint needs no separate
   * organization id -- the conversation id alone is enough to build the
   * request.
   */
  static extractIdsFromPage(url: string): ChatGPTApiRequest | null {
    // Example URLs: https://chatgpt.com/c/00000000-0000-4000-8000-000000000000
    //               https://chat.openai.com/c/00000000-0000-4000-8000-000000000000
    const match = /\/c\/([a-f0-9-]+)/i.exec(url);
    if (!match?.[1]) {
      console.warn('[ChatGPT API Service] Could not extract conversation ID from URL:', url);
      return null;
    }

    return { conversationId: match[1] };
  }

  /**
   * Fetch conversation data from ChatGPT's backend API via the background
   * script (same-origin fetch with the page's session cookies -- the
   * background worker already holds host permission for chatgpt.com).
   */
  static async fetchConversationData(
    request: ChatGPTApiRequest
  ): Promise<ChatGPTApiConversationResponse | null> {
    try {
      const response = await chrome.runtime.sendMessage<
        unknown,
        MessageResponse<ChatGPTApiConversationResponse>
      >({
        type: 'fetch_chatgpt_api_data',
        data: request,
      });

      if (!response.success || !response.data) {
        console.error('[ChatGPT API Service] Failed to fetch data:', response.error);
        return null;
      }

      return response.data;
    } catch (error) {
      console.error('[ChatGPT API Service] Error fetching conversation data:', error);
      return null;
    }
  }

  /**
   * Recover the linear turn order the DOM actually renders.
   *
   * `mapping` holds every node ever created (including abandoned branches
   * from an edited/regenerated turn); `current_node` is the leaf of the
   * branch currently displayed. Walking `parent` from there back to the root
   * -- the same branch the DOM shows -- then reversing is the only way to
   * get a linear order; iterating `mapping` directly would include dead
   * branches and have no defined order at all.
   *
   * Only `user`/`assistant` authored messages are kept -- `system` and
   * `tool` nodes (hidden context, browsing/code-interpreter steps) have no
   * counterpart in the DOM's Q&A pairs and would desync the positional match
   * in `matchPairsToApiMessages`.
   */
  private static linearizeMapping(apiData: ChatGPTApiConversationResponse): ChatGPTApiMessage[] {
    const { mapping, current_node: currentNode } = apiData;
    const path: ChatGPTApiMessage[] = [];
    const visited = new Set<string>();

    let nodeId: string | null | undefined = currentNode;
    while (nodeId && !visited.has(nodeId)) {
      const node: ChatGPTApiNode | undefined = mapping[nodeId];
      if (!node) {
        break;
      }
      visited.add(nodeId);
      const message = node.message;
      if (message && (message.author.role === 'user' || message.author.role === 'assistant')) {
        path.push(message);
      }
      nodeId = node.parent;
    }

    return path.reverse();
  }

  /** A `create_time` (Unix epoch seconds) as a Date, or undefined when absent/unparseable. */
  private static parseApiTime(epochSeconds: number | null | undefined): Date | undefined {
    if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds)) {
      return undefined;
    }
    const date = new Date(epochSeconds * 1000);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  /**
   * Pair up each DOM-scraped Q&A pair with its API message, purely
   * positionally -- same rationale as Claude's service: the DOM exposes no
   * id shared with the API, so the Nth DOM pair is assumed to be the Nth
   * user message and Nth assistant message in the linearized API order. A
   * count mismatch (edited/regenerated turn, tool-only branch) bails out of
   * enrichment entirely rather than guessing a pairing that could attach the
   * wrong time to the wrong turn.
   */
  private static matchPairsToApiMessages(
    conversation: Conversation,
    apiData: ChatGPTApiConversationResponse
  ):
    | {
        matched: {
          userMessage: ChatGPTApiMessage | undefined;
          assistantMessage: ChatGPTApiMessage | undefined;
        }[];
      }
    | { warning: string } {
    const apiMessages = this.linearizeMapping(apiData);
    const userMessages = apiMessages.filter((m) => m.author.role === 'user');
    const assistantMessages = apiMessages.filter((m) => m.author.role === 'assistant');
    const pairCount = conversation.pairs.length;

    if (userMessages.length !== pairCount || assistantMessages.length !== pairCount) {
      const plural = (n: number, noun: string): string =>
        `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
      const warning =
        `Real per-message times were left out of this export: the page shows ${String(pairCount)} ` +
        `Q&A pairs, but ChatGPT reports ${plural(userMessages.length, 'user message')} and ` +
        `${plural(assistantMessages.length, 'assistant message')}, so they could not be matched to ` +
        'the right turn (this happens when a turn was edited or regenerated). Reload the ' +
        'conversation and export again.';
      console.warn(`[ChatGPT API Service] ${warning}`);
      return { warning };
    }

    return {
      matched: conversation.pairs.map((_pair, index) => ({
        userMessage: userMessages[index],
        assistantMessage: assistantMessages[index],
      })),
    };
  }

  /**
   * Enrich a conversation with real per-message timestamps from the backend
   * conversation payload. Never invents a timestamp: a message whose
   * `create_time` is missing/unparseable, or whose pair could not be
   * matched at all, simply keeps `timestamp` unset.
   */
  static enrichConversation(
    conversation: Conversation,
    apiData: ChatGPTApiConversationResponse
  ): ChatGPTEnrichmentResult {
    const match = this.matchPairsToApiMessages(conversation, apiData);

    if ('warning' in match) {
      return { conversation, warning: match.warning };
    }

    const enrichedPairs = conversation.pairs.map((pair, index) => {
      const { userMessage, assistantMessage } = match.matched[index] ?? {};
      const questionTime = this.parseApiTime(userMessage?.create_time);
      const answerTime = this.parseApiTime(assistantMessage?.create_time);

      return {
        ...pair,
        question: {
          ...pair.question,
          ...(questionTime && { timestamp: questionTime }),
        },
        answer: {
          ...pair.answer,
          ...(answerTime && { timestamp: answerTime }),
        },
      };
    });

    return { conversation: { ...conversation, pairs: enrichedPairs } };
  }
}
