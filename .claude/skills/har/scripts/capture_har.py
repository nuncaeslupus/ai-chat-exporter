#!/usr/bin/env python3
"""Record a HAR from a URL, for a session with nobody sitting at the browser.

The rest of this toolkit reads captures and says that making one is the
browser's job. That is the right split when a person is at the keyboard. In an
agent session nobody is, so the skill's first step was a step it could not take
and every consumer wrote the same twenty lines before reaching any of it.

Run it through `uv`, which keeps playwright out of the plugin's install:

    uv run --with playwright python3 capture_har.py --url https://example.com \\
        --output capture.har

Four things here are load-bearing, and each of them costs a run to rediscover:

* **`context.close()` is what writes the file.** If navigation raises and the
  exception escapes, there is no HAR at all — so a site slow or hostile enough
  to be worth capturing is exactly the one that produces nothing. It is in a
  `finally`, and a timed-out navigation still yields whatever was recorded.
* **`channel="chrome"` uses the browser already installed**, so no
  `playwright install` step and no 150 MB download. `--browser chromium` falls
  back to playwright's own build when there is no system Chrome, and
  `--executable PATH` launches a provisioned binary directly — which is what a
  sandbox that ships a browser whose build number this playwright does not
  recognise needs.
* **A fresh context every run** is the point, not an incidental: no cookies, no
  logins, nothing of the operator's session in a file that is routinely
  attached to a bug report.
* **`record_har_content="embed"` stores bodies already decoded while keeping
  the original `content-encoding` header.** `_harlib._decompress` handles that
  shape — bytes that fail their declared codec but read as text are taken as
  decoded — which is what makes a capture from here readable by the scripts
  beside it. Nothing else in the toolkit assumes it.

Playwright is imported inside `main`, not at module scope: every other script
here is stdlib-only so the skill runs in a vendored repo with no dependency
step, and `--help` must answer under the same interpreter.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Appended to the browser's real user agent rather than replacing it. A capture
# taken under a fabricated UA is a capture of a different site: consent walls,
# bot checks and server-side rendering all branch on it. Saying who is asking
# is a courtesy that costs nothing; pretending to be someone else costs the
# fidelity the capture exists for.
#
# This is the default only. Which token to say is the *caller's* to decide:
# a repo that already declares a robots identity has to capture under that one,
# because a `User-agent:` group naming a token is answering a question about
# that token — a capture taken as something else was taken under a rule the
# caller never read, and cannot settle whether their own fetch is permitted.
# `--ua-suffix` overrides it, and `--ua-suffix ""` appends nothing.
UA_SUFFIX = " claude-arsenal-har/1.0"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--url", required=True, help="the page to load")
    parser.add_argument("--output", type=Path, required=True, help="destination .har")
    parser.add_argument(
        "--browser", default="chrome", choices=("chrome", "chromium", "msedge"),
        help="'chrome' uses the installed browser and downloads nothing (default)",
    )
    parser.add_argument(
        "--wait", type=float, default=6.0, metavar="S",
        help="seconds to keep recording after load, for XHR that fires late (default 6)",
    )
    parser.add_argument(
        "--timeout", type=float, default=60.0, metavar="S",
        help="navigation timeout (default 60); a timeout still writes what was recorded",
    )
    parser.add_argument(
        "--executable", type=Path, metavar="PATH",
        help="launch this browser binary directly — for an environment that provisions "
        "one whose build number playwright does not recognise",
    )
    parser.add_argument(
        "--ua-suffix", default=UA_SUFFIX, metavar="TOKEN",
        help="appended to the browser's real user agent, so the site is told who is "
        "asking (default: %(default)r). Pass an empty string to append nothing",
    )
    parser.add_argument("--headed", action="store_true", help="show the browser window")
    args = parser.parse_args(argv)

    try:
        from playwright.sync_api import (  # type: ignore[import-not-found]
            TimeoutError as PlaywrightTimeoutError,
        )
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(
            "capture_har: playwright is not installed. Run this script as\n"
            "    uv run --with playwright python3 capture_har.py …\n"
            "which keeps it out of the plugin's own dependencies.",
            file=sys.stderr,
        )
        return 2

    args.output.parent.mkdir(parents=True, exist_ok=True)
    navigation_failed = False
    with sync_playwright() as play:
        launch: dict[str, object] = {"headless": not args.headed}
        if args.executable:
            launch["executable_path"] = str(args.executable)
        elif args.browser != "chromium":
            launch["channel"] = args.browser
        browser = play.chromium.launch(**launch)
        try:
            probe = browser.new_context()
            try:
                # `args.ua_suffix`, never the constant: an empty string is a
                # real answer ("append nothing"), so this must not fall back to
                # the default on a falsy value.
                user_agent = (
                    probe.new_page().evaluate("navigator.userAgent") + args.ua_suffix
                )
            finally:
                probe.close()
            context = browser.new_context(
                user_agent=user_agent,
                record_har_path=str(args.output),
                record_har_content="embed",
            )
            page = context.new_page()
            try:
                page.goto(args.url, wait_until="networkidle", timeout=args.timeout * 1000)
            except PlaywrightTimeoutError as exc:
                # The partial capture is the interesting one: the page never went
                # idle, but everything it did request is already in the HAR, so
                # this stays a success.
                print(f"capture_har: navigation did not settle: {exc}", file=sys.stderr)
            except Exception as exc:
                # Anything else -- DNS failure, refused connection, a URL with no
                # scheme -- is a real error. The HAR is still written by the
                # `finally` so whatever was captured survives, but the exit status
                # has to say so: returning 0 here made a capture of nothing look
                # indistinguishable from a good one.
                print(f"capture_har: navigation failed: {exc}", file=sys.stderr)
                navigation_failed = True
            else:
                page.wait_for_timeout(args.wait * 1000)
            finally:
                # The only place the HAR is written. Outside a `finally` a raised
                # navigation error leaves no file at all.
                context.close()
        finally:
            browser.close()

    if not args.output.is_file():
        print("capture_har: no HAR was written", file=sys.stderr)
        return 1
    print(f"wrote {args.output} ({args.output.stat().st_size} bytes)")
    if navigation_failed:
        print(
            "capture_har: the capture is incomplete -- navigation failed",
            file=sys.stderr,
        )
        return 1
    print(f"next: python3 validate_har.py --input {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
