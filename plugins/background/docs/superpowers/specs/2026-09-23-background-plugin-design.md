# dsh-plugin-background — design

Date: 2026-09-23
Status: approved in conversation, pending written-spec review

## Goal

A DeepSeek Harness (dsh) web plugin that puts an image behind the whole app,
KatsuteDev/Background "window background" style: the app's surfaces become
semi-transparent and the image shows through. It replaces `beauticode-dsh`,
which the user does not like (heavy, side-channel media server, hand-built DOM
settings popover instead of a real Settings tab).

## Requirements (from the user)

- A **Background** tab in the dsh Settings panel for choosing backgrounds.
- Add backgrounds by **local path** (on the machine running `dsh web`) or
  **remote URL**.
- Background applies to the **whole site**: app slightly transparent,
  background behind it.
- Library and selection are **shared per profile** — every browser/device
  connected to this `dsh web` (including remote-web-ui and the PWA) sees the
  same list and selection.
- **Pick one, or rotate**: select a single active background, or turn on a
  slideshow over the list (sequential or shuffle) at an interval.
- Controls: **app opacity**, **background blur**, **fit & position**, plus
  **per-image overrides** of all of those.
- **Images only**: png, jpg/jpeg, webp, gif, avif, svg.
- A **local folder** is a single entry: shows a random image from it when
  active, contributes all its images to rotation; newly added files are picked
  up automatically.

## Non-goals

- Video backgrounds.
- Per-device selection or per-device appearance.
- Custom settings-nav icon (the shell draws the stock gear for unknown ids;
  we accept it rather than the MutationObserver hack other plugins use).
- Uploading files through the browser (paths refer to the host filesystem).
- Proxying/caching remote URLs (the host sets no CSP; the browser loads them
  directly).
- Uninstalling beauticode-dsh automatically (we tell the user how).

## Host facts this design relies on (dsh 0.1.7-rc.1)

Host packages live at
`~/.nvm/versions/node/v26.8.2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`.

- **Settings tab slot** — `'settings.section'`: `{ kind: 'list'; scope: 'root';
  owner: { close: () => void } }`, declared in
  `@deepseek-ai/dsh-client-ui-settings/client` (type-only import for the merge).
  Register with
  `ctx.slots.inject('settings.section', () => ctx.slots.register({ name, id, order, label, inject }, Component))`.
  The shell reads only `id`, `order`, `label`. Built-in orders: account −10,
  general 0, models 10, plugins 15, agent-presets 20; dshmarket 40,
  subscriptions 90, better-sidebar 100. Props = owner props + `inject()` result.
- **Client module table** (the only specifiers `require` can answer): `react`,
  `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`,
  `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`,
  `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit`.
  Everything else is bundled.
- **Primitives used**: `Input`, `Button`, `Switch`, `SegmentedControl`, icons.
  There is no slider primitive → native `<input type="range">` styled with
  `--dsw-*` tokens.
- **Theme** — `ctx.theme` (client inject `theme`, package.json
  `dsh.client.inject` includes `@deepseek-ai/dsh-client-ui-theme`):
  `overrideTokens(source, { [token]: { light, dark } }): () => void`,
  `getTheme(): { active: { colorScheme, tokens }, ... }`,
  `ctx.on('theme/change', cb)`. Overrides are inline body styles.
- **Background tokens**: `--dsw-alias-bg-base`, `-bg-layer-1`, `-bg-layer-2`,
  `-bg-layer-3`, `-bg-overlay`, `-bg-module-platform`,
  `--dsw-specific-sidebar-fill`. `.frame`, `.centerCol`, `.rightbarCol`,
  conversation root and editor use `bg-base`; sidebar uses `sidebar-fill`;
  settings panel uses `layer-2`.
- **Root DOM**: `<body><div id="root"></div></body>`; boot style hard-codes
  `body { background-color: #fff | #151517 }` (not a variable) so `body` and
  `#root` must be forced transparent by our CSS. Dark mode =
  `body[data-ds-dark-theme]`. Scroll fades are either overlay spans (class
  ending `_fade`, hidden) or `_fadeTop`/`_fadeBottom` mask classes on the
  scroll container itself (mask removed, never hidden, because hiding the
  container drops the class and makes it flicker every frame).
