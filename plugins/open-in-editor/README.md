# dsh-plugin-open-in-editor

When the agent links a file in chat (`[client.ts](src/client.ts#L40)`) or you
click an `@file` mention, code files open in **VS Code** at that line rather
than in the right sidebar. Markdown, images, PDF and Office files still
preview in the sidebar.

## Install

```bash
dsh plugin --profile web add file:/Users/halp/code/dsh/dsh-plugin-open-in-editor
```

Then reload the page. pnpm installs `file:` dependencies as a copy, so run the
same command again after editing the source.

## How it works

Every chat file link and `@file` mention calls one method,
`ctx.sidebarRight.openResource('dsh-resource://file/session/<id>/<path>')`.
The browser half overrides that method on the sidebar controller:

- a session file whose extension is **not** in `sidebarExtensions` is posted to
  `POST /open-in-editor/open`. The node half checks that the path is an
  existing regular file and runs `code [<workspace>] -g <file>:<line>`.
- everything else falls through to the sidebar unchanged: non-file addresses
  (plans, subagent chats, change reviews), sidebar extensions, directories,
  missing files, no editor found, a failed launch, and pages not served from
  loopback (with `localOnly`).

The Files tree and the delivery cards open through their own tab actions, so
they keep using the sidebar.

Both routes sit behind the same `connection` Host/Origin check and browser
login that the built-in open-in-app routes use.

## Config

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: open-in-editor
  config:
    command: /Applications/Cursor.app/Contents/Resources/app/bin/code  # default: code, VS Code.app, then Insiders
    sidebarExtensions: [md, markdown, mdx, png, jpg, pdf]                  # replaces the default list
    openWorkspace: true    # also pass the session cwd, so the file opens in that folder's window
    localOnly: true        # only route clicks from a 127.0.0.1/localhost page
```

The default `sidebarExtensions` are `md markdown mdx png jpg jpeg gif webp bmp
ico svg pdf doc docx ppt pptx xls xlsx csv tsv`.

## Layout

- `src/index.js`: node half (config, editor lookup, the two routes)
- `src/client.js`: browser half, shipped as-is in the closure-factory format
- `test/`: `npm test`
