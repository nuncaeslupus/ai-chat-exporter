# The selection grammar

Read when selecting entries: every flag, how they compose, and the three that
behave differently from how they look.

`query_har.py`, `create_har.py` and `compare_har.py` accept identical selection
flags, implemented once in the skill's `_filters.py`. A set of entries selected once
can be listed, exported and diffed without relearning anything, and a test
asserts the three scripts have not drifted apart.

---

## Every flag composes as AND

| Flag | Selects |
|---|---|
| `--url REGEX` | the full URL matches |
| `--host REGEX` | the hostname matches |
| `--method M` | the method is M (repeatable) |
| `--status SPEC` | `200`, `4xx`, `400-499`, or a comma-separated mix |
| `--mime REGEX` | the response mime type matches |
| `--type T` | resource type: `xhr`, `fetch`, `document`, `script`, `image`, … (repeatable) |
| `--min-size N` / `--max-size N` | response body bytes |
| `--slower-than MS` | total time at or above MS |
| `--param NAME[=REGEX]` | query parameter present, optionally matching |
| `--has-header NAME[=REGEX]` | header present, optionally matching |
| `--body-match REGEX` | the **request** body matches |
| `--response-match REGEX` | the **response** body matches |
| `--page ID` | the entry belongs to that page |
| `--since ISO` / `--until ISO` | started within the window |
| `--from-cache` / `--no-cache` / `--unknown-cache` | see below |
| `--invert` | select what does **not** match the rest |

## Three that are not what they look like

**`--no-cache` does not mean "not cached".** `_fromCache` is three-state:
`true`, `false`, or *the exporter never recorded it*. `--no-cache` selects
`false` **only**, and `--unknown-cache` is its own flag. Folding the third
state into the second would make one command mean different things on a Chrome
capture and a Playwright one, silently — the class of bug this toolkit exists
to prevent.

**`--has-header NAME=REGEX` on an auth header needs `--secrets`.** The index
stores sensitive header values redacted, so a value pattern against
`authorization` cannot be answered from it. The command says so and exits
rather than matching against the redaction marker and reporting "no results"
for a header that is plainly present. `--secrets` reads the capture instead.
Presence alone (`--has-header authorization`) always runs on the index.

**`--param tag=a` finds a request that also sends `tag=b`.** Query pairs are
stored as pairs, in captured order, because `?tag=a&tag=b` is two values for
one name. Nothing collapses them into an object, which would silently keep the
last one.

## Cheap first, expensive second

Filters split in two. **Index predicates** — everything except the two
body-match flags — answer from the sidecar alone: no capture opened, flat
memory, independent of how large the bodies are. **Body predicates** need an
entry read back by byte offset and decoded.

The second kind is only evaluated for rows the first kind accepted. So a query
like `--type xhr --status 200 --response-match "…"` reads bodies for the
handful of entries that survived the cheap filters, not for the capture.

That is why narrowing before searching is worth doing, and why a query that
names no body stays sub-second on a 200 MB capture.

## Composing across commands

```bash
# See what matches.
query_har.py  --input capture.har --type xhr --status 2xx --host 'api\.'

# Write exactly that set to a file small enough to commit.
create_har.py --input capture.har --type xhr --status 2xx --host 'api\.' \
              --output fixture.har

# Later, check the site has not moved under the scraper.
compare_har.py --input fixture.har --against today.har --type xhr
```

`compare_har.py` refuses the two body-match flags: it selects on metadata so a
comparison stays flat in the captures' body bytes, and says so rather than
quietly running slowly.
