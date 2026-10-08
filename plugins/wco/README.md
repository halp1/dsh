# dsh-plugin-wco

Window Controls Overlay for DeepSeek Harness when it is installed as a PWA.
The browser's title bar goes away, and the DSH frame draws its own caption band
around the native window controls (traffic lights on macOS, min/max/close on
Windows and Linux).

```
before                                   after
┌─────────────────────────────────────┐  ┌─────────────────────────────────────┐
│ ● ● ●   DeepSeek Harness         ⋮  │  │ ● ● ● [≡][+]                     ⋮  │ ← DSH's own band
├─────────────────────────────────────┤  ├────────┬────────────────────────────┤
│ sidebar │ conversation              │  │ sidebar│ conversation               │
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

**Layout.** DSH already has a layout for "a caption the app does not own": the
Windows Electron shell's `html[data-windows-titlebar]` marker plus
`--dsh-windows-titlebar-height`. With the marker set, the frame reserves a
draggable band above every column and the sidebar puts its toggle and New
Session buttons in it. A small head script (an index injection row, so it runs
before the client boots) reads `navigator.windowControlsOverlay` and sets that
contract from the real overlay geometry. It also handles the two things the
Windows layout doesn't:

- **Controls on the left (macOS).** Each `position: fixed` caption rule with a
  `left` offset gets a companion rule that adds the left inset, so the
  sidebar buttons sit to the right of the traffic lights. The rules come from
  scanning the CSSOM, so hashed CSS-module class names don't matter. The scan
  reruns whenever a stylesheet is added.
- **Overlay colour.** Chrome paints the controls area with `theme-color`. The
  script inserts a `theme-color` meta that tracks the band's fill
  (`--dsw-specific-sidebar-fill`) ahead of the theme presenter's meta, so the
  whole strip is one colour and follows light/dark changes.

A stylesheet row also marks interactive elements (buttons, menus, dialogs,
tooltips…) `app-region: no-drag`, so a popover that overlaps the band still
takes clicks.

The script does nothing unless the overlay is actually visible. In a browser
tab, with the overlay toggled off, in fullscreen, or inside the Electron
desktop app (which sets `data-platform` / its own titlebar marker), the page
stays the ordinary web UI. If the overlay hides mid-session, every mark is
withdrawn.

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
__dshWco__.state()                         // active?, geometry, settings
__dshWco__.configure({ enabled: false })   // turn the layout off on this device
__dshWco__.configure({ simulate: 'left' }) // fake a macOS overlay in a normal tab (striped box = controls)
__dshWco__.configure({ simulate: 'right' })// fake a Windows overlay
__dshWco__.configure({ simulate: null })   // back to the real API
```

Settings persist in `localStorage` under `dsh.wco.settings` and take effect
after a reload. That's when the sidebar re-reads the marker for its JS-side
choices (rail width, icon sizes); the CSS side updates immediately.

## Config

Override from the profile's `cordis.patch.yml`:

```yaml
- id: wco
  config:
    displayOverride: [window-controls-overlay, standalone]  # fallback chain
    manifest: true        # serve the patched manifest
    layout: true          # inject the page runtime + styles
    themeColor: true      # keep the overlay colour on the band fill
    manifestFields: {}    # extra top-level manifest fields, e.g. { theme_color: '#101014' }
    # baseManifest: /path/to/manifest.webmanifest   # override the auto-located one
```

## Development

```bash
node --test test/*.test.js   # 26 tests, no DOM dependency
```

No build step: the node half is plain ESM, and the page runtime is serialized
from `src/page.js` with `Function.prototype.toString`. Because of that, it
must not reference module scope.

## License

MIT
