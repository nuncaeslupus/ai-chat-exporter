---
name: har
description: Use whenever a HAR capture has to be recorded, read, searched, filtered or turned into a scraper — which request returned a string seen on the page, which parameter pages the results, what to send to reproduce it. Triggers — "I have a HAR", "which request returns this", "capture what this page loads". Do NOT use to parse a JSON/HTML file with no capture around it.
argument-hint: "--input capture.har"
user-invocable: true
metadata:
  section: extract
  type: tool
---

# HAR analysis

CANARY: har-loaded-2026-08-30-7f3a91c4-2b6d4e8a1c9f0b73

A browser capture holds the complete network truth of a session: every request,
its headers and parameters, every response body. It is also 5–500 MB of JSON, so
the one thing nobody can do with it is read it. The few hundred bytes that
matter — which endpoint returns the data, which parameter pages it, which header
authenticates it — are reachable only through a script.

## When to load

Load this skill when:

- A `.har` file has to be searched, summarised, filtered or reduced.
- The question is "which request returned this?" — a string seen on a page, and
  no idea which of 400 requests produced it.
- A scraper is being built from a captured session, and what is needed is the
  endpoint, its parameters, and a working request.
- A capture has to be made small or safe enough to commit or hand over.
- There is no capture yet and nobody at a browser to take one.

Do not load it to parse a JSON/HTML file that did not come out of a capture.

## When there is no capture yet

A person at a browser saves one from devtools. A session has nobody there, so:

```bash
uv run --with playwright python3 "${CLAUDE_SKILL_DIR}/scripts/capture_har.py" \
    --url https://jobs.example.com/search --output capture.har
```

`uv run --with` keeps playwright out of the install — nothing else here needs
it. The script uses the browser already on the machine, records into a **fresh
context** so no cookie or login of the operator's ends up in a file that gets
attached to a bug report, and writes the HAR even when navigation times out,
which is when a capture is most worth having. `--headed` to watch it,
`--wait S` for XHR that fires late.

Read `references/capturing.md` before changing any of that: each of its four
rules is there because the obvious alternative silently produces no file, a
partial one, or one carrying the operator's session.

## The two-command answer

Almost every session here is the same shape. Paste a string that was visible on
the page; get back the request that returned it, and its shape.

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/query_har.py" --input capture.har \
    --response-match "Senior Rust Engineer"
python3 "${CLAUDE_SKILL_DIR}/scripts/query_har.py" --input capture.har --show 4 --schema
```

The first names the entry. The second prints the body's *shape* — keys, types,
array lengths — which is usually the actual question and is often 100× smaller
than the body.

Before either, when the capture is unfamiliar:

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/analyze_har.py" --input capture.har
```

The overview's XHR/JSON count is the number that decides whether the next hour
is spent on endpoints or on rendered HTML.

## The scripts

| Script | What it answers |
|---|---|
| `query_har.py` | Which entries match, what one of them contains, and getting bodies out |
| `analyze_har.py` | What is in here, and how to iterate it. `--index` builds the sidecar every other command reads |
| `validate_har.py` | Is this capture usable, and what did its exporter leave out |
| `create_repro.py` | One entry to a runnable `curl` or Python `requests` snippet |
| `create_har.py` | A derived capture: filtered, redacted, bodies dropped — small enough to commit |
| `compare_har.py` | What changed between two captures — the scraper's early-warning test |
| `capture_har.py` | Record a capture in the first place, when nobody is at the browser |

Every script that reads a capture takes `--input`, accepts `--json` for
chaining, shares one selection grammar, and caps its own output. Run `--help`
for every flag. (`capture_har.py` is the one that writes a capture rather than
reading one, so only `--output` is shared with it.)

## From endpoint to scraper

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/create_repro.py" --input capture.har --id 4 --format curl
python3 "${CLAUDE_SKILL_DIR}/scripts/create_repro.py" --input capture.har --id 4 --format python
```

The handoff from "found the endpoint" to "have a scraper", and the point where a
HAR stops being a diagnostic artifact. Credentials are redacted by default;
`--secrets` emits the real ones, which is what reproducing a login needs.

**Every emitted value is escaped for its destination.** A capture is untrusted
input and this output gets pasted into a shell, so shell arguments are quoted
uniformly, Python values go through `repr()`, and bodies use `--data-raw` — a
body beginning with `@` stays inline data instead of becoming a local-file read.

## A capture small enough to commit

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/create_har.py" --input capture.har \
    --type xhr --output fixture.har
```

Bodies are **dropped by default**: redaction covers named fields, and a response
body is unbounded text that may carry a credential anywhere in it, so a derived
HAR that kept them would look sanitised without being it. `--keep-bodies` opts
back in and says in its own output that the result is as sensitive as the
capture. An `--output` that names a capture the command is reading is refused
before anything is opened — in every script, not just this one. A HAR records
one moment on a live site and re-recording will not reproduce it, so it is not
a file to overwrite with a report on a mistyped extension.

