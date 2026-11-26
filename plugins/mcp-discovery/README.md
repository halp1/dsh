# On-demand MCP and plugin tools for DSH

Keeps native tool registrations in the host, but exposes on-demand schemas only after a chat selects them. MCP namespaces, plugin tool-name prefixes, and individual tools can be configured in **Settings > Tool Discovery**.

## Tool policies

- **Visible** exposes a tool normally.
- **On-demand** hides its schema until selected through `search_mcp_tools` and `select_mcp_tools`.
- **Blocked** removes it from discovery and declarations, and denies execution even if it was previously selected.

Browser tools matching `dsh_browser_` default to On-demand. Other plugin tools remain Visible unless configured. The bundled MCP namespaces are `rea` and `gworkspace`. Existing profile overrides remain supported.

Exact tool overrides win over the longest matching prefix rule. Prefix rules win over the MCP namespace list. Unmatched tools are Visible. The discovery controls themselves cannot be targeted by policy rules, preventing accidental settings lockout.

These policies do not replace native permissions, approvals, scope restrictions, read-only checks, cancellation, or output validation. Turning off this plugin removes its filtering and execution guard, so this is not an independent security sandbox.

## Install and build

Tested with DSH `0.2.2-rc.1` and its native executor.

```sh
pnpm --filter dsh-plugin-mcp-discovery build
dsh plugin --profile web add file:/Users/halp/code/dsh/plugins/mcp-discovery
```

The package ships built node and browser artifacts. Reinstall an already installed local package through DSH's plugin manager to deploy updated artifacts, then refresh the existing GUI. No replacement web server is needed.

## Settings panel

Open **Settings > Tool Discovery** after refreshing DSH. Configure MCP namespace modes, prefix rules, exact tool overrides, and the maximum selected tools per chat. Changes apply after **Save settings** without restarting DSH. **Discard changes** restores the last loaded snapshot. Conflicting saves are rejected and can be reloaded instead of overwriting another editor's changes.

Settings are stored in `DSH_HOME/plugins/mcp-discovery/settings.json`, defaulting to `~/.dsh/plugins/mcp-discovery/settings.json`. The authenticated settings route uses `connection.fetch`. Saved policies take precedence over profile defaults. Headless profiles load this file only when an explicit `settingsFile` is configured.

Profile configuration is also supported:

```yaml
- id: mcp-discovery
  config:
    servers: [rea, gworkspace]
    maxSelectedTools: 16
    prefixes:
      - prefix: dsh_browser_
        mode: on-demand
      - prefix: widget_
        mode: on-demand
    tools:
      - name: widget_delete
        mode: blocked
```

An empty `servers` or `prefixes` array disables that default group. Rules match literal case-sensitive prefixes, not regular expressions or globs.

## How the agent uses it

1. `search_mcp_tools({query: "gmail search messages"})` returns short schema-free summaries. Omit query to list catalogs, use `server` to browse MCP tools, or use `prefix: "dsh_browser_"` to browse browser tools. The default page size is 5 and maximum is 10. Use `offset` to page.
2. `select_mcp_tools({action: "add", names: ["dsh_browser_snapshot"]})` selects an exact on-demand name. Its original native schema appears in the next model request.
3. Call selected tools normally. Selection neither runs the underlying tool nor approves an action.
4. Use `remove`, `replace`, or `status` to manage the chat's working set. `replace` with `names: []` clears it. Invalid or overflowing requests make no partial changes and do not automatically evict tools.

Search performs local deterministic matching. Catalog descriptions are untrusted data. Blocked and scope-restricted tools do not appear in search results. Visible tools do not need selection.

## Sessions and lifecycle

Selections are isolated per session, including independent child agents. Fresh forks do not inherit activation. Successful selection snapshots persist through the normal tool result's non-model metadata. Restoration verifies the original owned call and ignores compaction replacement copies.

Current schemas come from the live restricted registry. Removed or revoked tools cannot be called through a stale executable closure. Policy changes are checked again during assembly and execution, including for saved selections. Lowering `maxSelectedTools` below a saved working set fails explicitly. Raise the limit before resuming and clearing that set.

The plugin wraps the public `systemPrompt.assemble()` result with a lifecycle-owned filter. It preserves scoped executors and step admission, restores the method on disposal, and does not replace registrations or transport connections. Original MCP guidance is shown only while a tool from that server is exposed.

Only native tool presentation is supported. PTC or hybrid scopes with managed tools fail rather than exposing a generated SDK. Existing messages and tool results are not erased, so use a fresh chat for the cleanest context reduction. Schema byte counts are serialized UTF-8 sizes, not exact token counts.

## Tests

```sh
pnpm --filter dsh-plugin-mcp-discovery test
```

Tests use synthetic native registrations against the installed DSH runtime. Set `DSH_TEST_RUNTIME=/path/to/dsh/package.json` to test another installation. Coverage includes policy precedence, browser and plugin discovery, blocked execution, native restrictions and approvals, cancellation, selection isolation and restoration, compaction, registry refresh, lifecycle disposal, schema projection, private atomic persistence, stale saves, malformed settings, and authenticated-route integration.

## Rollback

Disable the discovery row in the profile patch, or disable the bundle in DSH's plugin manager:

```yaml
- id: mcp-discovery
  disabled: true
```

Disabling restores eager exposure and removes this plugin's block guard while leaving original registrations intact. Saved settings remain on disk.
