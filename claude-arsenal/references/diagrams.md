# Diagrams in specs, plans and docs — drawspec, not hand-drawn

Loaded when a spec, plan or design document needs a picture. `specify` and
`design` point here; so does anything else that writes one.

## Write what the diagram means, not where things go

A diagram is a [drawspec](https://github.com/nuncaeslupus/drawspec) document:
JSON naming the nodes, edges, labels and a semantic role for each. drawspec
computes every coordinate and renders SVG that takes its colour from the page, so
it reads in dark mode and in greyscale print.

Not hand-written SVG, and not ASCII art. Both ask for coordinates an agent cannot
check without seeing the output: boxes overlap, arrows miss, labels run off the
edge, and nothing fails. drawspec refuses a coordinate by name and reports every
violation with the JSON pointer of where it was written, so a broken diagram is
an error message instead of a picture that looks wrong.

The format — the kinds (`flow`, `tree`, `timeline`, `matrix`, …), the roles, the
one rule — is drawspec's own
[AGENTS.md](https://github.com/nuncaeslupus/drawspec/blob/main/AGENTS.md). Read it
whole before the first diagram; `drawspec kinds` and `drawspec example <kind>`
print the short version.

## Where it goes: a fenced block in the Markdown

The JSON source lives in the document, in a fence tagged `drawspec`:

````markdown
```drawspec
{"version": 1, "kind": "flow",
 "nodes": [{"id": "in", "text": "Request", "role": "start"},
           {"id": "ok", "text": "Authorised?", "role": "decision"}],
 "edges": [{"from": "in", "to": "ok"}]}
```
````

The source is what gets reviewed and diffed. `create_reader.py` draws it: each fence is validated, then rendered
to inline SVG in the HTML reader, and the annotated Markdown keeps the JSON. A
diagram drawspec refuses fails the reader run with the block named and drawspec's
own message, and nothing is written — fix the JSON, regenerate.

Check one while writing it:

```bash
drawspec validate diagram.json     # every violation, with its JSON pointer
```

## On GitHub: render the fences after editing them

GitHub does not know the `drawspec` fence and shows its JSON. After writing or
editing a diagram in a document that lives in the repo (`status/specification.md`,
`status/plan.md`, a workspace's `spec.md`/`plan.md`), run:

```bash
python3 claude-arsenal/scripts/render_diagrams.py status/plan.md   # any number of files
```

Each fence gets `diagrams/<doc>-<n>.svg` beside the document, an image line above
it, and its source collapsed under "Diagram source". The SVG's ink follows the
viewer's light or dark scheme. Commit the SVGs with the document; they are derived,
so never edit one by hand. A rerun is a no-op, and it removes the SVG of a deleted
fence. `--check` writes nothing and exits 1 when anything is stale, which suits a
CI step. The HTML reader drops the image line and the wrapper and draws each fence
itself, as before. `sync_plan_graph.py --apply` rewrites the graph fence, so run
this after it.

## Running drawspec

It is on PyPI (`pip install drawspec`, or `uvx drawspec`). `render_diagrams.py`
needs drawspec 0.4 or later (`uvx --from 'drawspec>=0.4,<0.5'` by default).
`create_reader.py` uses, in order: the command in `ARSENAL_DRAWSPEC` (e.g. `ARSENAL_DRAWSPEC="uvx
--from /path/to/drawspec drawspec"`), `drawspec` on `PATH`, then
`uvx --from 'drawspec>=0.2,<0.3' drawspec` — pinned to a known-good range so a
reader does not change under you. With none of
those available, a document containing a `drawspec` fence fails with that hint
rather than rendering without its picture. A document with no fence never runs
drawspec, so it adds no dependency to any reader that does not draw.