## Reading the capture as a whole

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/analyze_har.py" --input capture.har --endpoints
```

| Mode | Output |
|---|---|
| *(default)* | Overview: entries, hosts, types, statuses, and the XHR/JSON count |
| `--endpoints` | **The pagination finder.** URL paths collapsed to templates, with which parameters vary and over what range |
| `--headers` | Request headers by host, split into constant across requests (candidate auth) versus varying |
| `--cookies` | Cookies sent and set, by domain, with their flags. Values redacted, names and flags kept |
| `--errors` | Every non-2xx, with the body snippet that usually says how to fix the request |
| `--stats FIELD` | Histogram over `status`, `host`, `mime`, `type`, `method`, `size`, `time` |
| `--redirects` | Redirect chains, collapsed |
| `--slowest` / `--largest` | Top-N by time or body size |
| `--websockets` | Per-socket frame counts, direction, sizes and first frames |

`--endpoints` is the one to run second. Collapsing `?page=1&loc=NY`,
`?page=2&loc=NY`, `?page=3&loc=NY` into one row that says `page` varies over
1–3 while `loc` is constant is the difference between reading forty URLs and
reading how to iterate the site.

`--headers` is how the auth header is found: a header sent identically on every
request to a host is a candidate credential, one that changes per request is
not. It keeps working under redaction because redacted values carry a salted
fingerprint rather than a bare marker.

## Selecting entries

One grammar, shared by every command that picks entries. All of it composes as
AND, and `--invert` negates the whole selection.

```bash
--url REGEX  --host REGEX  --method GET  --status 2xx|404|400-499  --mime REGEX
--type xhr   --min-size N  --max-size N  --slower-than MS  --page ID
--param NAME[=REGEX]       --has-header NAME[=REGEX]
--body-match REGEX         --response-match REGEX
--since ISO  --until ISO   --from-cache | --no-cache | --unknown-cache
```

Two of those deserve their own note.

**`--response-match` is the one to reach for first.** It is the operation this
toolkit exists for: a string seen on the page in, the request that returned it
out.

**The cache flags are three, not two.** `_fromCache` is `true`, `false`, or
*the exporter never recorded it*, so `--no-cache` selects `false` **only** and
`--unknown-cache` is its own flag. Folding the third state into `false` would
make the same command mean different things on a Chrome capture and a
Playwright one, silently.

## Getting data out

| Flag | Effect |
|---|---|
| `--show IDX` | One entry in full: request line, headers, query, bodies, real values |
| `--schema` | A JSON body's shape — keys, types, array lengths — instead of its content |
| `--json-path a.b[*].c` | Pull values out of a JSON body |
| `--css h1` / `--xpath ./item` | Pull from an HTML or XML body. A selector this does not support is refused **by name**, never silently unmatched |
| `--extract-body --output-dir DIR` | Decode and write every matching body to a file |

## Build the index first

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/analyze_har.py" --input capture.har --index
```

It writes `capture.har.index.jsonl` beside the capture: one line per entry, no
bodies. Every filter, statistic and listing then runs against that alone, which
is what keeps a query on a 200 MB capture sub-second. It is rebuilt
automatically when the capture changes, and belongs in `.gitignore`.

Add `--verify-offsets` when a body ever looks like it belongs to a different
entry: it re-parses every entry from its recorded byte offset and reports any
that disagree.

## Two rules that shape every output

**Small by default, complete on request.** Every command caps its output at 20
rows and 4096 bytes, whichever binds first, and says which one did the dropping.
`--limit 0` removes both caps; `--output PATH` writes the complete result to a
file in full fidelity. A reduced answer that cannot be expanded is a tool that
decides what may be asked. `--json` stays parseable under the cap by dropping
whole entries from a fixed envelope, never by cutting bytes mid-structure.

**Safe by default.** Anything written to disk — the index sidecar included —
has its auth headers, cookies and token-shaped parameters replaced with
`<redacted:ab12cd34>`, where the suffix is a salted fingerprint: equal values
stay equal so header analysis still works, and nothing about the original is
recoverable. URL userinfo and fragments are removed outright, because an OAuth
implicit flow puts a live token in a fragment and no name-matching rule would
ever look there. `--show` prints real values — that is an operator reading their
own capture — and a value pattern against a redacted header needs `--secrets`,
because the index cannot answer it. **Extracted response bodies are outside this
guarantee:** a body is unbounded text that may carry a credential anywhere in
it, so an extracted body is as sensitive as the capture and is not a fixture
until someone has read it.

**"No body captured" is not "no match".** Some exporters and some cached entries
save no body at all. The tool reports the two differently; treat a
`no body captured` as a reason to re-export, not as evidence the endpoint is
elsewhere.

## When a search finds nothing

Run `validate_har.py --input capture.har` before assuming the endpoint is not
there. It reports what the exporter actually recorded — whether bodies are
present, whether they are base64, whether `_resourceType` exists — which
separates a bad capture from a bad query. Bodies are frequently base64-encoded,
where a plain `grep` of the raw file silently misses every hit; every command
here decodes first.

## References

| File | Read it when |
|---|---|
| `references/filters.md` | Selecting entries: every flag, how they compose, and the three that are not what they look like |
| `references/recipes.md` | The whole path: a capture, to the endpoint, to a request that runs in a loop |
| `references/capturing.md` | Recording a capture without a person at the browser: what writes the file, what leaks into it, what an exporter does to bodies |
