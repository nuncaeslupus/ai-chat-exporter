#!/usr/bin/env python3
#
# DUPLICATED ACROSS SKILLS:
# - plugins/skill-workshop/hooks/gate_target.py (canonical)
# - plugins/core/skills/init/assets/bin/gate_target.py
# Shipped in the core bundle because plugin hooks do not travel with vendored
# skills, and vendoring is the only path a cloud session can use. Keep both
# copies in sync. Update via skill-workshop's sync_duplicates.py.
"""gate_target.py — decide what a tool call is about to write inside a skill folder.

Reads a PreToolUse payload on stdin, prints the skill-folder path the call would
modify, or nothing when it would not modify one.

Edit / Write / MultiEdit name their target outright. Bash does not: `sed -i`,
`tee`, a heredoc redirect and a Python one-liner all reach a SKILL.md without
ever appearing as a `file_path`, which is how the gate came to be bypassable by
the edit style the harness encourages.

For Bash the command is tokenised and each simple command is asked where it
*writes*, which is not the same as which paths it mentions. `cp SKILL /tmp/bak`
only reads the skill; `cp /tmp/x SKILL` overwrites it. Getting that distinction
wrong is costly in both directions — a gate that misses a write is no gate, and
one that blocks reads gets routed around instead of through.

Known limits: a path built from a shell variable (`cp "$SKILL" …`) is opaque
here, and so is one assembled at runtime; a wrapper that takes an argument of
its own (`timeout 30 python3 -c …`) hides the interpreter behind it; and a
script file — or a module run with `-m` — is trusted to be what it says it is,
since its contents are not read. This raises the cost of an accidental bypass; it is not a sandbox.
"""
from __future__ import annotations

import json
import re
import shlex
import sys

# A skill folder — `.claude/skills/<name>` or `plugins/<plugin>/skills/<name>` —
# or anything beneath it. The root itself counts: `rm -rf …/skills/specify`
# deletes the skill as surely as editing its SKILL.md does.
# `(?:.*/)?` rather than a character class: shlex has already resolved quoting,
# so the prefix is a real directory path and may contain anything a filesystem
# allows — spaces included. Ending it at `/` keeps the match on a path
# boundary, so `notplugins/core/skills/x` is not mistaken for a skill.
SKILL_PATH = re.compile(
    r"^(?:.*/)?(?:\.claude/skills|plugins/[^/]+/skills)/[^/]+(?:/.*)?$"
)

# The same shape, found anywhere inside a larger string (an interpreter script).
# Inside an interpreter argument the prefix is unknowable, so only the marker
# onward is matched — enough for the decision. `(?:^|[\s'"/])` keeps it on a
# path boundary so `notplugins/core/skills/x` does not trip the gate.
EMBEDDED_PATH = re.compile(
    r"(?:^|(?<=[\s'\"/]))(?:\.claude/skills|plugins/[^/\s'\"]+/skills)/[^/\s'\"]+(?:/[^\s'\"]*)?"
)

REDIRECTS = {">", ">>", ">|", "&>", "&>>", "1>", "2>", "1>>", "2>>"}
# `(` and `)` are deliberately absent — they are handled in `_simple_commands`,
# where the difference between a subshell and a function call can be told.
SEPARATORS = {";", "&&", "||", "|", "&", "\n"}

# Where each utility writes, given its file arguments.
#   "all"  — every path argument is a destination
#   "last" — only the final path argument (cp: sources are reads)
ALL, LAST = "all", "last"
UTILITIES = {
    "tee": ALL, "truncate": ALL, "touch": ALL, "chmod": ALL, "chown": ALL,
    "patch": ALL, "ln": ALL, "install": ALL, "shred": ALL,
    # mv and rm remove their sources, which mutates the skill just as much.
    "mv": ALL, "rm": ALL, "rmdir": ALL,
    "cp": LAST,
}