- **Authenticated HTTP routes** — node `ctx.inject(['connection'], ...)`,
  `ctx.get('connection').fetch.register({ path: '/api/...', methods, requestBody: 'buffered', fetch(req): Promise<Response> })`
  returns a disposer. Runs after the carrier's auth (signed browser cookie), so
  same-origin `fetch` and `<img src>` from the page are authenticated, local or
  remote. (Raw `webServer` routes are unauthenticated — not used.
  `configForms` is loopback-only for writes — not used.)

## Architecture

Repository `~/code/dsh/dsh-plugin-background`, same scaffold as
`dsh-plugin-badge`: TypeScript, `tsdown` builds a node ESM half
(`lib/index.js`) and a browser closure-factory half (`lib/client.js`,
`window.__ModuleLoader__.load({ id, factory })`), platform modules external,
build-time purity gate for cross-plugin value imports, `node --test` over
built/pure JS, `cordis.patch.yml` inserting entry id `background`.

The client half is `.tsx` (React via `react/jsx-runtime` from the module
table).

### Node half — `src/index.ts` + `src/node/*`

| Module | Purpose |
| --- | --- |
| `node/state-store.ts` | Load/save `state.json`; validation + migration; atomic write (temp file + rename); corrupt file → rename to `state.json.bad-<epochms>`, start empty; revision counter. |
| `node/sources.ts` | Classify and validate an added source (`url` / `file` / `folder`); `~` expansion; image-extension whitelist; list a folder's images (non-recursive, sorted by name, symlinks resolved and required to stay inside the folder). |
| `node/routes.ts` | The three `/api` handlers as pure `(Request, deps) => Promise<Response>` functions so they test without a server. |
| `index.ts` | `Config` schema, `apply(ctx, config)`: resolve state path, `ctx.inject(['connection'])`, register routes via `ctx.effect`. |

**State file location**: `<dshHome>/plugins/background/state.json`, where
`dshHome` = `$DSH_HOME` (if non-blank) else `~/.dsh` — matching the
`~/.dsh/plugins/<name>/` convention used by dsh-plugin-subscriptions. Node
config `stateFile?: string` overrides it (tilde-expanded). Note: this is shared
by all profiles on the host unless overridden.

**Routes** (all JSON unless noted; errors are `{ error: string }` with 4xx/5xx):

- `GET /api/dsh-background.state` → `{ state, folders, files }`:
  `folders` maps each folder entry id to `{ count: number, names: string[] }`
  (listed fresh on every call) or `{ error: string }` if unreadable/empty;
  `files` maps each `file` entry id to `{ ok: boolean }` (exists and is a
  readable image).
- `POST /api/dsh-background.state` body `{ baseRevision, op }`. Ops:
  - `{ type: 'add', source, label? }` → validates via `sources.ts`; URL entries
    are accepted without fetching.
  - `{ type: 'remove', id }`
  - `{ type: 'update-entry', id, patch: { label?, inRotation?, overrides? } }`
    (`overrides: null` clears).
  - `{ type: 'set-active', id | null }`
  - `{ type: 'set-appearance', patch }`
  - `{ type: 'set-rotation', patch }`
  Stale `baseRevision` → `409 { error: 'stale', state }`. Success →
  `{ state, folders, files }` with incremented revision. All numeric fields
  are clamped server-side.
- `GET /api/dsh-background.file?entry=<id>&i=<index>` → streams the image with
  correct `Content-Type`, `Cache-Control: private, max-age=300`, `ETag` from
  mtime+size (304 on match). `file` entries ignore `i`; `folder` entries index
  into the freshly listed images. Unknown entry, URL entry, out-of-range index,
  non-image extension, or path escaping the folder → 404. Never accepts a path
  from the request.

### Client half — `src/client/*`

