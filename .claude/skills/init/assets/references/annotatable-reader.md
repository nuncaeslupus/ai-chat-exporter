# The annotatable reader — a gate, not a final flourish

Loaded by `specify` and `design`, and by anything else that writes a spec or
plan. The rules for handing one over are the same whoever wrote it, so they live
here rather than in skill bodies that would drift apart on the next edit.

## Whichever skill wrote it

A brainstorming or planning skill from another plugin is not an exemption. In an
arsenal repo spec work goes through `specify` and plan work through `design`;
when another skill runs anyway, its output goes to `status/specification.md` /
`status/plan.md` (a workspace's `arsenal/project/<ws>/spec.md` / `plan.md`) and
gets a reader like any other. No plan is written before the annotated spec is
approved.

Two mechanisms make this hold without anyone remembering it:

- **A PostToolUse hook** (`claude-arsenal/bin/reader_hook.sh`, registered by
  `/init`) fires on every Write/Edit to `status/specification.md`,
  `status/plan.md`, `arsenal/project/*/{spec,plan}.md`, `docs/**/specs/*.md` or
  `docs/**/plans/*.md` and tells the session the reader is stale, with the
  command that regenerates it.
- **A gate** — `python3 claude-arsenal/scripts/reader_check.py branch` exits 1
  when any of those documents changed on the branch without a reader generated
  from its current content (the reader embeds a digest of what it rendered).
  `ship` treats that as No-Go; a host that wants it on every PR adds it to
  `host-gate` in `arsenal/config.toml`.

## Any document that specifies or plans work gets a reader

Not only `status/specification.md` and workspace specs, which are all that
`create_reader.py` auto-discovers. A design document under `docs/design/`, an
RFC, a proposal written straight into a docs tree: same rule, named explicitly
since discovery will not find it, and with `--output-dir` pointed beside it.

```bash
create_reader.py --input docs/design/0007-thing.md --output-dir docs/design \
                 --name "Thing"
```

Publishing it some other way — a chat summary, a hand-built page, a link to the
raw file — does not satisfy this. The reader exists so notes attach to the
section they are about; a substitute that drops that property is not a
substitute.

A reader is named for what it is — `<repo>-<doc>-v<N>-<YYYY-MM-DD-HHMM>-reader.html`, with
`…-annotated.md` beside it (`yourproject-spec-v1-2026-10-12-1735-reader.html`): the git
repo's name, `spec` / `plan` (or the stem of any other document, so design docs
sharing a directory never overwrite each other's readers), the `**Revision**`
(1 without one) and the minute it was built, so two documents reviewed the
same day never share a name. A rebuild removes the earlier readers
of that document. Do not rename the output — `reader_check.py` looks for that
name; `--output FILE` is the explicit override when a name is required.

## Work that consumes the document waits for the annotations

Handing over the reader is where this step ends and the next one has not
started: do not open a pull request to merge the spec or plan, do not begin
`design` off a spec or `execution` off a plan, until the reviewer's export has
come back and been read.

A document reviewed only after it has been merged, or after the work it
describes is underway, has been ratified rather than reviewed. When the reviewer
says to proceed without annotating, that is their call and the work starts — but
it is their call to make, not an assumption to act on while waiting.

## The returned export is review history

The export is named like the reader, `<repo>-<doc>-v<N>-<YYYY-MM-DD-HHMM>-notes.md`, N
being the document's `**Revision**` header line and the stamp the export's. When one
arrives — a path in `~/Downloads`, an upload, a paste — move it into the
document's directory beside the reader. Before touching the document, bake the
notes into a reviewed copy, so they stay in the repo beside the text they were
written on, read-only and full length, not only in a Markdown file:

```bash
create_reader.py --input <doc> --output-dir <its dir> --notes <the export> --bake
```

That writes `<repo>-<doc>-v<N>-<stamp>-reviewed.html` and nothing else; a rebuild
does not remove it. Run it before the bump, while the text still matches the notes.
Applying the export makes the next revision: bump `**Revision**`, add a
`**Revision log**` line naming the export, regenerate the reader, and commit the
export and the reviewed copy **in the same commit** as that revision.

**Before that commit, read both for personal data, with the same weight as the
commit itself.** Notes are free text from a private review; once committed they
are in history, and on a public repo published. Redact names of real people,
email addresses, phone numbers, account handles and home paths (`/home/<user>`);
when a note loses its meaning without one, ask the reviewer. `--bake` warns on
emails and home paths it finds in the notes. It cannot see names, so the read is
still yours. Left in Downloads it is gone by
the next session; `query_status.py` names any export of this project's still
sitting in a Downloads folder (`~/Downloads`, `~/Descargas`, the XDG download
dir, …) that the repo does not track.

Approval is recorded in the header, not in chat:
`**Status**: approved (<date>, revision N)`, backed by a committed notes file
named for that revision or an explicit `— without annotations`.
`validate_spec.py` / `validate_plan.py` fail on a named notes file that is not
committed, and with `--require-approved` on a missing or unbacked approval —
`design` runs that on the spec before planning, and seeding or `execution` runs
it on the plan.

To re-seed a rebuilt reader with previous notes, pass `--notes <the returned
file>`; the export carries its own note data, so hand back the file the reviewer
sent, unrenamed. It also names the document it came from: `--notes` refuses an
export of another document (exit 2), and the page's **Import** button, which
restores an export into the reader after storage was lost, asks before loading one.

A note under `> ¶ “…”` was taken on that exact paragraph, list item or table
(the ✎ beside it), not on the section as a whole: act on the quoted text. One
reading `(text changed since this note)` was taken on a paragraph a later
revision rewrote; it is shown at the end of its section.

Pictures and SVG diagrams in a reader zoom in place: a tap or click widens one to
the window (a wide screen shows more of it) and pushes the note field down, pinch or Ctrl+wheel zooms the
picture only, a second tap fits it again. Local images are embedded, so the HTML
works alone from a Downloads folder or a phone.

## A screens review — optional, when pictures say it faster

A project with a user interface can review screenshots or mockups before, or
alongside, the spec. Offer it at the start of spec work when the problem is about
what a screen shows or how a flow feels; do it whenever the user asks for
screenshots. It is the same reader over a `screens.md` beside the spec:

```markdown
# <Project> — screens

**Revision**: 1

## S01 · <screen name>

One or two sentences: what this screen is for, and what to look at.

![<screen name>](shots/s01.png)

- Optional numbered callouts, when the picture needs them.
```

One `##` per screen, so each gets its own note field; the ✎ on the summary or a
callout notes that exact line. Mark the picture itself (arrows, numbered badges)
when the project calls for it; a plain capture is enough when the summary says
where to look.

Capture with what the project already runs: its own screenshot tooling, a test
runner's screenshot step, or a headless browser such as
`chromium --headless --screenshot=shots/s01.png --window-size=1280,800 <url>`.
Keep captures near the size they are viewed at (about 1280 px wide; a phone
capture at its own width); every image is embedded in the HTML, so a dozen
full-resolution captures make a page slow to open on a phone. Then:

```bash
create_reader.py --input <dir>/screens.md --output-dir <dir> --name "<Project>"
```

The returned export follows every rule above: commit it, bake it, apply it.
