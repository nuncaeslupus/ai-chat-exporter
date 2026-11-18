#!/usr/bin/env bash
# PostToolUse hook on Write / Edit / MultiEdit, registered by /init.
#
# When the edited file is a spec or plan — whichever skill wrote it — tells the
# session its annotatable reader is now stale and how to regenerate it. The
# match itself lives in reader_check.py, shared with the `branch` gate so the
# two can never disagree about what counts as a spec or plan.
#
# Cheap by construction: a payload that does not even mention "spec" or "plan"
# exits here in pure bash, and every other one costs one python3 call.
# Never blocks: always exits 0, and a missing python3 or script degrades to
# silence rather than a failed tool call.

payload="$(cat)"
case "$payload" in
  *spec*|*plan*) ;;
  *) exit 0 ;;
esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v cygpath >/dev/null 2>&1 && here="$(cygpath -m "${here}")"
printf '%s' "$payload" | python3 "${here}/../scripts/reader_check.py" hook 2>/dev/null || true
exit 0
