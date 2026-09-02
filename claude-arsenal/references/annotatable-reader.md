# The annotatable reader — a gate, not a final flourish

Loaded by `specify` and `design`. Both produce a document somebody has to
review, and the rules for handing it over are the same, so they live here rather
than in two skill bodies that would drift apart on the next edit.

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

Rename its `spec-reader.html` / `spec-annotated.md` output to match the document
(`0007-thing-reader.html`) whenever more than one such document can share a
directory — the generated names are fixed, so two design docs would otherwise
overwrite each other's readers.

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

When one arrives — a path in `~/Downloads`, an upload, a paste — move it into the
document's directory beside the reader and commit it. Left in Downloads it is
gone by the next session. To re-seed a rebuilt reader with previous notes, pass
`--notes <the returned file>`; the export carries its own note data, so hand back
the file the reviewer sent, unrenamed.
