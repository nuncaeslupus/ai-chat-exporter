/**
 * Types for Claude API responses
 * Based on the /api/organizations/{org_id}/chat_conversations/{conversation_id} endpoint
 */

/**
 * Artifact input from Claude API
 */
export interface ClaudeApiArtifactInput {
  /** Artifact unique ID */
  id: string;
  /** MIME type (e.g., 'image/svg+xml', 'text/html', 'text/markdown') */
  type: string;
  /** Artifact title */
  title: string;
  /** The actual artifact content (SVG code, React code, markdown, etc.) */
  content: string;
  /** Language identifier (e.g., 'svg', 'react', 'markdown', 'mermaid') */
  language?: string;
  /** Version UUID */
  version_uuid?: string;
}

/**
 * Tool use content from Claude API
 */
export interface ClaudeApiToolUseContent {
  type: 'tool_use';
  /** Tool name (e.g., 'artifacts', 'web_search') */
  name: string;
  /** Tool input data */
  input: ClaudeApiArtifactInput | Record<string, unknown>;
}

/**
 * Text content from Claude API
 */
export interface ClaudeApiTextContent {
  type: 'text';
  text: string;
}

/**
 * Union type for all content types
 */
export type ClaudeApiContent = ClaudeApiToolUseContent | ClaudeApiTextContent;

/**
 * Chat message from Claude API
 */
export interface ClaudeApiChatMessage {
  /** Message UUID */
  uuid: string;
  /** Message text (may be empty if only contains tool use) */
  text: string;
  /** Sender role */
  sender: 'human' | 'assistant';
  /** Message index in conversation */
  index: number;
  /** Created timestamp */
  created_at: string;
  /** Updated timestamp */
  updated_at: string;
  /** Content blocks (text, tool use, etc.) */
  content: ClaudeApiContent[];
  /** Attachments */
  attachments?: unknown[];
}

/**
 * Claude conversation API response
 */
export interface ClaudeApiConversationResponse {
  /** Conversation UUID */
  uuid: string;
  /** Conversation name/title */
  name: string;
  /** Summary */
  summary?: string;
  /** Created timestamp */
  created_at: string;
  /** Updated timestamp */
  updated_at: string;
  /** All chat messages in the conversation */
  chat_messages: ClaudeApiChatMessage[];
  /** Project UUID if conversation is in a project */
  project_uuid?: string | null;
}

/**
 * Request to fetch Claude conversation data via API
 */
export interface ClaudeApiRequest {
  /** Organization ID (extracted from URL) */
  organizationId: string;
  /** Conversation ID (extracted from URL) */
  conversationId: string;
}

/**
 * Type guard to check if content is tool use
 */
export function isToolUseContent(content: ClaudeApiContent): content is ClaudeApiToolUseContent {
  return content.type === 'tool_use';
}

/**
 * Type guard to check if content is artifact tool use
 */
export function isArtifactContent(
  content: ClaudeApiContent
): content is ClaudeApiToolUseContent & { input: ClaudeApiArtifactInput } {
  return (
    isToolUseContent(content) &&
    content.name === 'artifacts' &&
    'content' in content.input &&
    typeof content.input.content === 'string'
  );
}
