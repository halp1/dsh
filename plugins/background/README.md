# dsh-plugin-background

Window backgrounds for DeepSeek Harness, in the spirit of
[KatsuteDev/Background](https://github.com/KatsuteDev/Background): the whole
app turns translucent and your image sits behind it.

- **Settings → Background** tab to manage everything
- Add a **local file**, a **local folder**, or an **http(s) URL**
- Pick one, or **rotate** through them (sequential or shuffle, 1–1440 min)
- **Opacity**, **blur**, **fit** (cover / contain / stretch / tile) and
  **position**, globally or **per image**
- One library **shared by every browser and device** connected to this
  `dsh web`, remote-web-ui and the PWA included

## Install

```bash
dsh plugin --profile web add file:/path/to/dsh-plugin-background
```

With `patchReload: live` the running `dsh web` picks it up; otherwise restart
it. Reload the page, then open **Settings → Background**. Disable or remove
`beauticode-dsh` first; two plugins fighting over transparency looks broken.

After rebuilding, run the same `add` command again: pnpm installs `file:`
dependencies as a copy, not a link.

## Using it

Type into the field and press **Add**:

| Input | Becomes |
| --- | --- |
| `https://…/sky.jpg` | a URL entry; your browser loads it directly |
| `~/Pictures/wall.png` | a file entry, served by dsh from this machine |
| `~/Pictures/walls/` | a folder entry: a random image from it each page load, or all of its images when rotating; new files are picked up automatically |

Paths are on the machine running `dsh web`, not the device you are browsing
from. Supported images: png, jpg/jpeg, webp, gif, avif, svg.

Click a tile to make it the background. **None** turns it off. Controls below
each tile edit it, remove it, or include or exclude it from rotation.
Removing an entry asks for confirmation because the library is shared across
devices. It does not delete the source images.

Rotation is driven by the clock, so every device shows the same image at the
same time.

## Where things live

The library is one JSON file:
`<$DSH_HOME or ~/.dsh>/plugins/background/state.json`. Move it with the node
config:

```yaml
# profile cordis.patch.yml
- id: background
  config:
    stateFile: ~/Dropbox/dsh-background.json
```

A corrupt file is moved aside to `state.json.bad-<timestamp>` and the library
starts empty.

## How it works

**Node half.** Registers three exact routes on the host's `/api` channel via
`connection.fetch`, so they sit behind the same trust fence and browser
authentication as the rest of dsh:

- `GET  /api/dsh-background.state` — library, folder listings, file health
- `POST /api/dsh-background.state` — one `{ baseRevision, op }` edit; a stale
  revision gets `409` and the client replays on the fresh state
- `GET  /api/dsh-background.file?entry=<id>&i=<n>` — image bytes for a local
  entry; it never accepts a path, and folder images whose real path leaves the
  folder (symlinks) are neither listed nor served

**Browser half.**

- A fixed stage behind `#root` holds two crossfading layers plus one tint
  layer.
- The theme's surface tokens (`--dsw-alias-bg-base`, `-bg-layer-1`,
  `--dsw-specific-sidebar-fill`) become transparent through
  `ctx.theme.overrideTokens`, and the tint (the theme base color at your
  opacity) stands in for all of them. The app nests several surfaces of the
  same color, so giving each one partial alpha would compound back to opaque.
- Floating layers (menus, popovers, this settings panel) keep at least 0.9
  opacity so they stay legible.
- Local images are fetched through the remote UI's authenticated channel and
  displayed with blob URLs, including thumbnails and CSS backgrounds. Temporary
  URLs are released when their image is replaced or removed.
- The library is re-read on window focus and every 30 s.

Devtools: `__dshBackground__.state`, `__dshBackground__.current`,
`__dshBackground__.refresh()`.

## Development

```bash
pnpm install
pnpm test     # node:test via tsx, with jsdom for browser regressions
pnpm build    # tsc -b && tsdown → lib/index.js + lib/client.js
```

The browser half is built as the closure-factory artifact the DSH client module
system loads, with the host's platform modules kept external. See
`tsdown.config.ts`.

## License

MIT
