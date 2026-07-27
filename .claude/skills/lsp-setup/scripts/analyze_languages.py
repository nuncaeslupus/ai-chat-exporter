#!/usr/bin/env python3
"""analyze_languages.py — analyze a project root for LSP-eligible languages.

Scans the given directory for well-known language manifest files at the
root and prints a JSON array of detected languages to stdout. Stdlib
only. The script does not install, write, or modify anything — it only
reports what is present.

Output schema (stdout):

    [
      {"language": "python", "manifest": "pyproject.toml"},
      {"language": "go", "manifest": "go.mod"}
    ]

Exit codes: 0 success (including empty result), 2 usage / internal error.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# language -> ordered list of manifest patterns; first match wins.
# Literal patterns are looked up at the project root. Glob patterns
# (containing "*") are evaluated against the root and a small set of
# common source subdirectories — see GLOB_SEARCH_DIRS — so projects
# that keep sources under src/ or lib/ are still detected when no
# root-level manifest exists.
GLOB_SEARCH_DIRS: tuple[str, ...] = (".", "src", "lib", "app")
MANIFESTS: dict[str, list[str]] = {
    "python": [
        "pyproject.toml",
        "setup.py",
        "setup.cfg",
        "requirements.txt",
        "Pipfile",
        "uv.lock",
    ],
    "typescript": ["tsconfig.json"],
    "javascript": ["package.json"],
    "go": ["go.mod"],
    "rust": ["Cargo.toml"],
    "ruby": ["Gemfile", "Rakefile", ".ruby-version"],
    "java": ["pom.xml", "build.gradle"],
    "kotlin": ["build.gradle.kts", "*.kt"],
    "scala": ["build.sbt"],
    "csharp": ["*.csproj"],
    "fsharp": ["*.fsproj"],
    "php": ["composer.json"],
    "elixir": ["mix.exs"],
    "erlang": ["rebar.config"],
    "ocaml": ["dune-project"],
    "haskell": ["*.cabal", "stack.yaml"],
    "swift": ["Package.swift"],
    "dart": ["pubspec.yaml"],
    "lua": [".luarc.json"],
    "c": ["*.c"],
    "cpp": ["compile_commands.json", "*.cpp", "*.cc", "*.cxx"],
    "html": ["*.html"],
    "css": ["*.css", "*.scss"],
    "vue": ["*.vue"],
    "svelte": ["*.svelte"],
}


def _match(root: Path, pattern: str) -> str | None:
    if "*" in pattern:
        for subdir in GLOB_SEARCH_DIRS:
            base = root / subdir if subdir != "." else root
            if not base.is_dir():
                continue
            matches = sorted(p for p in base.glob(pattern) if p.is_file())
            if matches:
                hit = matches[0]
                return hit.name if subdir == "." else f"{subdir}/{hit.name}"
        return None
    candidate = root / pattern
    if candidate.is_file():
        return pattern
    return None


def analyze(root: Path) -> list[dict[str, str]]:
    found: list[dict[str, str]] = []
    for language, patterns in MANIFESTS.items():
        for pattern in patterns:
            hit = _match(root, pattern)
            if hit is not None:
                found.append({"language": language, "manifest": hit})
                break
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "root",
        nargs="?",
        default=".",
        help="Project root to analyze (default: current directory).",
    )
    args = parser.parse_args()
    root = Path(args.root).resolve()
    if not root.exists():
        print(f"analyze_languages: root {root} does not exist", file=sys.stderr)
        return 2
    if not root.is_dir():
        print(f"analyze_languages: root {root} is not a directory", file=sys.stderr)
        return 2
    result = analyze(root)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
