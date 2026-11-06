# On-demand MCP tools for DSH

Keeps configured MCP catalogs in the existing host registry, but sends a model only the native tool schemas selected for its own chat. Fresh chats get two small discovery tools instead of the REA and Google Workspace catalogs.

No MCP server, connection, credential, provider adapter, or installed DSH package is replaced. Schema visibility is not a permission grant: original restrictions, approvals, plan-mode checks, cancellation, output contracts, native images, and tool identities remain in the original execution pipeline.

## Install / configuration

Tested with DSH `0.2.2-rc.1` and its native tool executor. Legacy runtimes exposing `ToolRuntime.modeFor()` are also recognized.

```sh
dsh plugin --profile web add file:/Users/halp/code/dsh/dsh-plugin-mcp-discovery
```

The included bundle enables discovery for `rea` and `gworkspace`. Override the `mcp-discovery` row in your profile's `cordis.patch.yml`:

```yaml
- id: mcp-discovery
  config:
    servers: [rea, gworkspace]
    maxSelectedTools: 16
```

Other servers, including n8n and Google Tasks, are unchanged. Servers are local `serverName` values, not URLs. Namespaces with double underscores are not accepted because their public prefixes are ambiguous. Catalog fetch/connection startup is still eager; **model context exposure** is on demand.

A live profile patch/plugin reload or restarting your existing DSH host applies host changes. No frontend rebuild or separate web server is necessary for this server-only plugin. If package installation does not remount a live plugin, explicitly add/reload its profile row or restart that host.

## How the agent uses it

1. `search_mcp_tools({query: "gmail search messages"})` returns at most 5 short summaries by default, no schemas. Maximum page size 10; use `offset` to page. Omit query to summarize servers, or specify `server` to browse one catalog.
2. `select_mcp_tools({action: "add", names: ["mcp__gworkspace__search_gmail_messages"]})` selects the exact native tool. Its full schema appears in the **next** model request; the selection result does not duplicate it.
3. Call the selected MCP tool normally. It still needs the user's authorization for any actual action, and original policy still applies.
4. Use `remove`, `replace`, or `status` to manage the working set. `replace` with `names: []` clears it. Overflow/unknown-name requests make no partial changes. No tools are automatically evicted.

Search uses deterministic local name/description matching. It makes no LLM, embedding, or MCP operation calls. Server descriptions remain untrusted data, not executable instructions. A selected tool's original server guidance is included while that server is active; unrelated server guidance stays hidden.

## Sessions, persistence and updates

Selections are isolated per session, including independently scoped child agents. Fresh forks do not inherit a parent's activation state. Existing eager request headers are never interpreted as a selection.

Selected names are persisted in the normal successful selection tool result's **non-model presentation metadata**. This avoids adding unknown event types, changing the session format, or writing a separate state file. Restoration verifies the original owned call and ignores compaction replacement copies. The in-memory selection is committed only when the native pipeline accepts the original candidate, not after cancellation, blocking, or a substituted result.

Plugin restart / same-session resume restores the latest accepted snapshot, even after result compaction. Current schemas always come from the live restricted registry; there are no cached executor closures. Previously selected removed tools are reported unavailable. Revoked capabilities remain hidden and cannot be reselected. Lowering `maxSelectedTools` below the latest saved working set fails explicitly; restore the previous limit before resuming and clearing that set.

The plugin supports **native** presentation only. PTC / hybrid scopes with managed tools fail clearly rather than silently sending a full generated SDK.

DSH now owns tool declarations outside the prompt presentation waterfall. The plugin installs a lifecycle-owned wrapper around the public `systemPrompt.assemble()` method to filter its completed result. It preserves the original receiver, scoped executor and step admission, restores the method on disposal, and does not replace executors or modify the tool registry.

## Context savings and limitations

Only selected declarations plus the two small discovery definitions are sent. Byte counters use serialized UTF-8 schema bytes, **not exact tokens**. Prompt caching can reduce repeated processing costs but does not remove eager schemas from the context window; this plugin removes their declarations before provider request projection.

Existing messages/results already in a conversation are not erased. Start a fresh chat for the cleanest reduction. Turning this plugin off restores eager behavior; it does not remove the servers.

There is no new UI panel in this release. The agent gets concise instructions and uses the discovery controls automatically. Tool selection is not an independent security sandbox or a replacement for the user's permissions.

## Tests

```sh
npm test
```

Tests import the installed DSH runtime under the active Node installation and use synthetic native tools, not live Google operations or REA targets. For a different runtime location:

```sh
DSH_TEST_RUNTIME=/path/to/dsh/package.json npm test
```

Coverage includes cold request assembly and provider history projection, exact schema selection, permissions and approval denial, cancellation, session/fork isolation, resume, post-policy replacement, compaction, catalog refresh, image projection, limits, reload/disposal, and serialized-byte accounting.

## Rollback

Disable the row in the profile patch:

```yaml
- id: mcp-discovery
  disabled: true
```

Reload the profile / restart the existing host. Removing the plugin package is optional; disabling it removes both controls, filtering, and its guard while leaving all original MCP registrations intact.
