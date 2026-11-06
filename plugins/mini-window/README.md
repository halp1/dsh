# DSH Mini Window

A macOS floating mini chat for DeepSeek Harness. An installed DSH plugin starts a hidden Electron accessory companion: summon it over another application, resume a real DSH session, or start a new one.

## Controls

- **Command+Shift+Space:** global show/hide toggle (configurable).
- **Command+N:** new chat in the current mini workspace, only while the companion is focused.
- **Command+W:** hide the window; **Command+,** opens mini settings.
- **Escape:** dismiss the picker/settings first, otherwise hide. Existing composer menus keep first refusal.
- Close button hides rather than destroying the window. Running agents continue.
- Compact mode is just the input pill, with no surrounding toolbar or frame. Drag its top padding to move it. Use **Expand Window** in the macOS menu/menu-bar icon, or double-click empty pill padding, to open the full conversation.
- Drag the header in expanded mode. **Expanded mode is natively resizable** with a 440×360 minimum; compact mode is fixed. Your expanded size is retained when collapsing, dragging the compact window, or reopening.
- History button opens a keyboard-navigable existing-session picker. Search titles/workspaces immediately; message search uses the host's session-query index if enabled.
- Click the title/workspace label to start a chat in a different workspace. New chat does not silently change the directory of an existing agent.
- The macOS menu-bar icon also provides Show, Expand/Collapse Window, Hide, New Chat, Settings, and Quit. Compact mode keeps Cmd+N/W/comma and these native controls available without another visible toolbar.

## Install locally

Prerequisites: macOS, Node 22.19+ (Node 26 used for development/tests), and DSH 0.2.0-rc.2's **web** profile. The DSH server must run on this Mac: the companion runs on the host machine, not on a remote browser client.

From this package:

```sh
npm install --ignore-scripts
npm run build
dsh plugin --profile web add file:/absolute/path/to/dsh-plugin-mini-window
dsh plugin --profile web exec install-electron
```

The last command downloads Electron into the **active profile** when it is missing. `npm run setup:electron` installs the source package's development runtime; a file-install into a profile has a separate dependency location, so use the profile command above for the installed plugin. Do not assume that adding the npm package has downloaded its binary.

For a newly installed plugin, open **Settings → Mini Window** after the profile has loaded it. For updates to an **already-installed plugin**, host-side changes require restarting the existing `dsh web` server; frontend refresh or **Restart companion** alone does not load new host routes. Restart the existing server on its current port, then refresh the GUI and reopen/restart the companion. Do not start a replacement server on another port.

Package version is **0.1.1**. The human restarted the existing server at `http://127.0.0.1:3080`; the updated mini-default workflow is now live. The installed UI obtains model choices through the existing public `remote.session.modelCatalog()` RPC, injected as `remote.session`, rather than requiring the optional catalog HTTP route. The real Gemini/High test and companion restart/show checks below completed without starting a replacement server.

## Settings

The Mini Window settings section exists in both the normal DSH GUI and the companion.

- Enable/disable the companion.
- Set an Electron accelerator such as `Command+Shift+Space` or `Command+Option+Space`.
- Under **New mini chats**, choose a mini-only **Default model** from the live provider/model catalog. **Use main DSH default** clears the override without saving or changing the main default.
- Choose **Reasoning** only when the selected model advertises supported efforts; **Model default** leaves that effort unspecified. No unrelated global speed/verbosity settings are exposed.
- **Save mini defaults**, then use **Command+N**. Existing sessions and history retain their current selections. Unavailable saved models/settings are labeled and cannot be saved as valid selections; **Refresh models** retries catalog loading.
- Inspect runtime and shortcut-registration status.
- Show, restart, or quit the companion without changing DSH sessions.

A new global shortcut is registered **before** releasing the old one. An occupied shortcut leaves the previous binding and saved setting intact. Standard Command+N/W/Q combinations remain local app commands. If another application already owns the initial shortcut, the menu-bar icon can still open the window so you can change it.

