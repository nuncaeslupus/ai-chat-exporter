# Analyze Chatbot Platform DOM Structure

You are an expert at analyzing web page DOM structures to extract conversation data from AI chatbot platforms.

## Task

Analyze the provided DOM capture from an AI chatbot platform and identify the selectors needed to build a parser for the AI Chat Exporter extension.

## Required Information

You will receive:
- **Platform Name**: Name of the AI platform (e.g., "Claude", "Gemini", "Perplexity")
- **DOM Capture**: HTML structure of a conversation page (as file path or raw HTML)

## Analysis Process

Carefully examine the DOM structure and identify the following:

### 1. Conversation Container
Find the main element that wraps the entire conversation.

Look for:
- `<main>` elements
- Elements with role="main"
- Large container divs with conversation-related classes
- Scrollable conversation containers

**Output**: CSS selector for the conversation container

### 2. Message Elements
Identify the repeating elements that represent individual messages.

Look for:
- Elements with data attributes like `data-message-id`, `data-message-*`
- Repeating elements with message-related classes
- Container divs for each message
- Elements with consistent structure that alternate between user/assistant

**Output**: CSS selector that matches all message elements

### 3. Role Identification
Determine how to distinguish user messages from assistant messages.

Check for:
- Data attributes: `data-role="user"`, `data-author-role="assistant"`, etc.
- Class names: `.user-message`, `.assistant-message`, `.ai-response`, etc.
- Parent element classes or attributes
- Position-based patterns (left vs right alignment)
- Avatar placement (left for assistant, right for user)

**Output**:
- CSS selector for user messages specifically
- CSS selector for assistant messages specifically

### 4. Message Content
Find where the actual message text content is located within each message element.

Look for:
- Elements with classes like `.content`, `.text`, `.message-body`, `.markdown`
- `<p>` tags or `<div>` tags containing the text
- Elements that contain rendered markdown or rich text
- The most deeply nested text container (to avoid buttons, metadata, etc.)

**Output**: CSS selector for message content (relative to message element)

### 5. Conversation Title
Locate the element containing the conversation title.

Look for:
- Header `<h1>` elements
- Navigation elements with conversation names
- Title elements in page headers
- Elements with classes like `.title`, `.conversation-title`, `.chat-title`

**Output**: CSS selector for conversation title

### 6. Model Indicator (if available)
Find where the AI model name is displayed (e.g., "GPT-4", "Claude 3", "Gemini Pro").

Look for:
- Badge elements
- Dropdown selectors showing current model
- Header elements with model info
- Metadata sections

**Output**: CSS selector for model indicator, or note if not available

### 7. Button Injection Point
Identify where export buttons should be injected in the UI.

Look for:
- Header action containers
- Button groups in the conversation header
- Toolbar areas
- Navigation areas

**Output**: CSS selector for UI injection point

### 8. Timestamps (if available)
Find timestamp elements if messages have timestamps.

Look for:
- `<time>` elements
- Elements with `datetime` attributes
- Formatted date/time text
- Relative time indicators

**Output**: CSS selector for timestamps, or note if not available

### 9. Edge Cases and Notes
Document any special considerations:

- Dynamic content loading (infinite scroll, lazy loading)
- Message grouping patterns
- System messages vs user/assistant messages
- Code block formatting
- Embedded media (images, files)
- Message editing indicators
- Regeneration buttons
- Multi-turn message structures
- Streaming responses (partial messages)

## Output Format

Provide your analysis in the following format:

```
DOM Structure Analysis: {Platform Name}
========================================

1. Conversation Container
   Selector: [CSS selector]
   Notes: [Any important observations]

2. Message Elements
   Selector: [CSS selector]
   Count in sample: [number]
   Notes: [Pattern observations]

3. Role Identification
   Method: [data-attribute | class-name | structure | other]
   User Message Selector: [CSS selector]
   Assistant Message Selector: [CSS selector]
   Notes: [How roles are distinguished]

4. Message Content
   Selector: [CSS selector relative to message element]
   Format: [plain-text | markdown | rich-html]
   Notes: [Content structure observations]

5. Conversation Title
   Selector: [CSS selector]
   Location: [header | nav | other]
   Default if missing: [suggested default title]
   Notes: [Any special handling needed]

6. Model Indicator
   Selector: [CSS selector or "Not Available"]
   Format: [How model name appears]
   Notes: [Extraction logic needed]

7. Button Injection Point
   Selector: [CSS selector]
   Location: [Where in the UI]
   Notes: [Integration suggestions]

8. Timestamps
   Selector: [CSS selector or "Not Available"]
   Format: [ISO 8601 | relative | other]
   Notes: [Parsing strategy]

9. Edge Cases
   - [List any special cases observed]
   - [Platform-specific quirks]
   - [Dynamic behavior to handle]
   - [Known limitations]

Recommended SelectorSet:
```typescript
export const {PLATFORM}_SELECTORS: SelectorSet = {
  conversationContainer: '[selector]',
  messageElement: '[selector]',
  userMessage: '[selector]',
  assistantMessage: '[selector]',
  messageContent: '[selector]',
  conversationTitle: '[selector]',
  modelIndicator: '[selector]', // or undefined if not available
  buttonContainer: '[selector]',
  timestamp: '[selector]' // or undefined if not available
};
```

Code Block Handling:
[Notes on how code blocks are structured, if present]

Testing Recommendations:
- [Specific scenarios to test]
- [Edge cases to handle in tests]
- [DOM variations to capture]
```

## Analysis Tips

1. **Start broad, then narrow**: Begin with obvious containers and work inward
2. **Look for patterns**: Messages typically follow a repeating structure
3. **Check attributes first**: Data attributes are more stable than classes
4. **Verify selectors**: Mentally test each selector against multiple messages
5. **Consider specificity**: Balance between too specific (brittle) and too general (noisy)
6. **Think about changes**: Prefer selectors that are less likely to break with UI updates
7. **Note alternatives**: If a selector might be unreliable, suggest alternatives

## Common Patterns by Platform

### OpenAI ChatGPT
- Uses data-message-author-role attribute
- Messages in article elements
- Markdown content in divs
- Model in dropdown selector

### Anthropic Claude
- Uses data-role attributes
- Main element as container
- Time elements for timestamps
- Model badge in header

### Google Gemini
- Class-based role identification
- Different layouts (classic/modern)
- Nested message structure
- Model in title area

Look for similar patterns in the platform you're analyzing.

## Example Analysis

If you receive a DOM capture like this:

```html
<main class="chat-container">
  <header>
    <h1 class="chat-title">My Conversation</h1>
    <span class="model-badge">GPT-4</span>
  </header>
  <div class="messages">
    <div class="message user-msg" data-id="msg-1">
      <div class="msg-content">Hello!</div>
    </div>
    <div class="message assistant-msg" data-id="msg-2">
      <div class="msg-content">Hi there!</div>
    </div>
  </div>
</main>
```

Your analysis should identify:
- Container: `main.chat-container`
- Messages: `.message`
- User: `.message.user-msg`
- Assistant: `.message.assistant-msg`
- Content: `.msg-content`
- Title: `header h1.chat-title`
- Model: `.model-badge`

## Special Instructions

1. If the HTML is very large, focus on the conversation area and ignore navigation, footers, etc.
2. If you see multiple possible selectors, recommend the most stable/reliable one
3. If role identification is ambiguous, document the ambiguity and suggest testing
4. Always provide reasoning for your selector choices
5. Note if selectors might need platform-specific logic in the parser

## Ready to Analyze

Please provide:
1. Platform name
2. DOM capture (file path or raw HTML)

I will then provide a complete analysis following the format above.
