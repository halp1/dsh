# dsh-plugin-multi-search

Ordered search adapters for DeepSeek Harness. Replaces `dsh-plugin-searxng` with SearXNG and Exa Search adapters and a **Settings > Multi-Search** section.

## Settings

- Edit the SearXNG instance URL or Exa API endpoint.
- Replace or clear the saved Exa API key. Saved keys are never returned to the browser.
- Enable providers and use **Move up** / **Move down** to choose primary and fallback order.
- **Save settings** persists changes on the host. New searches use the saved order immediately.

Providers are tried sequentially on HTTP, network, timeout, malformed response, or engine failures. Valid empty results are not failures. Caller cancellation stops the chain. If all providers fail, the tool reports their failures.

Settings persist in `$DSH_HOME/plugins/multi-search/settings.json` (default `~/.dsh/plugins/multi-search/settings.json`), with atomic private writes. The host may also supply `EXA_API_KEY`. API keys must not be embedded in plugin sources or browser storage.

SearXNG must enable JSON under `search.formats`.

## Install and develop

```sh
pnpm --filter dsh-plugin-multi-search run build
dsh plugin --profile web add file:/Users/halp/code/dsh/plugins/multi-search
```

The bundle activates the host plugin, selects `web.searchProvider: multi-search`, and supplies the browser settings module. File installations copy built files. After edits, rebuild, refresh the profile package, and reconcile the bundle through DSH's plugin manager before refreshing the GUI.

```sh
pnpm --filter dsh-plugin-multi-search test
```

Optional host configuration accepts `settingsFile` (or `stateFile`) and an initial `providers` array. Persisted settings take precedence over initial configuration.

## Add an adapter

1. Implement `SearchAdapter` in `src/adapters`. Supply stable `id`, display name, field metadata, defaults, local availability check, and cancellable `search` returning normalized sources.
2. Register it in `src/adapters/index.ts`.
3. Add response-boundary and fallback regression tests.

Settings fields are rendered from adapter metadata. New adapters appear disabled at the end of existing saved lists. Password fields are redacted from settings responses. Use the shared endpoint validation and transport helpers instead of exposing raw upstream errors.
