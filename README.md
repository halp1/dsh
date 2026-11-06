# dsh-plugins

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), in one pnpm workspace.

| Plugin | Build step |
| --- | --- |
| [auto-limit](plugins/auto-limit) | none |
| [background](plugins/background) | tsdown |
| [badge](plugins/badge) | tsdown |
| [jev-reviewer](plugins/jev-reviewer) | none |
| [latex](plugins/latex) | none |
| [mcp-discovery](plugins/mcp-discovery) | none |
| [mini-window](plugins/mini-window) | tsdown |
| [open-in-editor](plugins/open-in-editor) | none |
| [quickswitcher](plugins/quickswitcher) | tsdown |
| [searxng](plugins/searxng) | none |
| [ui-patches](plugins/ui-patches) | none |
| [usage-billing](plugins/usage-billing) | tsc and tsdown |
| [wakatime](plugins/wakatime) | none |
| [wco](plugins/wco) | none |
| [workspace-recency](plugins/workspace-recency) | tsdown |

## Develop

```sh
pnpm install
pnpm build                                   # every plugin with a build step
pnpm test                                    # every plugin
pnpm --filter dsh-plugin-badge run test      # one plugin
```

## Shared configuration

- `pnpm-workspace.yaml` holds the dependency catalogs. Shared tools use `catalog:`. Every `@deepseek-ai/dsh-*` dev dependency uses `catalog:dsh`, pinned to the host version. Upgrading the host means editing that one list.
- `tsconfig.base.json` is the strict compiler base the TypeScript plugins extend.
- `tsdown.plugin.ts` builds the node half and the browser closure-factory half that the DSH client module loader expects. A plugin's `tsdown.config.ts` only names its id and client entry.

Runtime `dependencies` and `peerDependencies` keep plain semver ranges, because the DSH profile installs each plugin by path outside this workspace.

## Install into a DSH profile

The `web` profile installs each plugin from its directory, for example

```json
"dsh-plugin-badge": "file:/Users/halp/code/dsh/plugins/badge"
```

`file:` installs copy the package, so run `pnpm build` here and `pnpm install` in the profile after changes.
