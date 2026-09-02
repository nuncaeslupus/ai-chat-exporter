# Recipes — a capture to a working scraper

Read when starting from a `.har` and ending at a request that can be run in a
loop. Each recipe is the whole path, not a flag reference (that is
`references/filters.md`).

---

## 1. Is there an API here at all

```bash
analyze_har.py --input capture.har
```

The line that decides the next hour is the XHR/JSON count. A site with fifty
XHR requests has an API to read; a site with none renders on the server, and
the work is HTML extraction rather than endpoint discovery.

If anything looks wrong — no bodies, no types, an unfamiliar exporter — run
`validate_har.py --input capture.har` before concluding anything. It separates
a bad capture from a bad query, which is the distinction that otherwise costs
an hour of looking in the right place with the wrong file.

## 2. Which request returned the thing on the page

Copy a string that was visible in the browser and search for it:

```bash
query_har.py --input capture.har --response-match "Senior Rust Engineer"
```

One line comes back per matching entry, with its index. That index is what
every later command takes.

If nothing matches, the order of suspicion is: the body was never captured
(`validate_har.py` says so); the string is rendered from a different field than
it appears; the data arrives over a websocket
(`analyze_har.py --input capture.har --websockets`).

## 3. What does that endpoint return

```bash
query_har.py --input capture.har --show 4 --schema
```

The shape — keys, types, array lengths — rather than the content. Usually 100×
smaller and usually the actual question: which field holds the thing being
scraped, and is the response a list or a page object wrapping one.

Then pull the values to check:

```bash
query_har.py --input capture.har --show 4 --json-path 'results[*].title'
```

## 4. How do I iterate it

```bash
analyze_har.py --input capture.har --endpoints
```

```text
GET    api.example.com/api/jobs  x4  [200,404]
    loc = NY  (constant)
    page varies over 4: 1..4
```

That row is the pagination scheme: `page` is the cursor, `loc` is a fixed
argument. The `404` in the status list is the end of the data — the capture
already recorded what happens past the last page, which is the loop's exit
condition.

## 5. What authenticates it

```bash
analyze_har.py --input capture.har --headers
```

A header sent identically on every request to a host is a candidate credential;
one that changes per request is not. Cookies are the other half:

```bash
analyze_har.py --input capture.har --cookies
```

Values are redacted in both. Names, flags and the constant-versus-varying split
are what matter here — the real values come next, and only into a command that
is being run rather than a file that is being kept.

## 6. Turn it into a request

```bash
create_repro.py --input capture.har --id 4 --format python --secrets
```

`--secrets` because a reproduction that does not authenticate does not
reproduce anything. What comes back is a `requests` call with the real headers,
which becomes the body of the scraping loop: substitute the `page` parameter
found in step 4 and iterate until the status the capture already showed.

Use `--format curl` to check the request outside Python first. Both forms
escape every captured value for their destination, so a header carrying shell
metacharacters stays data.

## 7. Keep a regression test

```bash
create_har.py --input capture.har --type xhr --output tests/fixtures/site.har
```

Bodies are dropped and credentials redacted by default, so the result is
committable. Later:

```bash
compare_har.py --input tests/fixtures/site.har --against fresh-capture.har --type xhr
```

Non-zero exit means the site moved: a status change, a parameter that appeared,
a response that changed size beyond the tolerance. That is the scraper's
early-warning test, and it needs no network at review time — only at capture
time.

If the fixture needs real payloads, `--keep-bodies` opts in, and the command
says plainly that the result is as sensitive as the capture. Read it before
committing it; redaction reaches named fields, not the inside of a body.
