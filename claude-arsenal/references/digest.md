# The review digest — what a human decides from

Load this when opening a PR or pushing a new head to one, when a session is
ending or stopping for budget, or when a human sends back digest decisions
(a file with an `ARSENAL-DECISIONS` block, or lines like `approve 42`).

The digest lets a person approve a night's work without opening GitHub: one page,
a folded card per PR, red first, each with Approve / Deny / Question. Each card
is built from a record stored in the PR's own body, so nothing depends on the
session that wrote it surviving.

## 1. Record every PR you open — and again on every new head

After the pre-PR review (`references/pre-pr-review.md`) and before handing the
PR on, write the notes only you know and record them:

```bash
cat > tmp/digest-notes.json <<'JSON'
{"summary": "What changed and why, 2-3 sentences, at most 60 words.",
 "undo": "How to take it back (revert the merge; any data step).",
 "fixes": [{"what": "the problem", "found_by": "cold-reviewer", "fix": "how", "commit": "abc1234"}],
 "open": ["RISK: what is still true and why it ships anyway"],
 "expected_lines": 120,
 "deps": [41]}
JSON
python3 claude-arsenal/scripts/digest.py record --pr <N> --notes tmp/digest-notes.json
```

- `found_by` is `self`, `cold-reviewer`, `ci`, `human` or `bot:<login>`. List every
  problem that was found and fixed: who found it is what lets the human judge the review.
- `deps`: the PR numbers this one needs merged first. Omit it when there are none.
- `expected_lines`: your estimate of lines added + removed across all files (tests
  included), written down **before**
  implementing. Over twice that, the card says so and a green mark turns amber.
  Leave it out rather than guess after the fact.
- Add `"state": "needs-decision"` when the review cap was hit and you open the PR
  under the `override` exit. That PR is the human's call, not yours.
- `record` exits 1 on a summary over the size rule. Shorten it, don't pad the details.
- No scriptable channel (exit 5): fetch the PR and its files with your GitHub tools,
  pass `--pr-json` / `--files-json`, and set the body it prints.

A PR that waits on a human (`merge_ready.sh` says it needs human approvals) is not a
blocked worker: report it, and take the next task that does not depend on it.

## 2. Render at session end, at the budget stop, and every `digest-every` merges

```bash
python3 claude-arsenal/scripts/digest.py render        # --since last; --format html|md
```

The header carries the last 30 days' review metrics (`scripts/review_metrics.py`:
merges, reverts and fix-ups per tier). Add `--audit <ledger.json>` after an overnight
repo audit to show its findings as a card above the PRs. `digest-delivery` decides the output. `file` prints the path of the HTML; publish
that page if your surface can, else name the path. `chat` prints Markdown to paste
into your reply. `both` does both. Deliver it in the same reply as the session's
summary, so it is not lost behind later turns.

## 3. Apply what the human decided

```bash
python3 claude-arsenal/scripts/apply_decisions.py <decisions-file> --dry-run   # read the plan
python3 claude-arsenal/scripts/apply_decisions.py <decisions-file>
python3 claude-arsenal/scripts/apply_decisions.py --text "approve 42; deny 43: split it"
```

- An approval holds only for the head the human saw. A moved head is `stale`: it goes
  into the next digest and is never merged.
- Merges run in dependency order. A PR whose dependency was denied waits.
- A denied open PR is closed. A denied merged one gets a revert PR. If the push is
  refused, revert it by hand and say so.
- A question is posted on the PR. Answer it there, then re-record the PR so the
  answer shows in the next digest.

Commit the decisions file beside the digest it answers, as the record of who approved what.

## Counting a digest approval as a human one

`[review] digest-decisions = true` makes `pr_audit.py` count the decision marker that
`apply_decisions.py` posts as one human approval on that head — only when the repo
OWNER's account posted it and it names the full head SHA. Use it when the agent
opens PRs with the owner's own GitHub account, where GitHub will not let the owner
approve. The marker is written by the agent from the exported file, so it is only
as trustworthy as that file: leave it off where more than one person can hand the
agent a decisions file.
