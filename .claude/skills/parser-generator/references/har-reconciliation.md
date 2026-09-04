# HAR reconciliation

Load at step 8 of the parser workflow, once a parser produces output and the
question is whether it produced **all** of it.

## What a capture is good for here, and what it is not

A HAR holds every request and response of a session. For this project that means
the conversation as the backend serves it — JSON, before the SPA renders anything.

| Question | HAR |
|---|---|
| Did the parser drop turns / attachments / branches? | **Yes, once the body checks out** — see below |
| What is the endpoint behind a field the DOM never shows? | **Yes** — timestamps, model ids, edit history |
| Which selector went stale? | **No** — see below |

A response body is an independent count only when the capture actually carries it.
Before comparing anything, confirm the transcript entry has a response, that the
response has a body, and that the body decodes as JSON. A recorder can log the request
with a `null` response, drop the body on a streamed or compressed response, or truncate
it past a size cap — and each of those reads downstream as "the API returned fewer
messages", which is the exact conclusion reconciliation exists to make trustworthy.
`analyze_har.py --endpoints` shows which entries carry bodies; if the transcript
response is missing or undecodable, retake the capture rather than reconcile against it.

**A HAR contains no DOM.** claude.ai, chatgpt.com and gemini.google.com assemble
the markup client-side; it never crosses the wire. Selector drift is invisible in
a capture. Step 3's `pnpm probe` is the tool for that, and the two are
complements: the probe says *which selector broke*, the capture says *how much
was lost*.

## Getting a capture

The transcript is behind a login on all three platforms, so it comes from a
person at a browser:

> DevTools → **Network** → reload the conversation → right-click → **Save all as HAR**

`capture_har.py` (in the `har` skill) exists for pages that need no login. It
opens a **fresh context by design** — no cookies, so a capture never carries a
session into a bug report — which is exactly why it cannot fetch a logged-in
conversation. A cloud session additionally cannot reach these hosts at all. Ask
for the export; do not try to take one.

**A HAR from a logged-in session carries live auth.** Before it goes anywhere
public, write a derived capture with `create_har.py`, which redacts **by default**
and drops bodies unless asked to keep them:

```bash
S=.claude/skills/har/scripts
python3 $S/create_har.py --input capture.har --output fixture.har --type xhr
```

Read that flag carefully: **`--secrets` means "do NOT redact"**, not "scan for
secrets". It is an opt-out, and its help says "never for a file you will commit".
`--keep-bodies` is the other one to weigh — the result is then exactly as
sensitive as the original capture.

Say so when handing one on either way. A redactor works from a list of field
names it knows to look for, which is a weaker guarantee than never having
captured the credential — which is why `capture_har.py` uses a fresh context
rather than redacting after the fact.

## The reconciliation

```bash
S=.claude/skills/har/scripts

# 1. What is in here? Run first — it also builds the index the others use.
python3 $S/analyze_har.py --input capture.har --endpoints

# 2. Paste a sentence you can see on the page; get back the request that
#    returned it. This is the one command the toolkit exists for.
python3 $S/query_har.py --input capture.har --response-match "a sentence from the chat"

# 3. Pull that response body out and count the messages in it.
python3 $S/query_har.py --input capture.har --url 'chat_conversations' \
    --mime json --extract-body --output-dir bodies/

# 4. Before the capture leaves your machine: derive a redacted one. This is a
#    SEPARATE artifact from the one you reconciled against, not the same file
#    made safe. Bodies are dropped unless you pass --keep-bodies, so the shared
#    capture is metadata only and cannot answer steps 2-3 — and it must not,
#    because a body here is the whole conversation in plaintext.
python3 $S/create_har.py --input capture.har --url 'chat_conversations' \
    --mime json --output capture.redacted.har
```

