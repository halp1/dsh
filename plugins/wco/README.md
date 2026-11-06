# dsh-plugin-wco

Window Controls Overlay for DeepSeek Harness when it is installed as a PWA.
The browser's title bar goes away and DSH's own top row moves up into that
strip, next to the native window controls. The whole title bar's height goes
back to content.

```
before                                      after
┌────────────────────────────────────────┐  ┌────────────────────────────────────────┐
│ ● ● ●   DeepSeek Harness            ⋮  │  │ ● ● ● 🐳 deepseek ▢ │ Title…  ⋯ ▢ ▢  ⋮  │
├────────────────────────────────────────┤  │ [New Session]       │ Chat Trajectory   │
│ 🐳 deepseek  ▢ │ Title…        ⋯ ▢ ▢   │  │ …                   │ …                 │
│ [New Session]  │ Chat Trajectory        │
```

## How it works

**Manifest.** The shell ships `manifest.webmanifest` with no
`display_override`, so Chrome always draws its own title bar. The plugin
registers an exact route for `/manifest.webmanifest`, which wins over the
static file server. It serves the shell's manifest (read from the installed
`@deepseek-ai/dsh-web-frontend` on every request) with this added:

```json
"display_override": ["window-controls-overlay", "standalone"]
```

**Layout.** A head script (an index injection row, so it runs before the
client boots) reads `navigator.windowControlsOverlay`. It leaves the layout
where it is, because DSH's top rows already sit at the top of the viewport and
are about as tall as a title bar. Instead it:

- **Moves content out from under the controls.** On every layout change
  (sidebar collapse, right panel, panel switches, resize), it measures the top
  rows (`[data-window-drag]` rows and page headers) that intersect the
  controls' rectangles. Rows with room get padding on that side, so the header
  actions slide left of the controls and the sidebar brand slides right of the
  traffic lights. That row is also lifted so it's centred on them. Rows without
  room move down; the collapsed sidebar rail is the only one in practice. It
  works from geometry, so it doesn't depend on the shell's hashed class names.
- **Makes the strip draggable.** A click-through `app-region: drag` layer covers
  the strip, and the shell's `data-window-drag` rows drag too (the same marks
  the macOS desktop app uses). Buttons, tabs, menus and dialogs stay `no-drag`.
- **Centres** the conversation title row and the right panel's tab strip on the
  controls.
- **Matches the colour.** Chrome paints the controls' backing with
  `theme-color`. The script keeps an opaque `theme-color` ahead of the theme's
  own, matched to the content background. It composites translucent themes,
  such as dsh-plugin-background, so the backing doesn't turn black.

The script does nothing unless the overlay is visible. In a browser tab, with
the title bar shown again, in fullscreen, or inside the Electron desktop app,
the page stays the ordinary web UI. If the overlay hides mid-session, every
change is withdrawn.

## Install

```bash
dsh plugin --profile web add file:/Users/halp/code/dsh/dsh-plugin-wco
```

The profile reloads plugins live, so you don't need to restart `dsh web`. Then:

1. Reload the installed DSH app window once (`⌘R`). Chrome checks the manifest
   on navigation, and `display_override` is a non-identity field, so it
   updates silently.
2. Quit the app completely and reopen it. Chrome applies display changes to
   new windows.
3. If the title bar is still there, open the app's `⋮` menu or click the
   chevron in the title bar and pick **Hide title bar**. Chrome remembers the
   choice per app.

To check what the browser sees, open DevTools → Application → Manifest and
look for `display_override`.

## Per-device controls

The runtime parks a handle on `window` for the devtools console:

```js
__dshWco__.state()                            // active?, geometry, number of rows adjusted
__dshWco__.debug()                            // each top row measured, and what was changed
__dshWco__.configure({ enabled: false })      // turn it off on this device
__dshWco__.configure({ simulate: 'mac' })     // fake a macOS overlay in a normal tab (striped boxes = controls)
__dshWco__.configure({ simulate: 'windows' }) // fake a Windows overlay
__dshWco__.configure({ simulate: null })      // back to the real API
```

Settings persist in `localStorage` under `dsh.wco.settings` and apply
immediately.

## Config

Override from the profile's `cordis.patch.yml`:

```yaml
- id: wco
  config:
    displayOverride: [window-controls-overlay, standalone]  # fallback chain
    manifest: true        # serve the patched manifest
    layout: true          # inject the page runtime + styles
    themeColor: true      # match the controls' backing to the content background
    manifestFields: {}    # extra top-level manifest fields, e.g. { theme_color: '#101014' }
    # baseManifest: /path/to/manifest.webmanifest   # override the auto-located one
```

## Development

```bash
node --test test/*.test.js   # 31 tests, no DOM dependency
```

No build step: the node half is plain ESM, and the page runtime is serialized
from `src/page.js` with `Function.prototype.toString`. Because of that, it
must not reference module scope.

## License

MIT
