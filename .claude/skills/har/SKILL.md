---
name: har
description: Records, searches, filters and redacts HAR captures and turns them into scrapers. Use when the user has or needs a HAR capture. Not for non-capture JSON or HTML.
argument-hint: "--input capture.har"
user-invocable: true
metadata:
  section: extract
  type: tool
---

# HAR analysis

CANARY: har-loaded-2026-08-30-7f3a91c4-2b6d4e8a1c9f0b73

A browser capture holds every request, header and response body of a session,
in 5–500 MB of JSON. The few hundred bytes that matter — which endpoint returns
the data, which parameter pages it, which header authenticates it — are reached
through these scripts rather than by reading the file.

## When to load

- A `.har` file has to be searched, summarised, filtered, reduced or made safe
  to commit.
- The question is which request returned a string seen on a page.
- A scraper is being built from a captured session.
- There is no capture yet and nobody at a browser to take one.

A JSON or HTML file that did not come out of a capture needs none of this.

## When there is no capture yet

```bash
uv run --with playwright python3 "${CLAUDE_SKILL_DIR}/scripts/capture_har.py" \
    --url https://jobs.example.com/search --output capture.har
```

It records into a fresh browser context, so no operator cookie or login ends up
in the file, and writes the HAR even when navigation times out. `--headed` to
watch, `--wait S` for late XHR. Read `references/capturing.md` before changing
any of that.

## The two-command answer

Paste a string that was visible on the page; get back the request that returned
it, then its shape:

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/query_har.py" --input capture.har \
    --response-match "Senior Rust Engineer"
python3 "${CLAUDE_SKILL_DIR}/scripts/query_har.py" --input capture.har --show 4 --schema
```

`--schema` prints keys, types and array lengths, often 100× smaller than the
body. On an unfamiliar capture, run `analyze_har.py --input capture.har` first:
its XHR/JSON count says whether to look for endpoints or parse rendered HTML.

## The scripts

| Script | What it answers |
|---|---|
| `query_har.py` | Which entries match, what one contains, and getting bodies out |
| `analyze_har.py` | What is in here and how to iterate it; `--endpoints` finds pagination, `--index` builds the sidecar |
| `validate_har.py` | Is this capture usable, and what did its exporter leave out |
| `create_repro.py` | One entry to a runnable `curl` or Python `requests` snippet (`--id N --format curl\|python`) |
| `create_har.py` | A derived capture — filtered, redacted, bodies dropped — small enough to commit |
| `compare_har.py` | What changed between two captures: the scraper's early-warning test |
| `capture_har.py` | Record a capture when nobody is at the browser |

The readers share `--input`, `--json` and one selection grammar (`--url`,
`--host`, `--status`, `--type`, `--param`, `--response-match`, …), and each runs
`--help` for its flags. Output is capped at 20 rows / 4096 bytes and says so;
`--limit 0` or `--output PATH` gives the full result. Files written to disk
carry redacted credentials; `create_repro.py --secrets` and
`create_har.py --keep-bodies` opt back in and say the result is as sensitive as
the capture.

## When a search finds nothing

Run `validate_har.py --input capture.har` before concluding the endpoint is
absent. It reports whether bodies were recorded, whether they are base64, and
whether `_resourceType` exists, which separates a bad capture from a bad query.
A `no body captured` result is a reason to re-export, not evidence the endpoint
is elsewhere.

## References

| File | Load when |
|---|---|
| `references/commands.md` | Composing a query: `analyze_har.py` modes, extraction flags, the index, output caps and redaction rules |
| `references/filters.md` | Selecting entries: every flag, how they compose, and the three that behave differently from how they look |
| `references/recipes.md` | Walking the whole path from a capture to a request that runs in a loop |
| `references/capturing.md` | Recording a capture without a person at the browser |
