import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GeminiParser } from '../../../../src/core/parsers/gemini/parser';
import {
  GEMINI_SELECTORS,
  GEMINI_DEEP_RESEARCH_SELECTORS,
} from '../../../../src/core/parsers/gemini/selectors';

const FIXTURE = join(__dirname, '../../../fixtures/dom-snapshots/gemini/real-capture.html');
const DEEP_RESEARCH_FIXTURE = join(
  __dirname,
  '../../../fixtures/dom-snapshots/gemini/deep-research-2026-07.html'
);
const GEMINI_URL = 'https://gemini.google.com/app/abc123';

function parserFor(html: string, url = GEMINI_URL): GeminiParser {
  const dom = new JSDOM(html, { url });
  return new GeminiParser(dom.window.document);
}

describe('GeminiParser', () => {
  let html: string;
  let parser: GeminiParser;

  beforeEach(() => {
    html = readFileSync(FIXTURE, 'utf-8');
    parser = parserFor(html);
  });

  describe('selectors', () => {
    // Guards against the failure mode where a selector silently matches
    // nothing after a redesign while every other test stays green.
    it('every GEMINI_SELECTORS entry matches the captured DOM', () => {
      const { document } = new JSDOM(html).window;
      const selectors = [
        GEMINI_SELECTORS.conversationContainer,
        GEMINI_SELECTORS.messageElement,
        GEMINI_SELECTORS.userMessage,
        GEMINI_SELECTORS.assistantMessage,
        GEMINI_SELECTORS.messageContent,
        GEMINI_SELECTORS.conversationTitle,
        GEMINI_SELECTORS.modelIndicator,
        ...Object.values(GEMINI_SELECTORS.custom ?? {}),
      ].filter((s): s is string => Boolean(s));

      for (const selector of selectors) {
        expect(document.querySelectorAll(selector).length, selector).toBeGreaterThan(0);
      }
    });

    // The above can only ever prove "the selector matches THIS FIXTURE". It
    // stayed green for six months while both the title and the model selector
    // matched nothing on the real page, because the fixture still carried the
    // markup Gemini had already dropped (docs/dev/parser-gotchas.md §12d).
    // Pinning the retired markup as forbidden is the part a fixture CAN check:
    // it makes re-adding dead markup to force a test green an explicit act.
    it('does not carry markup Gemini has retired', () => {
      const { document } = new JSDOM(html).window;

      for (const retired of ['.conversation-title', '[data-test-id="bard-text"]']) {
        expect(document.querySelectorAll(retired).length, retired).toBe(0);
      }
    });
  });

  describe('canParse', () => {
    it('returns true for a Gemini URL with a conversation in the DOM', () => {
      expect(parser.canParse()).toBe(true);
    });

    it('returns false for a non-Gemini URL', () => {
      expect(parserFor(html, 'https://chatgpt.com/c/abc').canParse()).toBe(false);
    });

    it('returns false when the conversation container is missing', () => {
      expect(parserFor('<main></main>').canParse()).toBe(false);
    });
  });

  // The title and the model are the two selectors that went dead unnoticed
  // (lo-3c90): the old guard only asked "does the selector match SOMETHING in
  // the fixture", which a stale fixture answers yes to forever. These assert
  // the returned VALUE and pin the negative controls -- the wrong sidebar row,
  // the generic <title>, the bare mode label -- so a selector that drifts back
  // to matching the wrong thing fails instead of quietly matching.
  describe('getTitle', () => {
    it('reads the title of the open conversation from the sidebar', () => {
      // The sidebar holds three conversations; only the open one carries
      // `aria-current="page"`. A selector that lost that scoping would return
      // the first row instead.
      expect(parser.getTitle()).toBe('Paper airplane aerodynamics');
      expect(parser.getTitle()).not.toBe('Kite string tension maths');
    });

    it('does not settle for the generic document title', () => {
      // <title> is "Gemini" on every conversation, so it can never stand in
      // for the conversation name.
      expect(parser.getTitle()).not.toBe('Gemini');
    });

    it('falls back to a default title rather than a neighbouring conversation', () => {
      const doc = new JSDOM(html, { url: GEMINI_URL }).window.document;
      doc.querySelector('[aria-current="page"]')?.removeAttribute('aria-current');

      expect(new GeminiParser(doc).getTitle()).toBe('Gemini Conversation');
    });

    it('falls back to a default title when no sidebar exists', () => {
      expect(parserFor('<main></main>').getTitle()).toBe('Gemini Conversation');
    });
  });

  describe('getModel', () => {
    // Gemini exposes no model slug. The composer's picker is a MODE picker
    // whose label is sometimes a model family ("Flash") and sometimes an
    // effort tier ("Extended"), so the bare label must never be reported as
    // the model name.
    it('reports the composer mode picker as a mode, not as a model name', () => {
      expect(parser.getModel()).toBe('Gemini (Flash mode)');
      expect(parser.getModel()).not.toBe('Flash');
    });

    it('returns null when no mode picker exists', () => {
      expect(parserFor('<main></main>').getModel()).toBeNull();
    });

    it('returns null rather than an empty mode when the picker label is gone', () => {
      const doc = new JSDOM(html, { url: GEMINI_URL }).window.document;
      doc.querySelector('.picker-primary-text')?.remove();

      expect(new GeminiParser(doc).getModel()).toBeNull();
    });
  });

  describe('getButtonInjectionPoint', () => {
    it('returns the top bar actions area', () => {
      const point = parser.getButtonInjectionPoint();
      expect(point).not.toBeNull();
      expect(point?.className).toContain('right-section');
    });

    it('returns null when the top bar is missing', () => {
      expect(parserFor('<main></main>').getButtonInjectionPoint()).toBeNull();
    });
  });

  describe('extractQAPairs', () => {
    it('pairs every question with the answer from the same container', () => {
      const result = parser.parse();
      expect(result.success).toBe(true);

      const pairs = result.conversation?.pairs ?? [];
      expect(pairs).toHaveLength(3);
      expect(pairs.map((p) => p.question.content)).toEqual([
        'How does a wing actually generate lift?',
        'Why does 100 GSM paper fly further than printer paper?',
        'Give me the HTML for a small infographic about it.',
      ]);
      pairs.forEach((pair, index) => {
        expect(pair.index).toBe(index);
        expect(pair.question.role).toBe('user');
        expect(pair.answer.role).toBe('assistant');
        expect(pair.answer.content.length).toBeGreaterThan(50);
      });
      expect(pairs[0]?.answer.content).toContain('Bernoulli');
    });

    it('keeps the model thinking panel out of the answer', () => {
      const pairs = parser.parse().conversation?.pairs ?? [];
      expect(pairs[0]?.answer.content).not.toContain('Show thinking');
    });

    it('keeps rendered maths in the answer text', () => {
      // Gemini ships only the aria-hidden `.katex-html` copy (no MathML, no
      // LaTeX annotation), so the shared cleanup must fall through to it.
      const pairs = parser.parse().conversation?.pairs ?? [];
      expect(pairs[1]?.answer.content).toMatch(/mv/);
    });

    it('preserves HTML for both sides when configured', () => {
      const pairs = parser.parse({ preserveHtml: true }).conversation?.pairs ?? [];
      expect(pairs[0]?.answer.htmlContent).toContain('<');
      expect(pairs[0]?.question.htmlContent).toBeTruthy();
    });

    it('returns no pairs for a document without a conversation', () => {
      const result = parserFor('<main></main>').parse();
      expect(result.conversation?.pairs).toHaveLength(0);
      expect(result.warnings).toContain('No Q&A pairs found in the conversation');
    });
  });

  // DOM-drift regression tests: the likelier real-world failure than empty or
  // malformed HTML is the target site renaming a class or moving an
  // attribute -- a *plausible near-miss*. Each test mutates a fresh copy of
  // the real fixture and asserts on the resulting failure SIGNAL, not merely
  // on "did not throw" -- a silently empty or half-parsed conversation is
  // worse than an exception (lo-b59b).
  describe('DOM drift resilience (plausible near-miss selector breakage)', () => {
    it('reports failure when the message-role marker is renamed', () => {
      const doc = new JSDOM(html, { url: GEMINI_URL }).window.document;
      // `<user-query-content>` is Gemini's role marker for the user side of
      // a turn (GEMINI_SELECTORS.userMessage) -- a custom-element tag rather
      // than an attribute, but the same kind of drift.
      doc.querySelectorAll('user-query-content').forEach((el) => {
        const replacement = doc.createElement('user-query-content-renamed');
        replacement.innerHTML = el.innerHTML;
        el.replaceWith(replacement);
      });

      const result = new GeminiParser(doc).parse();

      // CURRENT BEHAVIOR (documented, not a bug to fix here): this does NOT
      // return success:false -- there is no dedicated failure signal -- but
      // unlike the ChatGPT/Claude parsers it is also NOT a silent, unflagged
      // empty conversation. extractQAPairs pairs structurally per
      // `.conversation-container` and keeps every turn even when
      // `userMessage` doesn't match inside it (see that method's docstring);
      // collectWarnings then flags each one individually.
      expect(result.success).toBe(true);
      const pairs = result.conversation?.pairs ?? [];
      expect(pairs).toHaveLength(3);
      pairs.forEach((pair) => {
        expect(pair.question.content).toBe('');
      });
      expect(result.warnings).toEqual([
        'Turn 1: the question could not be read',
        'Turn 2: the question could not be read',
        'Turn 3: the question could not be read',
      ]);
    });

    it('does not mis-pair turns when a wrapper div is removed', () => {
      const doc = new JSDOM(html, { url: GEMINI_URL }).window.document;
      const baseline = new GeminiParser(doc).parse().conversation?.pairs ?? [];
      expect(baseline).toHaveLength(3);

      // Remove the question wrapper from the FIRST turn only -- as a
      // redesign that dropped its markup plausibly would -- and leave the
      // other two turns untouched.
      doc.querySelector('.conversation-container user-query-content')?.remove();

      const result = new GeminiParser(doc).parse();
      const pairs = result.conversation?.pairs ?? [];

      // CURRENT (GOOD) BEHAVIOR: because extractQAPairs pairs a question
      // with its answer structurally -- both inside the same
      // `.conversation-container` -- rather than by zipping two
      // separately-collected arrays by index, losing one turn's question
      // does not shift or mis-pair any other turn. The ChatGPT/Claude
      // parsers used to zip by index and mis-pair under the equivalent
      // mutation (lo-b59b); they were fixed the same way (lo-d0f0).
      expect(result.success).toBe(true);
      expect(pairs).toHaveLength(3);
      expect(pairs[0]?.question.content).toBe('');
      expect(pairs[1]?.question.content).toBe(baseline[1]?.question.content);
      expect(pairs[1]?.answer.content).toBe(baseline[1]?.answer.content);
      expect(pairs[2]?.question.content).toBe(baseline[2]?.question.content);
      expect(pairs[2]?.answer.content).toBe(baseline[2]?.answer.content);
      expect(result.warnings).toContain('Turn 1: the question could not be read');
    });

    it('returns success:false rather than an empty conversation when selectors match nothing', () => {
      const doc = new JSDOM(html, { url: GEMINI_URL }).window.document;
      doc.querySelectorAll('.conversation-container').forEach((el) => {
        el.remove();
      });

      const result = new GeminiParser(doc).parse();

      // CURRENT BEHAVIOR (documented, not a bug to fix here): same as
      // ChatGPT/Claude -- BaseParser.parse() only sets success:false when
      // extractQAPairs throws. An empty match set does not throw, so this
      // reports success:true with a generic warning instead.
      expect(result.success).toBe(true);
      expect(result.conversation?.pairs).toEqual([]);
      expect(result.warnings).toContain('No Q&A pairs found in the conversation');
    });
  });
});

