# dsh-plugin-badge

Live PWA app badge for DeepSeek Harness. Whatever puts a circle on a chat row in
the left sidebar puts a unit on the app icon.

```
┌──────────────────────┐
│ ● refactor parser    │  ← needs approval      ╮
│ ● why does CI fail   │  ← awaiting an answer  ├─ badge shows ③
│ ● migrate to v2      │  ← finished, unread    ╯
│   scratch notes      │
└──────────────────────┘
```

## What counts

The count mirrors `ui-workspace`'s own two decisions rather than inventing a
parallel notion of unread.

**Counted** — the dots that mean "something is waiting for you":

| State | Sidebar dot | Source |
| --- | --- | --- |
| Needs tool approval | amber | `uiSession.pendingInteractions` (`approval`) |
| Plan awaiting review | amber | `uiSession.pendingInteractions` (`plan-review`) |
| Agent asked a question | amber | `uiSession.pendingInteractions` (`question`) |
| Finished while you were elsewhere | green | `SessionSummary.completed` |

**Not counted:**

- **Running sessions and running subagents.** A spinning session is work in
  progress, not an item to read; counting it would pin the badge to a non-zero
  number for the whole length of every turn. Opt in with `countRunning`.
- **Rows with no sidebar presence:** subagent-origin sessions (they fold into
  their parent's header catalog), archived sessions, and blank sessions that
  are not the selected New Session row.

A session contributes at most **one** unit, matching the one-dot-per-row
presentation — a session that is both blocked on approval and finished is still
a single thing to deal with.

Opening a session clears its own contribution, because `completed` is
host-owned and already means "finished while not selected and not yet opened".
Pending interactions still count for the session you are looking at: a question
is outstanding until it is answered, and the host drops it the moment it is.

## Where the badge appears

Through the [Badging API](https://developer.mozilla.org/en-US/docs/Web/API/Badging_API)
(`navigator.setAppBadge`), so the number lands on the dock/taskbar icon of the
**installed** PWA — Chrome, Edge, and other Chromium browsers on macOS and
Windows, plus installed web apps on Safari 17+.

In an ordinary browser tab there is usually no icon to badge. Turn on
`mirrorTitle` to get a `(3)` prefix in the page title instead, which shows up in
the tab strip. (Best-effort: the host rewrites `document.title` on session
changes, so the prefix reappears at the next publish rather than persisting
continuously.)

A browser without the API is a degraded surface, never an error — the plugin
stays loaded and keeps counting.

## Install

```bash
dsh plugin --profile web add file:/path/to/dsh-plugin-badge
```

Then restart `dsh web` and reload the page.

## Settings

Per-device (they live in `localStorage` under `dsh.badge.settings`), because
whether a badge is visible at all depends on whether *this* browser installed
the app. Change them from the devtools console:

```js
__dshBadge__.settings()                      // read current
__dshBadge__.configure({ mirrorTitle: true }) // tab-title fallback
__dshBadge__.configure({ countRunning: true })// include running sessions
__dshBadge__.configure({ enabled: false })    // off; clears the badge
__dshBadge__.count                            // what is published now
__dshBadge__.supported                        // can this browser badge?
```

| Key | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | Master switch; `false` clears the badge immediately |
| `countAttention` | `true` | Count approval / plan-review / question |
| `countCompleted` | `true` | Count the finished-unread reminder |
| `countRunning` | `false` | Count running sessions and running subagents |
| `mirrorTitle` | `false` | Also prefix the page title with `(n)` |

## How it works

Three host observables decide whether a row shows a dot, so the watcher binds
all three: `sessions.list` (the `completed` bit and the selection),
`workspaces.list` (the archive set — archiving a finished session removes its
row), and `uiSession.pendingInteractions` (approval/question state, which is
pure browser-side and never appears in a session summary). Any notification
recomputes the count in one pass over the id list.

Session snapshots invalidate on every stream frame, so the publish path
deduplicates: a count equal to the last published value never reaches the
platform. A streaming turn therefore issues zero badge calls until the number
actually changes.

## Development

```bash
pnpm install
pnpm test    # 50 tests, no DOM required
pnpm build   # tsc -b && tsdown  → lib/index.js + lib/client.js
```

The browser half is built as the closure-factory artifact the DSH client module
system loads (`window.__ModuleLoader__.load({id, factory})`), with the platform
seed kept external and a build-time purity gate rejecting cross-plugin value
imports. See `tsdown.config.ts`.

## License

MIT
