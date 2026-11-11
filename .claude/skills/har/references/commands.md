# Commands — modes, extraction and output rules

Read when composing a query beyond the two-command answer: an `analyze_har.py`
mode, a flag that pulls data out of a body, or an output that hit its cap. The
selection flags themselves are in `references/filters.md`.

## Reading the capture as a whole

```bash
analyze_har.py --input capture.har --endpoints
```

| Mode | Output |
|---|---|
| *(default)* | Overview: entries, hosts, types, statuses, and the XHR/JSON count |
| `--endpoints` | The pagination finder: URL paths collapsed to templates, with which parameters vary and over what range |
| `--headers` | Request headers by host, split into constant across requests (candidate auth) versus varying |
| `--cookies` | Cookies sent and set, by domain, with their flags. Values redacted, names and flags kept |
| `--errors` | Every non-2xx, with the body snippet that usually says how to fix the request |
| `--stats FIELD` | Histogram over `status`, `host`, `mime`, `type`, `method`, `size`, `time` |
| `--redirects` | Redirect chains, collapsed |
| `--slowest` / `--largest` | Top-N by time or body size |
| `--websockets` | Per-socket frame counts, direction, sizes and first frames |
| `--index` | Writes the sidecar every other command reads |

Run `--endpoints` second, after the overview. Collapsing `?page=1&loc=NY`,
`?page=2&loc=NY`, `?page=3&loc=NY` into one row that says `page` varies over
1–3 while `loc` is constant turns forty URLs into one iteration rule.

`--headers` finds the auth header: a header sent identically on every request to
a host is a candidate credential, one that changes per request is not. It keeps
working under redaction because redacted values carry a salted fingerprint.

## Getting data out

| Flag | Effect |
|---|---|
| `--show IDX` | One entry in full: request line, headers, query, bodies, real values |
| `--schema` | A JSON body's shape — keys, types, array lengths — instead of its content |
| `--json-path a.b[*].c` | Pull values out of a JSON body |
| `--css h1` / `--xpath ./item` | Pull from an HTML or XML body. An unsupported selector is refused by name rather than silently matching nothing |
| `--extract-body --output-dir DIR` | Decode and write every matching body to a file |

## The index

`analyze_har.py --index` writes `capture.har.index.jsonl` beside the capture:
one line per entry, no bodies. Every filter, statistic and listing runs against
it alone, which keeps a query on a 200 MB capture sub-second. It is rebuilt when
the capture changes and belongs in `.gitignore`. Add `--verify-offsets` when a
body looks like it belongs to a different entry: it re-parses every entry from
its recorded byte offset and reports any that disagree.

## Output rules

**Small by default, complete on request.** Every command caps its output at 20
rows and 4096 bytes, whichever binds first, and says which one dropped rows.
`--limit 0` removes both caps; `--output PATH` writes the complete result to a
file. `--json` stays parseable under the cap by dropping whole entries from a
fixed envelope rather than cutting bytes mid-structure.

**Safe by default.** Anything written to disk — the index included — has auth
headers, cookies and token-shaped parameters replaced with
`<redacted:ab12cd34>`, a salted fingerprint: equal values stay equal, so header
analysis still works, and the original is not recoverable. URL userinfo and
fragments are removed outright, because an OAuth implicit flow puts a live token
in a fragment. `--show` prints real values, since that is an operator reading
their own capture; a value pattern against a redacted header needs `--secrets`.
Extracted response bodies are outside this guarantee: a body can carry a
credential anywhere, so treat an extracted body as being as sensitive as the
capture until someone has read it.

**An `--output` naming a capture being read is refused** before anything is
opened, in every script. A HAR records one moment on a live site and cannot be
re-recorded.

**Every emitted repro value is escaped for its destination.** Shell arguments
are quoted uniformly, Python values go through `repr()`, and bodies use
`--data-raw`, so a body beginning with `@` stays inline data rather than a
local-file read.