Optional host configuration on the `mini-window` Cordis row:

```yaml
config:
  # An installed bare Electron executable, NOT a packaged DSH app executable:
  electronPath: /absolute/path/to/Electron.app/Contents/MacOS/Electron
  # Optional relocation of the private state document:
  stateFile: ~/.dsh/plugins/mini-window/state.json
```

`ELECTRON_PATH` is also honored. Runtime discovery never imports Electron's lazy-download entry during plugin activation. Missing runtime, failed loads, crashes, and shortcut conflicts have actionable status; there is no automatic restart storm.

## Real DSH behavior

The companion loads the existing authenticated DSH frontend. A mini-only higher-priority root registration renders the public `conversation.content` factory, with the real chat view and composer. The normal GUI keeps its usual root/layout. No DSH core files are patched, no second DSH server is started, and no parallel chat database exists.

Messages, selected models, tool execution, attachments, history pagination, send/stop controls, and approval/question/plan takeovers use DSH's existing services. Different browser renderers have separate editors: unsent drafts stay local to each window and are **not live-synchronized**. Hiding preserves the mini editor; quitting/restarting the companion does not promise draft persistence. On startup, the last session/workspace is restored; unavailable/archived sessions fall back to a workspace chooser or new chat. A main-window blank may be reused only when no mini model override is configured. Configured mini defaults create a distinct new canonical DSH session; they do not rewrite a restored session.

Message-content search requires the deployment's session-query index. The current development deployment configures `openAt: never`; title/workspace search remains usable and a notice explains the unavailable content search. The plugin does not change that deployment setting.

Voice controls appear only if the DSH voice plugin supplies them. Audio access requires an explicit native confirmation followed by macOS microphone consent; camera and unrelated permissions are denied.

The normal frame's global toast/overlay layer is not mounted in the mini shell. Session/connection failures are reported locally, while composer takeovers remain supported. Both mini modes hide accessory composer docks (for example an installed billing bar) to keep a single clean surface. These docks remain available in the normal DSH GUI; the actual composer and approval takeovers are unchanged.

### Mini-only model creation

Mini defaults are saved independently in private mini state as a nullable provider/model selection with an optional advertised reasoning-effort ID. New-chat creation waits for this client's queued preference saves, then fetches fresh server state; a failed refresh stops creation rather than silently ignoring the configured defaults. With a configured selection, the host revalidates its provider/model/effort against the live catalog and rejects unavailable choices.

The host prepares a new session through public SessionStorage and SessionPersistence services, appends the canonical `model/selection` event, flushes and closes its persistence handle, then asks the ordinary core session controller to create/open that session. The core still owns the agent. There is no private API, core patch, separate agent, or `selectModel`/global-default save call. Existing refs/history are untouched.

## Storage and security

Versioned private JSON state lives at `$DSH_HOME/plugins/mini-window/state.json` (or `~/.dsh/...`). It stores shortcut/enablement, window bounds, expanded size, last session/workspace IDs, and mini-only default provider/model/reasoning selection—not chat contents or authentication URLs. Writes are atomic and revision checked. The Electron user-data directory is private and profile isolated; Chromium keeps the companion's authenticated cookie there.

The client receives a public catalog-loader callback through `HostClient` and the exact `remote.session` injection, using `ClientRemote` from `@deepseek-ai/dsh-api-remotes`. It does not select models or save global defaults through that callback. Host routes are registered through DSH's authenticated `connection.fetch` channel:

- `GET/POST /api/dsh-mini-window.state`
- `POST /api/dsh-mini-window.command`, accepting only show/hide/restart/quit
- `GET /api/dsh-mini-window.models`, an optional catalog fallback; the installed UI primarily uses public `remote.session.modelCatalog()` RPC
- `POST /api/dsh-mini-window.chat`, accepting a workspace ID and creating a new mini chat with the server's saved mini defaults

