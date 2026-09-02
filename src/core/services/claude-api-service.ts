/**
 * Service for handling Claude API data
 * Extracts artifact content from Claude API responses
 */

import type {
  ClaudeApiConversationResponse,
  ClaudeApiRequest,
  ClaudeApiChatMessage,
  ClaudeApiTextContent,
  Artifact,
  Conversation,
  Message,
  QAPair,
} from '../types';
import { isArtifactContent } from '../types';
import type { MessageResponse } from '../../shared/messages';
import { getMessage } from '../../shared/i18n';

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
   * Organization id resolved via `resolveOrganizationId` (cookie or API),
   * keyed by document instance for the same session-scoping reason as
   * `organizationIdCache` above: without it, every export/print click in the
   * page session would re-read the cookie and re-hit `GET /api/organizations`.
   */
  private static apiOrganizationIdCache = new WeakMap<Document, string | null>();

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
   *
   * D-25: a live, signed-in capture showed all six of these failing —
   * `__NEXT_DATA__`, `data-organization-id`, the `/api/{uuid}/files/` image
   * pattern, and all three `organization*` regexes are simply absent from the
   * current page, and the localStorage key Claude's own bundle reads is
   * `lastActiveOrg`, not the `lastOrganizationId` step 2 checks below. This is
   * now only the last-resort fallback behind `resolveOrganizationId` (cookie,
   * then API) — kept as-is rather than pruned, in case an older/different
   * Claude UI still populates one of these. Don't re-add strategies here
   * without fresh evidence they fire on a current page.
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
   * `lastActiveOrg=<uuid>`, read straight off `document.cookie`. Verified
   * against the live service: the cookie is present on a signed-in page and
   * its value is a bare uuid, no prefix or encoding. Tried first: it is
   * same-origin, synchronous, needs no extra host permission and no network
   * round trip, and — unlike every other source here — it names the *active*
   * organization outright instead of requiring a pick among several.
   *
   * The value is still URI-decoded and searched for a uuid substring rather
   * than assumed to equal the whole cookie value — cheap insurance so a
   * future format change degrades to the API fallback instead of building a
   * broken conversation-API URL.
   */
  private static readonly UUID_PATTERN =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  private static readOrganizationIdFromCookie(document: Document): string | null {
    const match = /(?:^|;\s*)lastActiveOrg=([^;]+)/.exec(document.cookie);
    if (!match?.[1]) {
      return null;
    }
    const value = decodeURIComponent(match[1]);
    return this.UUID_PATTERN.exec(value)?.[0] ?? null;
  }

  /**
   * Resolve the organization ID from the `lastActiveOrg` cookie, then
   * `GET /api/organizations` (proxied through the background worker, which
   * already holds the claude.ai session cookies for the existing
   * conversation-data fetch), instead of scraping the page. Falls back to the
   * DOM scrape (`findOrganizationId`) when neither resolves — strictly
   * additive, so a page where scraping still works is unaffected.
   *
   * Cached per document/session: a failed resolution (`null`) is cached too,
   * so it costs at most one cookie read + one network call per page session,
   * not one per export.
   *
   * The API response shape is unverified against the live service from this
   * environment. Confirmed live: `uuid` (string) is the conversation-API
   * organization id; `id` is a *number*, not a uuid, and is never used for
   * this. `parseOrganizations` tolerates a bare array or
   * `{ organizations: [...] }` / `{ data: [...] }`.
   */
  private static async resolveOrganizationId(document: Document): Promise<string | null> {
    if (this.apiOrganizationIdCache.has(document)) {
      return this.apiOrganizationIdCache.get(document) ?? null;
    }

    const cookieOrganizationId = this.readOrganizationIdFromCookie(document);
    if (cookieOrganizationId) {
      this.apiOrganizationIdCache.set(document, cookieOrganizationId);
      return cookieOrganizationId;
    }

    let resolved: string | null = null;
    try {
      const response = await chrome.runtime.sendMessage<unknown, MessageResponse<unknown>>({
        type: 'fetch_claude_organizations',
      });

      if (response.success && response.data) {
        resolved = this.pickOrganizationId(this.parseOrganizations(response.data), document);
      }
    } catch (error) {
      console.warn('[Claude API Service] Failed to fetch organizations from API:', error);
    }

    this.apiOrganizationIdCache.set(document, resolved);
    return resolved;
  }

  /** One entry of the (unverified) `GET /api/organizations` response this service reads. */
  private static parseOrganizations(
    data: unknown
  ): { uuid: string; parentOrganizationUuid: string | null }[] {
    const list = Array.isArray(data)
      ? data
      : ((data as { organizations?: unknown; data?: unknown } | null)?.organizations ??
        (data as { organizations?: unknown; data?: unknown } | null)?.data);

    if (!Array.isArray(list)) {
      return [];
    }

    const organizations: { uuid: string; parentOrganizationUuid: string | null }[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      // Confirmed live: `uuid` is the string id this service needs; `id` is a
      // number and would build an invalid API URL, so it is never accepted
      // as a substitute.
      const uuid = (entry as { uuid?: unknown }).uuid;
      if (typeof uuid !== 'string' || !uuid) {
        continue;
      }
      const parentUuid = (entry as { parent_organization_uuid?: unknown }).parent_organization_uuid;
      organizations.push({
        uuid,
        parentOrganizationUuid: typeof parentUuid === 'string' && parentUuid ? parentUuid : null,
      });
    }
    return organizations;
  }

  /**
   * A Team/Enterprise account can genuinely belong to several organizations
   * (confirmed live: this is not a hypothetical edge case), and nothing in
   * the response is a documented "this one is active" flag. So, in order:
   *
   * 1. Prefer whichever candidate the DOM scrape independently agrees with
   *    — a real signal already computed for the fallback path.
   * 2. Otherwise prefer a top-level organization (no `parent_organization_uuid`)
   *    over a sub-organization, on the reasoning that a sub-org is more
   *    likely a team workspace than the account being exported from. This is
   *    unverified — the field's exact semantics have not been confirmed —
   *    and used only when it narrows the field to exactly one candidate.
   * 3. Otherwise fall back to the first entry and say so with a warning,
   *    rather than silently guessing.
   */
  private static pickOrganizationId(
    organizations: { uuid: string; parentOrganizationUuid: string | null }[],
    document: Document
  ): string | null {
    if (organizations.length === 0) {
      return null;
    }
    if (organizations.length === 1) {
      return organizations[0]?.uuid ?? null;
    }

    const domOrganizationId = this.findOrganizationId(document);
    if (domOrganizationId && organizations.some((org) => org.uuid === domOrganizationId)) {
      return domOrganizationId;
    }

    const rootOrganizations = organizations.filter((org) => !org.parentOrganizationUuid);
    if (rootOrganizations.length === 1) {
      return rootOrganizations[0]?.uuid ?? null;
    }

    console.warn(
      '[Claude API Service] Multiple organizations returned and none could be disambiguated; using the first.'
    );
    return organizations[0]?.uuid ?? null;
  }

  /**
   * Extract conversation ID and organization ID from Claude page
   */
  static async extractIdsFromPage(
    url: string,
    document: Document
  ): Promise<ClaudeApiRequest | null> {
    try {
      const urlObj = new URL(url);

      // Example URL: https://claude.ai/chat/00000000-0000-4000-8000-000000000000
      const pathMatch = /\/chat\/([a-f0-9-]+)/.exec(urlObj.pathname);
      if (!pathMatch?.[1]) {
        console.warn('[Claude API Service] Could not extract conversation ID from URL:', url);
        return null;
      }

      const conversationId = pathMatch[1];
      const organizationId =
        (await this.resolveOrganizationId(document)) ?? this.extractOrganizationId(document);

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
    const keyMap: Record<string, string> = {
      image: 'artifactTypeImage',
      react: 'artifactTypeReact',
      document: 'artifactTypeDocument',
      diagram: 'artifactTypeDiagram',
      code: 'artifactTypeCode',
    };

    return getMessage(keyMap[type] ?? 'artifactTypeGeneric');
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
      // Does not claim a specific cause (edited/regenerated/deleted) or that
      // reloading fixes it — neither is reliably true (PAR-2).
      const plural = (n: number, noun: string): string =>
        `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
      const warning =
        `Artifact contents and message times were left out of this export: the page shows ${plural(pairCount, 'Q&A pair')}, ` +
        `but Claude reports ${plural(humanMessages.length, 'human message')} and ` +
        `${plural(assistantMessages.length, 'assistant message')}, so they could not be matched to the right turn.`;
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

  /** Build a `Message` straight from an API chat message — no DOM involved. */
  private static buildMessageFromApi(
    apiMessage: ClaudeApiChatMessage,
    role: 'user' | 'assistant'
  ): Message {
    const timestamp = this.parseApiTime(apiMessage.created_at);
    return {
      id: apiMessage.uuid,
      role,
      content: this.extractApiMessageText(apiMessage),
      ...(timestamp && { timestamp }),
    };
  }

  /**
   * Plain text for an API chat message.
   *
   * `message.text` is the documented field, but a live capture (2026-07-31,
   * a real 12-exchange conversation) showed it empty on **all 24** messages,
   * with the real content in `content[]` blocks instead — so `text` is only a
   * fallback for a payload that does populate it, never the primary source.
   *
   * Block types are handled deliberately, not by default:
   *  - `text` — the turn's actual narration. Included.
   *  - `thinking` — Claude's internal reasoning, collapsed in the UI by
   *    default. Excluded; an export is the conversation, not the reasoning.
   *  - `tool_use` / `tool_result` — a tool invocation and its raw output, not
   *    turn narration. Excluded here; artifact `tool_use` blocks are already
   *    recovered separately via `extractArtifacts`.
   *
   * A turn made entirely of non-text blocks (the live capture had one) has no
   * text, and this returns `''` rather than fabricating placeholder content
   * (the D-18 rule that also governs timestamps).
   */
  private static extractApiMessageText(apiMessage: ClaudeApiChatMessage): string {
    if (apiMessage.text) return apiMessage.text;
    return apiMessage.content
      .filter((block): block is ClaudeApiTextContent => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n');
  }

  /**
   * Build the conversation's pairs directly from the API response, bypassing
   * the DOM scrape entirely (PAR-2).
   *
   * claude.ai renders messages in a windowed virtual list that never holds
   * more than a handful of turns at once, so a long conversation's DOM-scraped
   * pair count can be far short of the true count. When that happens the API
   * — which returns every turn in one response — is the source of truth, not
   * an enrichment layer bolted onto a truncated scrape.
   */
  private static buildPairsFromApiMessages(
    apiData: ClaudeApiConversationResponse,
    artifactsByMessageUuid: Map<string, Artifact[]>
  ): QAPair[] {
    // Walk `chat_messages` in order, pairing each human with the assistant
    // that follows it -- the same structural walk `ClaudeParser.extractQAPairs`
    // does over the DOM, so both paths agree on what a pair is.
    //
    // This used to filter into two lists and zip them positionally, which is
    // only sound when the senders strictly alternate. A live audit
    // (2026-09-03) found 8 of 22 conversations carrying one extra assistant
    // message, and in the worst case it sat mid-conversation --
    // `H A H A [A] H A H A H A`. Zipping that attaches answers 3-5 to the
    // wrong questions and drops the last one, so the caller guarded the zip
    // with `humans.length === assistants.length`. That guard traded silent
    // corruption for silent truncation: an asymmetric conversation kept
    // whatever few turns the virtual-scroll DOM happened to hold (1 of 5 on
    // the audited chat). Walking in order is correct for both shapes, so the
    // guard is gone and the caller simply asks whether this walk found more
    // pairs than the DOM did.
    const pairs: QAPair[] = [];
    let pendingHuman: ClaudeApiChatMessage | null = null;

    const pushPair = (human: ClaudeApiChatMessage, assistant: ClaudeApiChatMessage | null) => {
      const answer = assistant
        ? this.buildMessageFromApi(assistant, 'assistant')
        : { id: `${human.uuid}-unanswered`, role: 'assistant' as const, content: '' };
      const apiArtifacts = assistant ? artifactsByMessageUuid.get(assistant.uuid) : undefined;

      pairs.push({
        id: assistant?.uuid ?? `${human.uuid}-unanswered`,
        index: pairs.length,
        question: this.buildMessageFromApi(human, 'user'),
        answer: apiArtifacts ? { ...answer, metadata: { artifacts: apiArtifacts } } : answer,
        selected: true,
      });
    };

    for (const message of apiData.chat_messages) {
      if (message.sender === 'human') {
        // Two questions in a row: the first never got an answer. Keep it as
        // its own pair rather than letting the next answer slide onto it.
        if (pendingHuman) pushPair(pendingHuman, null);
        pendingHuman = message;
        continue;
      }
      if (message.sender !== 'assistant') continue;
      // An assistant message with no question ahead of it -- a regenerated or
      // branched reply. It belongs to no pair, exactly as in the DOM walk.
      if (!pendingHuman) continue;
      pushPair(pendingHuman, message);
      pendingHuman = null;
    }

    // A trailing unanswered question is an in-progress turn; the DOM walk
    // skips it, so this does too.
    return pairs;
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

    // PAR-2: claude.ai's virtual-scroll DOM can capture far fewer turns than
    // the conversation actually has. Whenever the API's own ordered walk finds
    // more pairs than the DOM scrape did, the DOM count is the truncated one —
    // rebuild every pair from the API instead of discarding the turns the DOM
    // never saw.
    //
    // The old form of this test also required the human and assistant counts
    // to match, because `buildPairsFromApiMessages` zipped the two lists
    // positionally and a mid-conversation extra assistant would misalign them.
    // That walk is now in message order and correct for asymmetric shapes, so
    // the count comparison is the whole condition — which matters, because a
    // live audit (2026-09-03) found 36% of conversations asymmetric, and every
    // one of them was previously excluded from the rebuild and exported
    // truncated.
    const apiPairs = this.buildPairsFromApiMessages(apiData, artifactsByMessageUuid);
    if (apiPairs.length > conversation.pairs.length) {
      return { conversation: { ...conversation, pairs: apiPairs } };
    }

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