# Interpreter write calls, for the heredoc-into-python route.
#
# The `open(...)` alternative matches on the MODE, not on a later `.write`:
# `open(path, "w").close()` truncates the file to nothing and never calls
# `write`, so a pattern keyed on the write itself missed the one form that
# destroys a skill without writing a byte. `w`, `a`, `x` and `+` are the modes
# that can mutate; `r`, `rb`, `rt` and a bare `open(path)` are reads and must
# not match, because a gate that blocks reads gets routed around rather than
# through.
WRITERS = re.compile(
    r"write_text\s*\(|\.write\s*\(|writeFileSync|shutil\.(?:copy|move)"
    r"|os\.replace|\.unlink\s*\(|\.rename\s*\(|rmtree\s*\(|makedirs\s*\("
    r"""|open\s*\([^)]*?,\s*(?:mode\s*=\s*)?['"][rwaxbt+]*[wax+][rwaxbt+]*['"]"""
    # `.write(` does not match `.writelines(` — the paren must follow `write`.
    # `os.remove` is the third spelling of the operation whose other two
    # (`.unlink(`, `rmtree(`) were already here. The rest write through a
    # function whose own name is the only thing visible.
    r"|\.writelines\s*\(|json\.dump\s*\(|print\s*\([^)]*\bfile\s*="
    r"|os\.(?:remove|truncate)\s*\(|fileinput\.\w+\s*\([^)]*\binplace\s*="
)

# --- interpreter source, where the denylist above runs out -------------------
#
# WRITERS is a list of ways to write a file, and that list cannot be finished:
# `os.system("rm …")`, `subprocess.run`, `fileinput(inplace=True)`, `exec` of a
# string built at runtime, and the next spelling nobody has thought of yet all
# reach a SKILL.md without matching any name in it. Worse, the list decays as
# code gets tidier — ruff's PTH123 pushes `open(p, "w")`, which WRITERS catches
# on its mode, toward `Path(p).open("w")`, which it cannot, because builtin
# `open` takes the path first and `Path.open` takes the mode first. Every miss
# is fail-open on a gate whose job is to refuse.
#
# So for an interpreter running source on the command line or on stdin, the
# polarity is inverted: a skill path in that source is a write **unless** every
# mention of it sits inside a construct that can only read. The ways to write a
# file are unbounded; the ways to read one that are worth allowing are not, and
# under-listing a read only ever blocks more, never less.
INTERPRETERS = re.compile(
    r"^(?:python[\d.]*|node|nodejs|deno|bun|perl|ruby|php|sh|bash|zsh|dash)$"
)

# Flags that mean "the program is right here, or on stdin".
#
# `-E` and `-m` are deliberately absent. They read as inline source only for the
# interpreter that spells them that way: perl's `-E` is `-e` with features on,
# but python's `-E` means "ignore the environment" and is followed by a script
# file — `python3 -E validate.py plugins/core/skills/har` is the validator run,
# a read the docstring above names as one that must not be blocked. And `-m`
# runs a module, which is the program with its own arguments after it, exactly
# like a script file: `python3 -m pytest plugins/core/skills/x/tests` reads that
# folder.
INLINE_SOURCE_FLAGS = frozenset({"-c", "-e", "--eval", "--exec", "-"})

# A quoted path with a skill folder in it, as it appears inside interpreter
# source. Quoted, because an unquoted or interpolated path is one this file
# cannot resolve — and an unresolvable path must not qualify as a read.
_QUOTED_SKILL_PATH = (
    r"""['"][^'"]*(?:\.claude/skills|plugins/[^/'"]+/skills)/[^'"]*['"]"""
)

# The closed set of read-only uses. Each is removed from the source before it is
# searched for skill paths; whatever path is still standing afterwards is a
# write. A read mode is `r`, `b`, `t`, `U` and nothing else — `r+` reopens the
# file for writing, which is why `+` is absent here and present in WRITERS.
READ_ONLY_USES = re.compile(
    rf"""(?:
        open \s* \( \s* {_QUOTED_SKILL_PATH} \s*
            (?: , \s* (?: mode \s* = \s* )? ['"][rbtU]+['"] \s* )?
            # `(?!mode\b)`: without it this generic-keyword arm swallows
            # `mode='a'`, and an append reads as a read.
            (?: , \s* (?!mode\b) [A-Za-z_]\w* \s* = \s* [^,)]* )* \s* \)
      | Path \s* \( \s* {_QUOTED_SKILL_PATH} \s* \) \s* \. \s*
            (?: read_text | read_bytes | exists | is_file | is_dir | stat
              | resolve | glob | rglob | iterdir )  \s* \(
      | Path \s* \( \s* {_QUOTED_SKILL_PATH} \s* \) \s* \. \s*
            open \s* \( \s* (?: ['"][rbtU]+['"] \s* )? \)
    )""",
    re.VERBOSE,
)