The optional catalog GET initially failed with HTTP 400 because its route lacked buffered request-body handling. Source now marks all four routes buffered, but the running host still caches the older optional GET until the next normal server restart. Its HTTP 200 response is **not verified**. The installed UI's public RPC catalog path and buffered chat POST were actually exercised successfully; no additional restart is needed for the primary user workflow.

Bootstrap authentication is passed over private child stdin, not arguments/logs/API responses. Renderer Node integration is disabled; context isolation, sandboxing, and web security remain enabled. A narrow versioned preload bridge validates the main frame and exact DSH origin. Navigation/popups are restricted; explicitly clicked external HTTP(S) links open in the normal browser. Secrets are sanitized from errors and Electron diagnostics are not exposed.

The host owns the child lifecycle, and parent shutdown/disposal releases shortcuts and stops the companion. It is an always-on-top ordinary app window, not a way to cover protected OS dialogs, secure windows, or exclusive fullscreen surfaces.

## Development and verification

```sh
npm run typecheck
npm run build
npm test
```

Tests cover state validation/revisions, atomic private persistence, authenticated route contracts, child startup/timeouts/disposal, secret sanitization, shortcut conflict rollback, display clamping, expanded-only resizing and geometry restoration, main-frame IPC, prompted audio permissions, local Cmd+N/W handling, session-selection races, failed restore, and real-composer integration ownership.

Earlier live checks included existing-session history, a single resident editor, draft preservation through mode changes, and a `DSH_MINI_OK` message round trip; they predate version 0.1.1's mini-default routes and latest border removal. New source removes CSS shell/pill borders and editor focus outline, keeps form/button focus rings and an accented caret, and disables native shadow/OS rounded-corner treatment while preserving CSS rounding. Physical no-border rendering and native resizing of this revision have not been manually verified.

**Verified live mini-default workflow:** Settings → Default model / Reasoning → Save used the freshly advertised selection `antigravity` / `gemini-3.8-flash-tiered` / `high`. New chat created distinct session `session-e2d9672e-a03c-4d64-969d-0d1c87440056`, and a real request completed in about 4 seconds with `MINI_GEMINI_HIGH_OK`. Its persisted projection records that exact `lastUsed` selection with `pending: null`, so this was an actual request, not just a saved draft. The main catalog default remained byte-identical (`openai-codex` / `gpt-6.1-sol` / `high`), and the user's configured `Command+Shift+C` global shortcut was unchanged.

The actual native restart/show API calls both returned HTTP 200 with ready, visible and shortcut-registered status. Current [compact](docs/screenshots/compact.png), [expanded](docs/screenshots/expanded.png) and [settings](docs/screenshots/settings.png) captures show the borderless renderer and saved mini settings with real backend state. Their native bridge is simulated only for the browser-renderer preview; they are not physical OS-window screenshots or evidence of manual dragging/resizing across displays. Physical no-border appearance, native resize/drag geometry and Spaces/fullscreen/multiple-monitor behavior are not exhaustively manually verified.

For authenticated renderer-only inspection, reload the existing GUI at `/#dsh-mini-preview`. This deliberately replaces that tab's layout with the same mini UI and a local expand/collapse adapter; it does not register another global shortcut or supply a fake chat backend. Return to `/` and refresh to restore the normal GUI. Native controls are tested separately.

Builds do not automatically update a file-installed profile copy. Rebuild and re-run the `dsh plugin ... add file:...` command. For host updates to an already-installed plugin, restart the **existing DSH server**, then refresh; restarting only the companion is insufficient. No HMR promise is made without a verified watcher.

## Remove

```sh
dsh plugin --profile web remove dsh-plugin-mini-window
```

The native child and shortcuts stop on plugin disposal. The private state and Chromium profile are retained so reinstalling can restore your preferences. No DSH session is deleted. Electron may remain installed because other plugins also depend on it.