So there are two captures, and the distinction is the whole point: `capture.har`
stays on your machine and is what steps 2-3 read, bodies and all;
`capture.redacted.har` is what leaves it. Never reconcile against the redacted one
and never share the private one — and if you ever pass `--keep-bodies`, the output
is exactly as sensitive as the original, so it is a private capture too, whatever
you named it.

The selection flags (`--url`, `--host`, `--mime`, `--type`, `--status`,
`--response-match`, …) come from one shared parser, `add_selection_args()`, so they
are spelled identically in the three scripts that filter — `query_har.py`,
`create_har.py`, `compare_har.py`. (`analyze_har.py`, `capture_har.py`,
`create_repro.py` and `validate_har.py` do not take them; do not assume a flag from
here works there.)

Within that grammar the flags are not interchangeable, which is what the step 2 → 3-4
handoff actually depends on. `--response-match` is evaluated by
`Selection.matches_body()`: it decodes each response and searches its text, which is
how step 2 *discovers* which endpoint carried the sentence you saw. `--url` and
`--mime` are evaluated by `Selection.matches_index()`, against the sidecar index alone
— `--url` against the request URL, `--mime` against the *response* MIME type, and the
capture is never opened. That is cheap, and all steps 3-4 need once you know the
endpoint. So the later steps address the request step 2 found; they do not re-run
its filter. Output is capped at 20 rows / 4096 bytes by default — `--limit 0` removes
both caps, `--output PATH` writes the full result to a file.

Then compare against the parser: open the page, run
`detectParser().parse().conversation.pairs.length` in the console, and put the two
numbers side by side.

**Match, do not multiply.** The two numbers are not the same unit, and the obvious
conversion is wrong: "one pair is two messages" only holds when senders strictly
alternate, and they do not. Real accounts carry conversations with an extra assistant
message, mid-thread or trailing — an audit of one found 8 of 22 — and a fixed 2:1
ratio turns each of those into a phantom gap.

Filter the API side first: the active branch only, current records only (drop the
superseded versions of an edited turn and soft-deleted ones), and user/assistant types
only — system and tool records render no turn. Then walk that filtered array in message
order and pair it the way the parser does — which means copying two rules, not one.
A question left unanswered *mid-thread* becomes a pair with an empty half, so a later
answer cannot slide onto it. A question left pending at the *end* is skipped
entirely: `ClaudeParser.extractQAPairs` and `ChatGPTParser.extractQAPairs` both treat
a trailing question as an in-progress turn, so an API side that counts it will read
one pair high against a parser that is behaving correctly. Apply the same two rules to
the API array before comparing.

Compare *those* pairs to the parser's, and report what failed to match in **both**
directions as its own count — API records with no parsed turn, and parser pairs with
no API record. One number cannot show you both, and a reconciliation that only looks
one way misses a parser inventing a pair as surely as one dropping it.

**A gap that survives normalisation is a bug, not a rounding difference.** Each
missing pair is a turn that silently will not reach any of the six exporters. Chase it
to a specific widget before moving on — the usual causes are a turn shape the parser
returns early on (Gemini's Deep Research turns), a content block with no branch in
`extractQAPairs`, and non-text blocks counted by the API but never rendered into a
pair. A gap that disappears under normalisation was never a defect; record what you
normalised away so the next reconciliation does not rediscover it.

Record the reconciled numbers in the PR, in the matched unit and saying which one, with
both unmatched counts even when they are zero — a missing zero reads as a check nobody
ran. "Parses correctly" is not checkable later; "API 25 active messages -> 12 pairs /
parser 12 pairs / 0 API records unmatched, 0 parser pairs unmatched" is.

## Known task overlap

Two queue tasks are exactly this work, and a capture is the shortest path through
both:

- `lo-08d3` — ChatGPT per-message timestamps via its backend endpoint. The
  timestamps are not in the DOM; the capture names the endpoint and the field.
- `lo-4f4e` — DOM pair count vs API message count divergence (edited turns,
  regenerated responses, deleted messages) misattributing artifacts to the wrong
  pair. The reconciliation above is the measurement that task needs.
