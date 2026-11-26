# Privacy policy for the stores

The policy itself is `docs/PRIVACY.md`. It is the single source: both stores
already link to it, so do not copy it here.

**URL to enter in both dashboards**

```
https://github.com/nuncaeslupus/ai-chat-exporter/blob/main/docs/PRIVACY.md
```

The repo has no GitHub Pages site (and the policy renders fine as a GitHub blob
page), so the blob URL is the one to use. If a Pages site is ever added, a
`/privacy` page there would be a nicer URL; update the listing files then.

## What it says, checked against the code (v1.3.1)

| Claim | Where it holds |
|---|---|
| No backend, analytics or telemetry | No `fetch`, beacon or WebSocket in `src/` goes to a host we run. The only `fetch` calls are `src/extension/background/service-worker.ts` (claude.ai API, user's own session) and `src/shared/i18n.ts` (the extension's own bundled `_locales/*/messages.json`). |
| Preferences stay on the device | `chrome.storage.local` only (`src/shared/storage.ts`, `src/core/drift/suppression.ts`). An older `storage.sync` value is migrated to local and deleted. |
| No remote code | No `eval` or `new Function` in `src/` or in the built `dist/` bundles; all scripts ship in the package. |
| Permissions and hosts as stated | `manifests/manifest.base.json`. |
| Firefox data collection "none" | `manifests/manifest.firefox.json` `data_collection_permissions`. |

Re-check this table whenever `permissions`, `host_permissions` or a network call
changes, and update `docs/PRIVACY.md` and its "Last updated" date in the same PR.