# An interpreter handed a heredoc. Its body is the source, but the tokeniser
# treats an unquoted newline as a command separator — deliberately, so that a
# second line's `rm` is seen — which leaves each body line standing alone, far
# from the `python3` that gives it meaning. So the heredoc is recognised in the
# raw command text, before any of that.
INTERPRETER_HEREDOC = re.compile(
    r"(?:^|[\s;&|(])(?:[\w./-]*/)?"
    r"(?:python[\d.]*|node|nodejs|deno|bun|perl|ruby|php|sh|bash|zsh|dash)"
    r"(?:\s+-[^\s<]*)*\s*<<"
)

# Prefixes that stand in front of the real command. The `run` pair matters here:
# this repo's own scripts are launched as `uv run python3 …`, which read as the
# utility `uv` and went to the fallback branch instead of being seen as python.
WRAPPERS = frozenset({"sudo", "command", "env", "time", "nice", "stdbuf",
                      "npx", "uvx", "bunx"})
WRAPPER_SUBCOMMANDS = {"uv": "run", "poetry": "run", "pipenv": "run",
                       "pdm": "run", "hatch": "run", "rye": "run"}


# The interpreters for which an uppercase `-E` carries the program. Perl only:
# ruby's `-E` is the *encoding* option and takes a value, so `ruby -E utf-8
# lint.rb plugins/core/skills/x` runs a script and reads that folder.
DASH_E_IS_SOURCE = frozenset({"perl"})

# What a program named on the command line looks like: a path, or a file with a
# script's extension. Anything else after a flag — `python3 -W ignore`, `sh -s
# name` — is that flag's OPERAND, and reading it as the program is what let
# `echo "…write_bytes(…)" | python3 -W ignore` through: the classifier decided
# the program was a file called `ignore` and stopped looking at stdin.
#
# Erring here is one-directional on purpose. A bare word is assumed to be an
# operand, so the search continues and the command is more likely to be judged
# stdin-fed — which means the whole command text gets read. The cost is an
# interpreter run on an extensionless script in the working directory, in the
# rare case a skill path is also on the line.
SCRIPT_FILE = re.compile(r"/|\.(?:py|pyw|js|mjs|cjs|ts|pl|pm|rb|php|sh|bash|zsh)$")

# `-s` tells a shell to read commands from stdin and hand what follows to them
# as positional parameters. It is stdin source however many operands follow.
SHELLS = frozenset({"sh", "bash", "zsh", "dash"})


def _runs_inline_source(util: str, rest: list[str]) -> bool:
    """True when this interpreter's program is on the command line or on stdin."""
    for tok in rest:
        if tok in INLINE_SOURCE_FLAGS:
            return True
        if tok == "-E" and util in DASH_E_IS_SOURCE:
            return True
        if tok == "-m":
            # A module is the program, and what follows are its arguments.
            return False
        # `-pi`, `-ne`: perl and ruby bundle their short flags, and the `e` in
        # the cluster is the one that carries the program.
        if len(tok) > 1 and tok[0] == "-" and not tok.startswith("--"):
            if "e" in tok[1:] or "c" in tok[1:]:
                return True
            continue
        if not tok.startswith("-"):
            if not SCRIPT_FILE.search(tok):
                continue  # an option's operand, not the program
            # A script file. Its own path is executed, not written, and the
            # arguments after it belong to it — `uv run python3 validate.py
            # plugins/core/skills/har` reads that folder, and a gate that
            # called it a write would block the validator.
            return False
    return True  # nothing but flags: the program arrives on stdin


def _reads_stdin_source(util: str, rest: list[str]) -> bool:
    """True when this interpreter's program is piped or heredoc'd into it.

    The program is then in a *different* simple command — `echo "…" | python3`
    splits on the pipe — so the interpreter's own tokens carry no path and
    reading them alone says nothing. It is the whole command text that has to be
    read, which is what the caller does with this.
    """
    if not INTERPRETERS.match(util):
        return False
    for tok in rest:
        if tok == "-":
            continue  # `python3 - <<EOF`: still stdin
        if tok == "-s" and util in SHELLS:
            return True  # read stdin; the operands after it are $1, $2, …
        if tok in INLINE_SOURCE_FLAGS or tok == "-m":
            return False  # the program is named on the command line
        if tok == "-E" and util in DASH_E_IS_SOURCE:
            return False  # perl's `-E` carries the program
        if not tok.startswith("-") and SCRIPT_FILE.search(tok):
            return False
    return True


