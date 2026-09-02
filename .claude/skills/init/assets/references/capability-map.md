# The capability map — knowing what this marketplace can do

Read when a task looks like something a skill would do, or when deciding
whether to mention a section this repo does not have.

The session-start protocol runs `init.py --list-sections` (step 0c). This file
says what to do with what it printed.

---

## What the map is

One line per skill section: its name, what it is for, whether it is installed
in this repo, and — for the ones that are **not** — the skills it would bring.

```
skill sections — 2 of 3 installed here
  core      on   the bundle itself — installer, queue engine, and the skills the protocol names
  python    off  the Python toolchain — coverage, mutation, dependency and release skills (coverage-gaps, dep-upgrade, mutmut-report, pypi-release, python-bootstrap)
  workflow  on   the spec → design → execute → review → ship discipline
```

Installed sections do not list their skills, because those are already in the
resident skills listing with full descriptions. Uninstalled ones do, because
that line is the only place they appear at all.

`--section NAME` prints one section's skills with their full descriptions.
Run it before recommending something, so the recommendation is about what the
skill actually does rather than what its name suggests.

Both flags are read-only. Neither installs anything.

## Why a session is given this unasked

Sections make the install set a choice, and a choice creates a thing nobody
knows about. A repo without the `python` section has no way to *discover*
`coverage-gaps`: the only place a skill announces itself is the listing of the
skills that were installed.

The failure this prevents is not "the tool could not be found when someone went
looking". It is that **nobody goes looking**, because nothing ever said there
was anything to look for. That is why the map is pushed into every session
rather than offered as a command to run when curious.

## The behaviour: volunteer, once

**When a task is squarely covered by a skill this repo did not install, say so
before doing the work the long way.**

> This repo does not have the `extract` section installed, which ships `har` —
> HAR capture analysis for exactly this. Enable it with
> `init.py --sections extract`, or say the word and I will continue with the
> browser.

The shape is the same whatever the section. A Python repo that never enabled
`python`, asked where its test coverage gaps are, mentions `coverage-gaps`.

Two failure modes bound it, and both are real:

| Failure | What it looks like |
|---|---|
| **Silence** | Grinding through a task with a browser while the right tool sits one config line away, unmentioned. The failure this exists to fix. |
| **Pestering** | Naming a section on every loosely related request, until it reads as an upsell and gets ignored — which costs the first failure back. |

So the trigger is **squarely covered**: the task is what the skill is *for*, not
merely adjacent to it. And the session **says it once and then does what was
asked**. The person deciding whether to install is the one who knows whether it
is worth it, and a decision not to install is not re-litigated later in the same
session.

## Enabling a section

```bash
python3 .claude/skills/init/scripts/init.py --repo-path . --sections extract
```

`--sections` replaces the set outright, on top of `core`; the choice is recorded
as an editable `[skills]` table in `arsenal/config.toml`, so switching one off
there prunes its skills on the next run and *stays* pruned. That is the whole
difference between a setting and deleting a directory by hand.

## Where the map comes from

`sections.json`, shipped with the bundle and generated in the marketplace from
the skills `/init` vendors.

It cannot be scanned from disk here, and that is worth knowing when the map
looks wrong: a vendored `init.py` lives in `.claude/skills/`, which holds
exactly the skills this repo installed. It can enumerate what is present and
not what is absent — the one question the map exists to answer.

If the map prints `installed sections only — this bundle predates the shipped
map`, the bundle is older than the manifest and is showing what it can see.
Update it (`claude-arsenal/bin/check_update.sh`) and the full map returns.

Skills that belong to a separate marketplace plugin rather than to the bundle —
`skill-workshop`, for one — are not sections and do not appear. `--sections`
cannot install them; they are installed as plugins.
