# AI Chat Exporter Parser Generator Skill

Claude skill for automatically analyzing chatbot platforms and generating parser implementations.

## Overview

This skill assists developers in creating parsers for new AI chatbot platforms by:
1. Analyzing captured DOM structures
2. Identifying conversation patterns
3. Generating selector configurations
4. Creating parser implementation scaffolding
5. Generating test files

## Prerequisites

Before using this skill:

1. **Capture platform DOM** - Use the DOM capture script to save the platform's HTML
2. **Have a conversation open** - Ensure the captured HTML contains actual messages
3. **Review ADDING_PARSERS.md** - Understand the parser architecture

## Skill Components

This skill consists of two main prompts:

### 1. Analyze Chatbot Platform

**Purpose**: Analyze a captured DOM structure to understand the platform's conversation layout.

**Prompt**: `prompts/analyze-chatbot.md`

**Usage**:
```
@analyze-chatbot.md

Platform: Gemini
DOM Capture: [paste captured HTML or provide file path]
```

**Output**: Detailed analysis including:
- Conversation container selectors
- Message element patterns
- Role identification methods
- Content extraction selectors
- Metadata locations
- Recommended selector set

### 2. Generate Parser Implementation

**Purpose**: Generate complete parser implementation code based on DOM analysis.

**Prompt**: `prompts/generate-parser.md`

**Usage**:
```
@generate-parser.md

Platform: Gemini
Selectors: [from analyze-chatbot output]
```

**Output**: Complete implementation including:
- Selector configuration file
- Parser class implementation
- Test file scaffold
- Theme CSS file
- Integration instructions

## Workflow

### Step-by-Step Usage

#### 1. Capture Platform DOM

```bash
# In browser console on target platform:
captureConversationDOM('gemini');
```

Save output to: `tests/fixtures/dom-snapshots/gemini/real-capture.html`

#### 2. Analyze with Claude

Start a conversation with Claude:

```
I need to add support for the Gemini AI platform to the AI Chat Exporter extension.
I've captured the DOM structure. Can you analyze it?

@analyze-chatbot.md

Platform: Gemini
DOM File: tests/fixtures/dom-snapshots/gemini/real-capture.html
```

Or paste the HTML directly:

```
@analyze-chatbot.md

Platform: Gemini
DOM Capture:
<html>
  [paste captured HTML]
</html>
```

#### 3. Review Analysis

Claude will provide:
- Identified selectors for all required elements
- Notes on platform-specific patterns
- Potential edge cases to consider
- Recommended selector set

Review the analysis and confirm it matches your understanding of the platform.

#### 4. Generate Implementation

```
Great analysis! Now please generate the complete parser implementation.

@generate-parser.md

Platform: Gemini
URL Pattern: gemini.google.com
Platform Name: Gemini
Selectors: [use the selectors from step 3]
```

#### 5. Implement Generated Code

Claude will provide complete files. Create them in your project:

```bash
# Selectors
src/core/parsers/gemini/selectors.ts

# Parser
src/core/parsers/gemini/parser.ts

# Index
src/core/parsers/gemini/index.ts

# Tests
tests/unit/core/parsers/gemini.test.ts

# Theme
src/ui/themes/gemini.css
```

#### 6. Manual Steps

The skill generates most code, but you still need to:

1. **Register parser** in `src/core/parsers/index.ts`:
   ```typescript
   import { GeminiParser } from './gemini/index.js';

   const PARSERS: IParser[] = [
     new ChatGPTParser(),
     new ClaudeParser(),
     new GeminiParser() // Add this
   ];
   ```

2. **Update manifest** in `manifests/manifest.base.json`:
   ```json
   {
     "content_scripts": [{
       "matches": [
         "*://chat.openai.com/*",
         "*://claude.ai/*",
         "*://gemini.google.com/*"  // Add this
       ]
     }]
   }
   ```

3. **Run tests**:
   ```bash
   pnpm test -- gemini
   ```

4. **Iterate** if needed - adjust selectors based on test results

#### 7. Manual Testing

```bash
# Build extension
pnpm build:chrome

# Load in browser and test on actual platform
```

## Prompt Details

### Analyze Chatbot Prompt

**File**: `prompts/analyze-chatbot.md`