def _inline_source_targets(text: str) -> list[str]:
    """Skill paths this interpreter source touches other than by reading."""
    return EMBEDDED_PATH.findall(READ_ONLY_USES.sub("", text))


# `git` subcommands that overwrite or delete a path they are given. `git` was
# absent from UTILITIES entirely, so `git restore SKILL.md` and
# `git checkout -- SKILL.md` — the two commands a session reaches for to undo an
# edit — sailed past the gate. Read-only plumbing (`diff`, `log`, `show`,
# `status`, `add`) is deliberately not here.
#
# Known limit: `git apply patch.diff` names the patch, not what it rewrites, so
# the destination is not visible from the command line at all.
GIT_WRITE_SUBCOMMANDS = frozenset({"restore", "checkout", "rm", "clean", "mv", "stash"})

# `git` options that consume the argument after them, so the subcommand is not
# mistaken for their value in `git -C /repo restore …`.
GIT_GLOBAL_OPTS_WITH_VALUE = frozenset(
    {"-C", "-c", "--git-dir", "--work-tree", "--exec-path", "--namespace"}
)


# A backslash-newline is a line continuation: bash removes it and the command
# carries on. Removed here too, before the lexer is told to treat a newline as a
# separator, or `cp SKILL \<newline> /tmp/bak` would split into `cp SKILL` and
# report a *read* of the skill as a write. Inside a quoted heredoc body bash
# would keep the backslash; joining two lines of an interpreter script costs
# nothing, because that text is scanned by regex for paths and write calls
# rather than parsed.
_LINE_CONTINUATION = re.compile(r"\\\n")


def _tokenise(command: str) -> list[str]:
    # `\n` is punctuation rather than whitespace: bash separates commands on an
    # unquoted newline, and dropping it merged
    #     echo starting
    #     rm -rf .claude/skills/specify
    # into one token stream whose first word is `echo` — so the gate looked at
    # `echo`, found no destination, and let the `rm` through. A newline inside
    # quotes still belongs to its token, which is what keeps a heredoc whole.
    lexer = shlex.shlex(
        _LINE_CONTINUATION.sub("", command), posix=True, punctuation_chars="();<>|&\n"
    )
    lexer.whitespace_split = True
    lexer.whitespace = " \t\r"
    try:
        return list(lexer)
    except ValueError:
        # Unbalanced quotes — fall back to a whitespace split rather than
        # letting a malformed command sail past unexamined.
        return command.split()


def _simple_commands(tokens: list[str]) -> list[list[str]]:
    """Split on what bash treats as a command boundary — and only on that.

    `(` opens a subshell only in **command position**; anywhere else it is the
    paren of a call. Splitting on every one of them tore
    `p.write_text(".claude/skills/x/SKILL.md")` into a fragment ending in
    `p.write_text` — which `WRITERS` cannot match, because the regex needs the
    paren adjacent — and a fragment holding only the path, with no write signal
    beside it. The result was not a partial miss: the whole heredoc-into-python
    route, the one the module docstring names as the reason this file exists,
    returned nothing at all.
    """
    out: list[list[str]] = [[]]
    depth = 0
    for tok in tokens:
        if tok == "(" and not out[-1]:
            # Command position: a real subshell.
            depth += 1
            out.append([])
        elif tok == ")" and depth:
            depth -= 1
            out.append([])
        elif tok in SEPARATORS:
            out.append([])
        else:
            # Including a `(` mid-command and its `)`, so the joined text still
            # reads as `write_text ( … )` for the regexes below.
            out[-1].append(tok)
    return [c for c in out if c]


