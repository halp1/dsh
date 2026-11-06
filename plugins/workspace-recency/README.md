# dsh-plugin-workspace-recency

Sorts the DeepSeek Harness sidebar by most recent activity:

- **Workspace folders**: the project you touched last sits on top.
- **The Ungrouped folder**: ranked among the workspaces by its newest
  session, instead of always sitting last.
- **Sessions inside Ungrouped**: newest first, even when the sidebar is in
  its *Manual* order mode.

```
  host manual order            with this plugin
┌──────────────────────┐     ┌──────────────────────┐
│ ▸ aops               │     │ ▸ dsh          2m ago│
│ ▸ dsh                │ ──▶ │ ▸ website      1h ago│
│ ▸ notes              │     │ ▸ aops         3d ago│
│ ▸ website            │     │ ▸ notes        2w ago│
│ ▸ Ungrouped          │     │ ▸ Ungrouped          │
└──────────────────────┘     └──────────────────────┘
```

## What counts as activity

A workspace's activity time is the **newest `updatedAt` among the sessions you
can actually see in that group**. Two kinds of rows are skipped, because
neither represents work you did:

| Row | Counted | Why |
| --- | --- | --- |
| An ordinary session | ✅ | `SessionSummary.updatedAt` — the same field the sidebar sorts sessions by |
| A blank *New Session* placeholder | ❌ | Opening a fresh row is not activity; it would float an untouched workspace to the top |
| An archived session | ❌ | It has no sidebar presence, so it gets no influence |

A workspace with no qualifying session falls back to its own `createdAt`, so a
folder you just adopted lands near the top where you put it rather than at the
bottom among stale projects.

**Ties keep your manual order.** The sort is stable, so whenever activity
cannot separate two workspaces, the order you arranged by hand survives.

## Ungrouped

**The folder.** Ungrouped is ranked like one more workspace whose activity is
its newest visible session (blank, archived, and subagent rows are skipped).
Ties go to the workspace. The sidebar always builds Ungrouped after every
workspace, so the plugin moves it with an injected stylesheet (CSS `order` on
the folder sections). React's DOM is not touched, so drag-and-drop, row
animations, and keyboard focus keep working. Screen readers still announce
Ungrouped last, since visual order is the only thing that changes.

**The sessions inside it.** The sidebar's *Order by* menu has two modes:

- *Last updated*: every folder, Ungrouped included, is already newest
  first, so the plugin does nothing.
- *Manual*: every folder follows a saved browser-local order. Dragging any
  session switches the sidebar into this mode, which is the usual reason
  Ungrouped looks stale (a 13-day-old row stuck at the top). The plugin shows
  Ungrouped newest first anyway and leaves workspace folders in their manual
  order.

The plugin does not write the saved manual order itself. Turn the setting off
and your arrangement comes back. One caveat: when you open a New Session, the
sidebar re-saves the orders it is displaying, which can store the newest-first
Ungrouped order. Dragging a row inside Ungrouped has no lasting effect while
the setting is on, since recency decides the position.

## Your manual order is never overwritten

This is a **view**, not a mutation. The plugin decorates the browser's
workspace snapshot; it never calls `insertBefore` and never writes to the host.
Consequences worth knowing:

- Disabling the plugin brings your hand-arranged order straight back, intact.
- The ordering is **per-device** — a second browser on the same profile still
  shows the manual order unless it also runs this plugin.
- **Drag-and-drop still writes through** to the host's stored order. While
  sorting is on you may not see the row stay where you dropped it, because
  activity decides the position. Turn sorting off to rearrange by hand.

## Install

```bash
dsh plugin --profile web add file:/path/to/dsh-plugin-workspace-recency
```

Then restart `dsh web` and reload the page.

## Settings

Per-device (they live in `localStorage` under
`dsh.workspaceRecency.settings`), because the sort is a local view over host
state. Change them from the devtools console:

```js
__dshWorkspaceRecency__.settings()                     // read current
__dshWorkspaceRecency__.order                          // workspace ids, in render order
__dshWorkspaceRecency__.ungroupedAfter                 // workspace ids above Ungrouped
__dshWorkspaceRecency__.configure({ moveUngroupedFolder: false })
__dshWorkspaceRecency__.configure({ enabled: false })  // restore manual order
__dshWorkspaceRecency__.configure({ pinCurrent: true })// keep the open one on top
```

| Setting | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | Master switch; `false` turns every part off |
| `pinCurrent` | `false` | Keeps the folder holding the open session first, regardless of activity |
| `sortUngroupedSessions` | `true` | Newest-first sessions inside Ungrouped in *Manual* mode |
| `moveUngroupedFolder` | `true` | Rank the Ungrouped folder by activity instead of always last |

Other plugins can read the same face through the `workspaceRecency` cordis
service.

## How it works

The sidebar renders workspace groups by walking the workspace array in order
(`deriveGroups` → `groupByWorkspace` in `@deepseek-ai/dsh-client-ui-workspace`),
so ordering the array is enough to order the UI.

That array reaches the sidebar through the `useWorkspaces` root standard hook,
which `ui-workspace` publishes once at apply time:

```js
ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list } })
```

Root hook names must be globally unique — a second contribution under the same
name throws `duplicate root standard hook` and takes boot down — so a plugin
**cannot** re-provide `useWorkspaces`. What it can do is decorate the object
that contribution captured: `workspaces.list` is the `ClientWorkspaceModel`
instance, its `getSnapshot`/`subscribe` live on the prototype, and React calls
them through dynamic dispatch. Shadowing them with own properties reroutes
every existing and future reader regardless of plugin load order, and `delete`
restores the originals exactly.

Two details that keep this safe:

- **Snapshot identity is cached.** `useSyncExternalStore` tears or loops
  forever if `getSnapshot()` returns a fresh object each call, so the wrapper
  returns the identical reference until the order really changes — and hands
  back the upstream snapshot itself when the order is unchanged.
- **Notifications stay honest.** Session snapshots invalidate on every stream
  frame, but almost none reorder anything. A session-driven wake-up is
  forwarded only when the resulting order actually differs, so typing in a chat
  does not re-render the sidebar tree.

## Development

```bash
pnpm install
pnpm test     # 78 unit tests, no DOM required
pnpm build    # tsc -b + tsdown, emits lib/index.js and lib/client.js
```

The ordering rules live in `src/client/activity.ts` as pure functions, so they
are tested without a browser. The live wiring is split by surface:
`sorter.ts` (workspace order), `ungrouped.ts` (sessions inside Ungrouped, via
the ui-workspace view store), and `folder.ts` (the Ungrouped folder's
position). Requires DSH 0.2; the open session is read from
`retainedBy.mainView`, with a fallback to 0.1's `list.current`.

## License

MIT
