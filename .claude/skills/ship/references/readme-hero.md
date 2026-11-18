# README hero image — keeping one true

Load this when a repo's README carries a hero (banner) image and the change being
shipped might have made it wrong, or when one is being drawn or redrawn. It says
what any hero needs to stay correct and to render everywhere. It does not say what
one should look like; that is each project's own call.

## When a change means redrawing it

Redraw when the picture now says something false or leaves out the headline:

- a headline feature, command, flag or output the image shows was renamed or removed;
- the change adds something the README now leads with and the image omits;
- the project's name, tagline or logo changed.

A fix, a refactor or a routine release never needs a redraw, provided the image
carries no version number, no counts (skills, tests, boards, languages) and no
release date. Anything that moves on a release goes stale on the next one, so it
stays off the image.

Redraw in the same PR as the change, with the repo's own generator if it has one
(often `make hero`), so the README and the image never disagree on `main`.

## Making it render everywhere

- **Size: 1280 × 640.** It is GitHub's social-preview size (Settings → Social
  preview), so one file serves both. Render at 2× (2560 × 1280) for sharp
  high-DPI displays; GitHub scales it to the column.
- **Ship a PNG, keep the SVG as source.** GitHub shows a README's SVG through
  `<img>`, where no web font loads, so text falls back to whatever the viewer
  has. The PNG is what keeps the type.
- **Link it by absolute URL**
  (`https://raw.githubusercontent.com/<owner>/<repo>/main/docs/hero.png`). PyPI,
  npm and mirrors render the README away from the repo, where a relative path
  breaks.
- **Give it real alt text.** Say what the picture shows, not "banner".
- **Generate it from a script in the repo**, not by hand in an editor, so the
  next redraw is one command and a review can read the diff.
- **Mind the repo's own scanners.** Gates that read every committed file
  (secrets, IP literals, private names) read the PNG's bytes too. Re-encode
  until the scan passes rather than widening the gate.
