# Ideas backlog — `status/ideas.md`

Load when creating or updating `status/ideas.md`: on capture, when a decision changes
(Step 6), or at hand-off (Step 7). The file is committed; it is the one place in
`status/` this skill writes.

## Template

```markdown
# Ideas backlog

## Groups

### A. Sign-up and accounts
- Let people join with an email link, no password  (I-1)
- Invite a household member from the app  (I-2)

### B. Reminders
- A weekly digest instead of one message per chore  (I-3)

## Sub-projects

| ID  | Name             | Groups | Status    | Spec section                  |
|-----|------------------|--------|-----------|-------------------------------|
| S-1 | Accounts         | A      | exploring |                               |
| S-2 | Reminder engine  | B      | parked    |                               |

## Decision log

| ID  | Decision                    | Status          | Date       | Sub-project |
|-----|-----------------------------|-----------------|------------|-------------|
| D-1 | Web app first, mobile later | agreed          | 2026-09-29 | S-1         |
| D-2 | Hosting provider            | open (research) | 2026-09-29 | S-1         |
```

## Rules

- **Ids are stable.** `I-N`, `S-N` and `D-N` are assigned once, in order, and never
  renumbered, reused or deleted — a spec and a decision cite them. An idea that is no
  longer wanted keeps its line, struck through (`~~…~~`); a sub-project becomes `dropped`;
  a decision becomes `superseded by D-N`.
- **Groups** are lettered `### A.`, `### B.` …; every idea bullet ends in `(I-N)`.
- **Sub-project status** is `parked`, `exploring`, `specified` or `dropped`. `specified`
  needs the Spec section cell filled (`status/specification.md` or the workspace spec path).
- **Decision status** is `agreed`, `open`, `open (research)` or `superseded by D-N`.
- **Sub-project column** on the decision log is optional but recommended once there is
  more than one sub-project: it is what lets `validate_spec.py` tell which agreed
  decisions a spec must carry.

## Check it

```bash
python3 claude-arsenal/scripts/ideas_log.py check --base HEAD
```

Exit 1 names a duplicate or malformed id, an unknown status or group, or (with `--base`)
an id that existed in that revision and is gone now.
