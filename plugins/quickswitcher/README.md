# dsh-plugin-quickswitcher

Press **Cmd+K** (macOS) or **Ctrl+K** (Windows, Linux) anywhere in the
DeepSeek Harness Web GUI to jump to a session or workspace.

- With an empty query you get the sessions you opened most recently, then
  every workspace. Cmd+K then Enter takes you back to the previous session.
- Typing fuzzy-matches session titles and the workspace a session belongs
  to. Space-separated words must all match, so `web login` finds the login
  session in the webapp workspace.
- Workspaces match only when their name contains what you typed as an
  unbroken piece (`cs` finds `cs173` and `docs`, not `claude-sonnet`).
  Paths are not searched.
- After a short pause, a **Messages** section lists sessions whose messages
  contain the query. This uses the same host index as sidebar search, which
  the Web app ships switched off. To turn it on, add this to the profile's
  `cordis.patch.yml`:

  ```yaml
  - id: session-query-sqlite
    config:
      openAt: first-search
  ```

  While it is off, the switcher stops asking after the first refusal and
  shows no Messages section.

| Key | Action |
| --- | --- |
| Up, Down (or Ctrl+P, Ctrl+N) | Move the highlight |
| Enter | Open the highlighted row |
| Escape, or Cmd/Ctrl+K again | Close |

Matching workspaces list first. Choosing one opens a New Session in it, the
same as picking the workspace from the sidebar's add menu: its blank session
is reused, with any unsent draft kept.

## Install

```bash
pnpm install && pnpm build
dsh plugin --profile web add file:/Users/halp/code/dsh/plugins/quickswitcher
```

Then reload the page. pnpm installs `file:` dependencies as a copy, so rebuild
and run the same command again after editing the source.

## How it works

Everything runs in the browser half (`src/client`). The node half is an
empty row that makes the host serve the client bundle.

- **Key.** The shortcut service rejects plain Mod+K as a Web default, so the
  plugin registers it as a *fixed* action (`registerFixed`) and listens
  through `observeFixedInput`, the same route the built-in font-size keys
  use. The binding shows up in the shortcut reference as "Quick switcher".
  It is ignored inside the terminal (where Cmd+K clears and Ctrl+K kills the
  line), while an IME is composing, and while another dialog is open.
- **Surface.** A `shell.overlay` entry renders the primitives `Modal`, tagged
  `shortcutModal="quickswitcher"` so a second Cmd+K can close it.
- **Data.** Rows come from `ctx.sessions.list` and `ctx.workspaces.list`.
  Subagent rows, blank placeholders, archived sessions, and the open session
  are left out. Content search calls `ctx.sessions.search` 250 ms after you
  stop typing and aborts superseded requests.
- **Navigation.** `ctx.uiWorkspace.openSession` and `startSession`, the
  sidebar's own actions.
- **Recency.** Every session that becomes the main view is recorded in
  `localStorage` under `dsh.quickswitcher.recent`, per device, capped at 50.

On DSH Desktop the fixed Mod+K reservation conflicts with the built-in
"Search sessions" default (Desktop Mod+K), which then stays unbound. Web's
sidebar search stays on Mod+Alt+K.

`window.__dshQuickSwitcher__` exposes `open()`, `close()`, and `recent()`
for the devtools console.

## Layout

- `src/client/items.ts`: candidate filtering and ranking
- `src/client/match.ts`: fuzzy matcher with highlight ranges
- `src/client/content-search.ts`: debounced, abortable content search
- `src/client/recent.ts`: recently opened sessions
- `src/client/trigger.ts`: which keydowns toggle the switcher
- `src/client/switcher.tsx`: the dialog
- `src/client/index.ts`: wiring
- `tests/`: `pnpm test`