def _git_destinations(rest: list[str]) -> list[str]:
    """Paths a `git` invocation overwrites, or none when the subcommand only reads."""
    i = 0
    while i < len(rest):
        tok = rest[i]
        if tok in GIT_GLOBAL_OPTS_WITH_VALUE:
            i += 2
            continue
        if tok.startswith("-"):
            i += 1
            continue
        break
    if i >= len(rest) or rest[i] not in GIT_WRITE_SUBCOMMANDS:
        return []
    # Everything after the subcommand that is not a flag or the `--` separator.
    # A tree-ish (`git checkout HEAD~1 -- path`) or a branch name lands here too
    # and is harmless: it is not shaped like a skill path, so it never matches.
    return [a for a in rest[i + 1:] if a != "--" and not a.startswith("-")]


def _redirect_targets(cmd: list[str]) -> tuple[list[str], list[str]]:
    """Split a simple command into (redirect destinations, remaining arguments)."""
    dests: list[str] = []
    args: list[str] = []
    i = 0
    while i < len(cmd):
        tok = cmd[i]
        if tok in REDIRECTS:
            if i + 1 < len(cmd):
                dests.append(cmd[i + 1])
            i += 2
            continue
        args.append(tok)
        i += 1
    return dests, args


def _command_head(args: list[str]) -> tuple[str, list[str]]:
    """The utility a simple command runs and its arguments, past any wrapper."""
    pos = 0
    while pos < len(args):
        head = args[pos].rsplit("/", 1)[-1]
        if re.match(r"^\w+=", args[pos]) or head in WRAPPERS:
            pos += 1
        elif (
            WRAPPER_SUBCOMMANDS.get(head)
            and pos + 1 < len(args)
            and args[pos + 1] == WRAPPER_SUBCOMMANDS[head]
        ):
            pos += 2
        else:
            break
    if pos >= len(args):
        return "", []
    return args[pos].rsplit("/", 1)[-1], args[pos + 1:]


def _destinations(cmd: list[str]) -> list[str]:
    """Paths this simple command writes to."""
    dests, args = _redirect_targets(cmd)
    if not args:
        return dests
    util, rest = _command_head(args)
    if not util:
        return dests
    files = [a for a in rest if not a.startswith("-")]

    if util == "git":
        dests.extend(_git_destinations(rest))
    elif util == "sed":
        if any(a.startswith("-i") for a in rest):
            # sed -i 's/…/…/' FILE… — the script is the first non-flag arg.
            dests.extend(files[1:] if len(files) > 1 else files)
    elif util == "dd":
        dests.extend(a.split("=", 1)[1] for a in rest if a.startswith("of="))
    elif util in UTILITIES:
        mode = UTILITIES[util]
        if mode == ALL:
            dests.extend(files)
        elif files:
            dests.append(files[-1])
    elif INTERPRETERS.match(util) and _runs_inline_source(util, rest):
        dests.extend(_inline_source_targets(" ".join(cmd)))
    elif WRITERS.search(" ".join(cmd)):
        # An interpreter gets its script as one argument, so the path is inside
        # a token rather than being one. Scan the text for skill-shaped paths.
        dests.extend(EMBEDDED_PATH.findall(" ".join(cmd)))
    return dests


def bash_target(command: str) -> str:
    cmds = _simple_commands(_tokenise(command))
    # An interpreter whose program arrives on stdin — a heredoc, or the right of
    # a pipe — never has that program beside it: the tokeniser separates on both
    # the newline and the `|`. So the whole command text is what is read. Without
    # this, `echo "…Path('…/SKILL.md').write_bytes(b'x')" | python3` fell back on
    # the WRITERS denylist and went through, while the identical source passed as
    # `-c` was blocked — the same gap this file is being changed to close.
    if INTERPRETER_HEREDOC.search(command) or any(
        _reads_stdin_source(*_command_head(_redirect_targets(c)[1])) for c in cmds
    ):
        for dest in _inline_source_targets(command):
            if SKILL_PATH.match(dest.strip("'\"")):
                return dest
    for cmd in cmds:
        for dest in _destinations(cmd):
            if SKILL_PATH.match(dest.strip("'\"")):
                return dest
    return ""


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, ValueError):
        return 0  # unparseable payload is not this hook's problem — allow
    tool = payload.get("tool_name", "")
    ti = payload.get("tool_input", {}) or {}
    if tool == "Bash":
        print(bash_target(ti.get("command", "") or ""))
    else:
        print(ti.get("file_path", "") or "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
