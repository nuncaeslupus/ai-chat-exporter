# Capturing — recording a HAR with nobody at the browser

Read when there is no capture yet, or when changing `capture_har.py`.
For reading a capture that already exists, everything else in this skill
applies and none of this does.

A person at a browser saves a HAR from devtools. That is still the best capture
available, and when someone is sitting there it is the right answer. A session
has nobody there, so the script exists.

```bash
uv run --with playwright python3 capture_har.py \
    --url https://jobs.example.com/search --output capture.har
```

`uv run --with playwright` rather than a plugin dependency: every other script
in this skill is stdlib-only so it runs in a vendored repo with no install step,
and one optional recorder is not worth giving that up. `capture_har.py` imports
playwright inside `main`, so `--help` answers under a bare interpreter too.

---

## The four rules

Each of these is here because the obvious alternative fails silently. They are
the reason this is a script rather than four lines of instructions.

### `context.close()` is what writes the file

Playwright buffers the recording and flushes it when the **context** closes.
Nothing is written before that. So this:

```python
page.goto(url, wait_until="networkidle", timeout=60_000)   # raises on a slow site
context.close()                                            # never reached
```

produces no HAR at all — and the site slow or hostile enough to be worth
capturing is exactly the one that raises. The close belongs in a `finally`, and
a navigation timeout should be reported and then *kept*: a partial capture of
the first six seconds usually still contains the XHR being hunted.

### Use the browser that is already installed

`channel="chrome"` (the default, `--browser chrome`) launches the system Chrome,
so `uv run --with playwright` needs no `playwright install` and downloads no
150 MB bundle. `--browser chromium` uses playwright's own build where there is
no system Chrome. `--executable PATH` launches a provisioned binary directly,
which is what a sandbox that ships a browser whose build number this playwright
does not recognise needs — the symptom there is
`Executable doesn't exist at …`, naming a build number that is not the one on
disk.

### A fresh context, every run

Not an incidental — the point. A new context carries no cookies, no logins, and
nothing of the operator's session. A HAR is routinely attached to a bug report
or committed as a fixture, and a capture taken in a logged-in profile carries a
live session cookie into both. `create_har.py` redacts the fields it can name,
but not capturing a credential is a stronger guarantee than redacting one.

The user agent is the browser's real one with a token appended, never a
fabricated string. Consent walls, bot checks and server-side rendering all
branch on the UA, so a capture taken under a fake one is a capture of a
different site — which defeats the point of capturing.

Which token gets appended is the caller's, not this toolkit's: `--ua-suffix`
sets it, and it defaults to `claude-arsenal-har/1.0`. That matters most in the
case the capture is usually *for*. A repo that already declares a robots
identity has to capture under that identity, because a `robots.txt` group
naming a token is answering a question about **that** token — a group that
binds eleven named AI crawlers and not `*` says nothing about a fetch made as
something else. So a capture taken under the default is not evidence about a
fetch the caller would actually make.

```bash
uv run --with playwright python3 capture_har.py --url URL --output capture.har \
    --ua-suffix " integral-job-search/0.1 (+https://example.com/bot)"
```

`--ua-suffix ""` appends nothing, for a page whose rendering branches on a
token it does not recognise. It is honoured as given rather than falling back
to the default — an empty suffix is an answer, not a missing one.

### `record_har_content="embed"` stores bodies already decoded

And keeps the original `content-encoding` response header. So a brotli-served
response arrives as plain bytes labelled `br`, and a reader that trusts the
label finds a body that will not decompress.

`_harlib._decompress` handles this: bytes that fail their declared codec but
read as text are taken as already decoded. That is what makes captures from
here readable by the scripts beside them, and it also covers `br` on a machine
with no `brotli` module — the common case, since these scripts are stdlib-only.

The alternative content modes are worse for this toolkit's purpose:
`"attach"` writes bodies as separate files beside the HAR, which the readers
here do not follow, and `"omit"` writes no bodies at all, which removes the one
thing `--response-match` searches.

---

## After the capture

```bash
python3 validate_har.py --input capture.har
```

Always, before concluding anything about the site. It reports what the exporter
actually recorded — whether bodies are present, whether they are base64,
whether `_resourceType` exists — which separates "this site has no API" from
"this capture has no bodies". A scripted capture is the case where that
distinction is most worth checking, because nobody watched it happen.

Two failure shapes worth recognising in that report:

| Report says | What happened |
|---|---|
| `0 response bodies` | the content mode was `omit`, or the run captured only a redirect |
| `undecodable bodies` | a real encoding problem, not the embed shape above — `query_har.py --show IDX` names the reason per entry |

## What this does not do

No scrolling, no clicking, no login, no waiting on a specific selector. The
script loads one URL, waits for the network to settle, waits `--wait` seconds
more for late XHR, and stops. A capture that needs an interaction needs a
purpose-written playwright script; this one is the ninety-percent case, and its
source is short enough to copy and extend.
