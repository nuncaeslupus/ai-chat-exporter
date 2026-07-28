# Build Instructions

Reproduce the built extension from this source tree.

## Requirements

- Node.js >= 18.0.0
- pnpm 10.27.0 (`npm install -g pnpm@10.27.0`)

## Steps

```bash
pnpm install
pnpm build
```

## Output

- `dist/chrome/` — unpacked Chrome extension
- `dist/firefox/` — unpacked Firefox extension

`pnpm build` runs `build:chrome` and `build:firefox`, each of which first
runs `build:content` (compiles the parser/exporter bundle shared by both
targets) and then bundles the browser-specific manifest and background/popup
scripts with Vite.