**Input Required**:
- **Platform name** (e.g., "Gemini", "Claude")
- **DOM capture** (HTML string or file path)

**Analysis Process**:
1. Identify conversation container
2. Find message elements
3. Determine role identification method
4. Locate content containers
5. Find metadata (title, model)
6. Identify injection points for UI
7. Note timestamps if available
8. Document edge cases

**Output Format**:
```typescript
Recommended Selectors:
{
  conversationContainer: "main.chat",
  messageElement: ".message-item",
  userMessage: ".message-item.user",
  assistantMessage: ".message-item.assistant",
  messageContent: ".message-text",
  conversationTitle: "header h1",
  modelIndicator: ".model-badge",
  buttonContainer: "header .actions",
  timestamp: ".timestamp"
}

Notes:
- Role is identified via class name
- Title is in header h1
- Model name may not always be visible
- Consider dynamic loading of messages
```

### Generate Parser Prompt

**File**: `prompts/generate-parser.md`

**Input Required**:
- **Platform name** (e.g., "Gemini")
- **Platform display name** (e.g., "Gemini")
- **URL pattern** (e.g., "gemini.google.com")
- **Selectors** (from analyze step)

**Generation Process**:
1. Create selector configuration
2. Generate parser class with all required methods
3. Implement platform-specific logic
4. Create test file scaffold
5. Generate theme CSS
6. Provide integration instructions

**Output Format**:
Complete TypeScript files ready to copy-paste into the project.

## Examples

### Example 1: Analyzing Claude

**Input**:
```
@analyze-chatbot.md

Platform: Claude
DOM File: tests/fixtures/dom-snapshots/claude/real-capture.html
```

**Output**:
```
Analysis of Claude Platform DOM Structure
==========================================

Conversation Container:
- Selector: main[role="main"]
- Contains all conversation messages
- Scrollable container

Message Elements:
- Selector: [data-message-id]
- Each message has unique ID
- Sequential in DOM

Role Identification:
- Method: data-role attribute
- User: [data-role="user"]
- Assistant: [data-role="assistant"]

[...continues with full analysis...]

Recommended Selectors:
{
  conversationContainer: 'main[role="main"]',
  messageElement: '[data-message-id]',
  userMessage: '[data-role="user"]',
  assistantMessage: '[data-role="assistant"]',
  messageContent: '.message-content',
  conversationTitle: 'header h1.conversation-title',
  modelIndicator: '.model-badge',
  buttonContainer: 'header .header-actions',
  timestamp: 'time[datetime]'
}
```

### Example 2: Generating Parser

**Input**:
```
@generate-parser.md

Platform: claude
Platform Name: Claude
URL Pattern: claude.ai
Selectors: {
  conversationContainer: 'main[role="main"]',
  messageElement: '[data-message-id]',
  userMessage: '[data-role="user"]',
  assistantMessage: '[data-role="assistant"]',
  messageContent: '.message-content',
  conversationTitle: 'header h1.conversation-title',
  modelIndicator: '.model-badge',
  buttonContainer: 'header .header-actions'
}
```

**Output**: Complete implementation files (see prompts for full output)

## Tips for Best Results

### 1. Provide Quality DOM Captures

- Capture from a real conversation with multiple Q&A pairs
- Include header/navigation elements
- Don't clean up the HTML - provide as-is
- Capture conversations with code blocks if possible

### 2. Be Specific in Analysis Request

Instead of:
> "Analyze this DOM"

Use:
> "Analyze the Gemini platform DOM to identify:
> - How messages are structured
> - How to identify user vs assistant messages
> - Where the conversation title is located
> - Any unique patterns or edge cases"

### 3. Iterate on Selectors

After initial generation:
- Run tests to verify selectors work
- If tests fail, provide specific feedback:
  > "The userMessage selector doesn't work. Looking at the HTML, user messages have class 'user-msg' not 'message-user'"

### 4. Ask for Clarification

If the analysis seems off:
> "I notice you identified .message-content as the content selector, but it seems to also include UI buttons. Can we be more specific?"

### 5. Request Variations

> "Can you also provide an alternative selector set that uses data attributes instead of class names?"

## Troubleshooting

### Analysis seems incorrect

**Problem**: Claude identifies wrong selectors

**Solutions**:
- Provide more context about the platform
- Point out specific message examples in the HTML
- Ask Claude to verify selectors against multiple messages