| Module | Purpose |
| --- | --- |
| `index.ts` | `inject = ['slots', 'theme']`; wires state-client → stage + transparency; registers the settings tab; devtools handle `window.__dshBackground__` (`state`, `refresh()`, `current`). |
| `state-client.ts` | `fetch('api/dsh-background.state')` on load, on `window` focus, every 30 s; `send(op)` applies optimistic update, POSTs with `baseRevision`, on 409 adopts server state and retries once; observable `{ getSnapshot, subscribe }`. On network failure keeps last state. |
| `pool.ts` (pure) | Build the image list: rotation off → the active entry's images (folder → one random index chosen per page load, stable for the session); rotation on → every `inRotation` entry flattened (folders expanded). Each item: `{ entryId, index, url, appearance }` where `url` is the remote URL or `api/dsh-background.file?entry=&i=` and `appearance` = global merged with entry overrides. |
| `rotation.ts` (pure) | `pickIndex(now, intervalMin, poolLength, order, seed)`: slot = `floor(now / intervalMs)`; sequential → `slot % n`; shuffle → seeded Fisher–Yates permutation of `0..n-1` indexed by `slot % n`, where seed = `fnv1a(pool keys joined) ^ cycle` and `cycle = floor(slot / n)` (a fresh order every full pass; depends only on pool contents and time, never on revision). `msUntilNext(now, intervalMin)`. Same answer on every device. |
| `color.ts` (pure) | Parse token values (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()`) → rgba string at a given alpha; unparseable → leave token alone. `buildOverrides(tokens, opacity)` → `{ token: { light, dark } }`. |
| `transparency.ts` | When a background is showing: inject `<style id="dsh-background-css">` (`html[data-dsh-bg] body, html[data-dsh-bg] #root { background: transparent !important }`, `#root { position: relative; z-index: 1 }`, hide `[class*="_fade"]`), set `html[data-dsh-bg]`, and call `theme.overrideTokens('dsh-plugin-background', ...)`. Surface tokens (`bg-base`, `bg-layer-1`, `sidebar-fill`) get alpha = `opacity`; floating tokens (`bg-layer-2`, `bg-layer-3`, `bg-overlay`, `bg-module-platform`) get `max(opacity, 0.9)`. Light/dark values computed from the registered light and dark palettes; recomputed on `theme/change`. Off → dispose override, remove attribute and style. |
| `stage.ts` | Fixed full-viewport `#dsh-background-stage` (`z-index: 0`, `pointer-events: none`) prepended to `<body>`, two `<img>` layers crossfading (400 ms opacity transition). Applies fit (`cover`/`contain`/`fill`; `tile` → background-image repeat on a div instead of `<img>`), position (`object-position`/`background-position`), blur (`filter: blur(px)` with `transform: scale(1 + blur/200)` to hide soft edges). Preloads the next image before swapping. |
| `controller.ts` | Glues pool + rotation + stage + transparency; schedules `setTimeout(msUntilNext)`; on image load error advances to the next pool item (tries each at most once); if all fail → transparency off (app opaque) until state changes. |
| `settings-tab.tsx` | The Settings tab (below). |
| `styles.ts` | CSS for the tab (range inputs, grid, tiles) using `--dsw-*` tokens; injected once. |

### Settings tab

Registered as `settings.section`, id `background`, order 50, label
`Background`.

```
┌ Background ─────────────────────────────────────────────┐
│ [ Path or URL…                                  ] [Add] │
│   error text (inline, red) when add fails               │
│                                                         │
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                         │
│ │  ✓  │ │     │ │ ▣ 12│ │  ⚠  │   thumbnail grid         │
│ └─────┘ └─────┘ └─────┘ └─────┘   click = set active     │
│  None    mtns    walls    broken   hover: ⟳ ✎ 🗑         │
│                                                         │
│ Appearance                                              │
│   Opacity   ───────●──  0.85                            │
│   Blur      ●─────────  0px                             │
│   Fit       [Cover|Contain|Stretch|Tile]                │
│   Position  [Center|Top|Bottom|Left|Right]              │
│                                                         │
│ Rotation    [Switch]  every [ 15 ] min  [Seq|Shuffle]   │
└─────────────────────────────────────────────────────────┘
```

- Add field: `http://` / `https://` prefix → URL, otherwise a host path.
  Enter submits. Host validation errors shown inline.
- Grid: first tile **None** (active = null). Tiles show a thumbnail (`<img>`,
  `object-fit: cover`, lazy), label, folder count badge, ⚠ when the image or
  folder failed. Active tile has a check and accent ring. Click selects.
- Hover actions: ⟳ toggle `inRotation` (dimmed tile when excluded, only shown
  while rotation is on), ✎ open inline editor (label; opacity/blur/fit/position
  each with "use global"), 🗑 remove.
- Appearance sliders: opacity 0.30–1.00 step 0.01, blur 0–40 px step 1. Live
  preview while dragging (local override of the snapshot), persisted after
  300 ms idle.
- Rotation: `Switch`, interval number input (1–1440 minutes, default 15),
  `SegmentedControl` Sequential/Shuffle.

## Data model

```ts
type Fit = 'cover' | 'contain' | 'stretch' | 'tile'
type Position = 'center' | 'top' | 'bottom' | 'left' | 'right'
interface Appearance { opacity: number; blur: number; fit: Fit; position: Position }
interface Entry {
  id: string                    // random 12-char base36
  kind: 'url' | 'file' | 'folder'
  source: string                // URL, or absolute expanded path
  label?: string                // default: file/folder basename or URL host+tail
  inRotation: boolean           // default true
  overrides?: Partial<Appearance>
}
interface State {
  version: 1
  revision: number
  entries: Entry[]
  activeId: string | null
  appearance: Appearance        // default { opacity: 0.85, blur: 0, fit: 'cover', position: 'center' }
  rotation: { enabled: boolean; intervalMin: number; order: 'sequential' | 'shuffle' }
                                // default { enabled: false, intervalMin: 15, order: 'shuffle' }
}
```

Validation drops unknown fields, clamps numbers, replaces invalid enums with
defaults, drops entries with invalid kind/source, and nulls a dangling
`activeId`.

## Behaviour summary

- No active entry and rotation off, or empty pool → plugin is inert (no
  transparency, no stage).
- Rotation on with an empty rotation set → falls back to the active entry.
- Per-image overrides replace the global appearance while that image is shown.
- Cross-device: last write wins through revision check; other devices pick it
  up within 30 s or on focus.

## Error handling

- Add: missing path, not an image, empty folder, unreadable → 400 with a
  human message, shown inline.
- Broken image at runtime: tile ⚠; stage skips to next; all broken → app
  opaque.
- Corrupt state file → renamed aside, fresh state, warning logged via
  `ctx.logger`.
- Concurrent writes → 409 + client adopt-and-retry once.
- Host unreachable → last known state stays applied.

## Security

- File route only serves files reachable from a stored entry; the request
  carries an entry id and index, never a path.
- Folder listings reject entries whose realpath is outside the folder's
  realpath; extensions restricted to the image whitelist.
- All routes sit behind the host connection's authentication.

## Testing

`node --test tests/*.test.js` against the built output / pure modules, no
DOM:

- `state-store`: defaults, validation/clamping, migration of unknown fields,
  atomic save, corrupt-file quarantine, revision increments, 409 on stale.
- `sources`: URL vs path classification, `~` expansion, extension whitelist,
  folder listing order, symlink escape rejection, empty folder rejection.
- `routes`: each op; file route content-type, ETag/304, 404 cases (unknown
  entry, out-of-range, traversal, URL entry).
- `pool`, `rotation`: deterministic index, sequential wrap, shuffle is a
  permutation and identical for identical inputs, override merging.
- `color`: parsing formats, alpha application, unparseable passthrough,
  surface vs floating alpha floor.

Manual verification: install into the `web` profile
(`dsh plugin --profile web add file:~/code/dsh/dsh-plugin-background`),
restart `dsh web`, check the Background tab, add a URL, a file, and a folder,
toggle rotation, and confirm in Chrome with screenshots. beauticode-dsh must be
removed from the profile first (`dsh plugin --profile web remove
beauticode-dsh`) — the user runs or approves that.