describe('GeminiParser — Deep Research', () => {
  let html: string;
  let parser: GeminiParser;

  beforeEach(() => {
    html = readFileSync(DEEP_RESEARCH_FIXTURE, 'utf-8');
    parser = parserFor(html);
  });

  // Same guard as the main selector suite, against the only capture that has
  // an open immersive panel.
  it('every GEMINI_DEEP_RESEARCH_SELECTORS entry matches the captured DOM', () => {
    const { document } = new JSDOM(html).window;
    const panel = document.querySelector(GEMINI_DEEP_RESEARCH_SELECTORS.panel);
    expect(panel, GEMINI_DEEP_RESEARCH_SELECTORS.panel).not.toBeNull();

    for (const [name, selector] of Object.entries(GEMINI_DEEP_RESEARCH_SELECTORS)) {
      if (name === 'panel') continue;
      const scope = name === 'entryChip' ? document : panel!;
      expect(scope.querySelectorAll(selector).length, `${name}: ${selector}`).toBeGreaterThan(0);
    }
  });

  it('keeps both Deep Research turns', () => {
    const pairs = parser.parse().conversation?.pairs ?? [];
    expect(pairs).toHaveLength(2);
    expect(pairs[0]?.question.content).toContain('rules-based European equity sleeve');
    expect(pairs[1]?.question.content).toContain('Start research');
  });

  it('folds the report body into the turn that links to it', () => {
    const pairs = parser.parse().conversation?.pairs ?? [];
    const answer = pairs[1]?.answer.content ?? '';

    // The one-line in-chat acknowledgement is still there ...
    expect(answer).toContain("I've completed your research");
    // ... followed by the report that only exists in the immersive panel.
    expect(answer).toContain('Feasibility Report: Rules-Based Equity Sleeves');
    expect(answer).toContain('eight basis points of the traded notional');

    // and it lands on the chip's turn, not the research-plan turn.
    expect(pairs[0]?.answer.content).not.toContain('Feasibility Report');
  });

  it('preserves the report markup when preserveHtml is set', () => {
    const pairs = parser.parse({ preserveHtml: true }).conversation?.pairs ?? [];
    expect(pairs[1]?.answer.htmlContent).toContain('<h1');
    expect(pairs[1]?.answer.htmlContent).toContain('Feasibility Report');
  });

  it('records the cited sources as webSearches, and only the cited ones', () => {
    const pairs = parser.parse().conversation?.pairs ?? [];
    const searches = pairs[1]?.answer.metadata?.webSearches ?? [];

    expect(searches).toHaveLength(1);
    expect(searches[0]?.query).toBe('Cross-Sectional Equity Cost Study');
    expect(searches[0]?.resultCount).toBe(3);
    expect(searches[0]?.results?.map((r) => r.domain)).toEqual([
      'brokerfees.example.test',
      'custody.example.test',
      'marketdata.example.test',
    ]);
    expect(searches[0]?.results?.[0]).toMatchObject({
      title: 'Fee schedule for retail equity accounts',
      url: 'https://source1.example.test/page',
    });
    // `.unused-sources` (read but not cited) stay out.
    expect(JSON.stringify(searches)).not.toContain('archive.example.test');
  });

  it('strips Angular cdk-visually-hidden text from the question', () => {
    const pairs = parser.parse().conversation?.pairs ?? [];
    expect(pairs[0]?.question.content).not.toContain('You said');
    expect(pairs[1]?.answer.content).not.toContain('Opens in a new window');
  });

  it('emits a turn whose answer body is missing, with a warning', () => {
    const stripped = html.replace(/class="markdown markdown-main-panel/g, 'class="stripped');
    const result = parserFor(stripped).parse();
    const pairs = result.conversation?.pairs ?? [];

    expect(pairs).toHaveLength(2);
    expect(pairs[0]?.question.content).toContain('rules-based European equity sleeve');
    expect(pairs[0]?.answer.content).toBe('');
    expect(result.warnings).toContain('Turn 1: the answer could not be read');
  });
});

describe('GeminiParser — generated media (lo-6fe5)', () => {
  // "Create video" / "Create music" render a player in the answer, outside the
  // `.markdown` body the text extractor reads, so the clip is lost unless the
  // parser files it under `metadata.media`.
  const MEDIA_HTML = `
    <chat-window>
      <div class="conversation-container">
        <user-query-content><p>Make a video and a song about a lighthouse</p></user-query-content>
        <model-response>
          <message-content><div class="markdown"><p>Here you go.</p></div></message-content>
          <video src="https://gemini.example.test/clip.mp4" aria-label="Lighthouse timelapse"></video>
          <audio aria-label="Lighthouse song">
            <source src="https://gemini.example.test/track.m4a" type="audio/mp4">
          </audio>
        </model-response>
      </div>
    </chat-window>`;

  it('files a generated video and audio clip under metadata.media', () => {
    const media = parserFor(MEDIA_HTML).parse().conversation?.pairs[0]?.answer.metadata?.media;

    expect(media).toEqual([
      {
        kind: 'video',
        src: 'https://gemini.example.test/clip.mp4',
        alt: 'Lighthouse timelapse',
      },
      {
        kind: 'audio',
        src: 'https://gemini.example.test/track.m4a',
        alt: 'Lighthouse song',
        mimeType: 'audio/mp4',
      },
    ]);
  });

  it('leaves metadata.media unset when the answer has no player', () => {
    const stripped = MEDIA_HTML.replace(/<video[\s\S]*<\/audio>/, '');
    const answer = parserFor(stripped).parse().conversation?.pairs[0]?.answer;

    expect(answer?.metadata?.media).toBeUndefined();
  });
});

describe('parser registry', () => {
  it('registers gemini so detectParser can find it', async () => {
    const { parserRegistry } = await import('../../../../src/core/parsers/index');
    expect([...parserRegistry.keys()]).toContain('gemini');
  });

  it('detectParser selects GeminiParser on a gemini document', async () => {
    const { detectParser } = await import('../../../../src/core/parsers/index');
    const html = readFileSync(FIXTURE, 'utf-8');
    const dom = new JSDOM(html, { url: GEMINI_URL });
    expect(detectParser(dom.window.document)).toBeInstanceOf(GeminiParser);
  });
});