### Generated code doesn't compile

**Problem**: TypeScript errors in generated code

**Solutions**:
- Check that you're using the correct type imports
- Verify the generated code matches the project's BaseParser interface
- Run `pnpm typecheck` to identify specific errors

### Tests fail

**Problem**: Generated tests don't pass

**Solutions**:
- Verify the DOM fixture matches what the parser expects
- Check that selectors actually exist in the captured HTML
- Update selectors based on test failures
- Add console.log in parser to debug extraction

### Selectors too specific

**Problem**: Selectors work on one conversation but not others

**Solutions**:
- Capture multiple different conversations
- Ask Claude to analyze variations
- Request more general selectors
- Use attribute selectors instead of classes when possible

## Advanced Usage

### Custom Parser Logic

If the platform has unique requirements:

```
@generate-parser.md

Platform: custom-platform
[...standard inputs...]

Additional Requirements:
- Messages load dynamically via infinite scroll
- Need to wait for messages to render
- Handle "thinking" indicator elements
- Strip out reaction emojis from content
```

### Multiple Platform Variations

For platforms with different layouts:

```
@analyze-chatbot.md

Platform: Gemini
Note: Gemini has two layouts - classic and modern.
I'm providing DOM captures from both:

Classic Layout:
[HTML...]

Modern Layout:
[HTML...]

Please provide selectors that work for both.
```

### Testing Edge Cases

Request specific edge case handling:

```
@generate-parser.md

[...standard inputs...]

Please also generate tests for:
- Conversations with only system messages
- Messages with embedded images
- Code blocks with syntax highlighting
- Multi-turn conversations (>100 Q&A pairs)
- Incomplete conversations (user message without response)
```

## Maintenance

### Updating Prompts

If you need to modify the prompts:

1. Edit `prompts/analyze-chatbot.md` or `prompts/generate-parser.md`
2. Test the updated prompt with Claude
3. Document changes in prompt file
4. Update this skill.md if behavior changes

### Adding New Capabilities

To extend the skill:

1. Identify new requirement (e.g., "extract message edit history")
2. Update analyze prompt to look for that pattern
3. Update generate prompt to include implementation
4. Test on existing platforms
5. Document new capability

## Integration with Development Workflow

### VS Code Integration

If using Claude in VS Code with the skill file:

1. Open the parser development file
2. Reference the skill: `@skill.md`
3. Follow workflow interactively

### CLI Usage

For command-line workflows:

```bash
# 1. Capture
node tmp/capture-dom.js > fixtures/platform/capture.html

# 2. Analyze (copy prompt, paste to Claude)
cat .dev/claude-skill/prompts/analyze-chatbot.md

# 3. Generate (copy output to files)
# [Use Claude's output]

# 4. Test
pnpm test -- platform

# 5. Iterate
```

## Contributing

If you improve these prompts or add new capabilities:

1. Test thoroughly on at least 2 different platforms
2. Document changes in the prompt files
3. Update this skill.md
4. Consider submitting a PR

## Future Enhancements

Potential improvements to this skill:

- **Automatic selector validation** - Test generated selectors against DOM
- **Multi-page analysis** - Handle platforms with different conversation views
- **Performance optimization suggestions** - Identify optimal selectors
- **Accessibility checks** - Ensure parsers respect ARIA labels
- **Batch generation** - Generate multiple parsers from a config file

## Resources

- [ADDING_PARSERS.md](.dev/docs/ADDING_PARSERS.md) - Manual parser development guide
- [ARCHITECTURE.md](.dev/docs/ARCHITECTURE.md) - System architecture
- [TESTING_GUIDE.md](.dev/docs/TESTING_GUIDE.md) - Testing strategies
- [BaseParser source](../../src/core/parsers/base-parser.ts) - Base class reference

## Support

For help with this skill:

1. Check [ADDING_PARSERS.md](.dev/docs/ADDING_PARSERS.md) for manual approach
2. Review existing parser implementations (ChatGPT parser)
3. Open GitHub issue with "parser-skill" label
4. Provide your DOM capture and Claude's analysis for debugging

---

**Last Updated**: 2026-01-02
**Skill Version**: 1.0
**Compatible with**: Claude 3.5 Sonnet and above
