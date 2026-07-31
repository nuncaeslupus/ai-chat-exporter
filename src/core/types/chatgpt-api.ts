/**
 * Types for ChatGPT's backend conversation endpoint.
 *
 * Based on `GET /backend-api/conversation/{conversation_id}` on chatgpt.com.
 * Unlike Claude's API (a flat `chat_messages` array), ChatGPT returns a
 * `mapping` of every node ever created in the conversation (a tree — branches
 * exist for edited/regenerated turns), plus `current_node`, the id of the
 * leaf that is actually rendered. The linear turn order has to be recovered
 * by walking `current_node` back to the root via `parent` (see
 * `chatgpt-api-service.ts`), not by iterating `mapping` directly.
 */

/**
 * `create_time`/`update_time` on both the message and the conversation are
 * Unix epoch **seconds** (may carry a fractional part), not milliseconds and
 * not an ISO string like Claude's API.
 */
export interface ChatGPTApiMessageAuthor {
  role: 'system' | 'user' | 'assistant' | 'tool';
  name?: string | null;
}

export interface ChatGPTApiMessageContent {
  content_type: string;
  parts?: unknown[];
}

export interface ChatGPTApiMessage {
  id: string;
  author: ChatGPTApiMessageAuthor;
  /** `null` on some system/hidden nodes; never fabricated when absent. */
  create_time: number | null;
  content: ChatGPTApiMessageContent;
}

export interface ChatGPTApiNode {
  id: string;
  message?: ChatGPTApiMessage | null;
  parent?: string | null;
  children: string[];
}

export interface ChatGPTApiConversationResponse {
  title?: string;
  create_time?: number;
  update_time?: number;
  mapping: Record<string, ChatGPTApiNode>;
  /** The id of the currently-displayed leaf node — the branch the DOM shows. */
  current_node: string;
}

/** Request to fetch ChatGPT conversation data via the background worker. */
export interface ChatGPTApiRequest {
  conversationId: string;
}
