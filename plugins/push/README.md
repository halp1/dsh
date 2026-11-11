# dsh-plugin-push

Adds a push button to every workspace row in the DeepSeek Harness sidebar,
between the "..." menu and New Session. One click runs `git pull` and then
`git push` in that workspace.

- The button is enabled only while the current branch has commits the remote
  does not have. The count sits next to the icon, and the tooltip names the
  branch.
- A failure in either step shows a notice with git's own output. If git
  cannot even read the status, the button shows a warning icon and the
  tooltip carries the error.

## Install

```bash
dsh plugin --profile web add file:/Users/halp/code/dsh/plugins/push
```

Then reload the page. pnpm installs `file:` dependencies as a copy, so run
`pnpm build` here and the same command again after editing the source.

## What counts as pushable

| Workspace | Button |
| --- | --- |
| Branch with an upstream, `@{upstream}..HEAD` non-empty | enabled, shows the count |
| Branch without an upstream, with commits no remote-tracking ref has | enabled, publishes with `git push -u <remote> HEAD` |
| Up to date, detached HEAD, no remote, not a git repository | disabled, the tooltip says which |

The remote is `origin` when it exists, otherwise the first remote.

Status refreshes every 15 seconds while the page is visible, when the window
regains focus, and right after every push. "Ahead" is measured against the
last fetched remote-tracking refs, so the status read never touches the
network.

## What a push does

1. `git pull --no-edit --autostash`, using your configured `pull.rebase` or
   `pull.ff` strategy. With none configured it merges (`--no-rebase`), which
   is what git did before it started asking.
2. `git push`.

Uncommitted edits are stashed around the pull and restored. A pull that stops
on conflicts is aborted (`git merge --abort` or `git rebase --abort`), so the
workspace is left exactly as it was and nothing is pushed.

Git runs without a terminal (`GIT_TERMINAL_PROMPT=0`), so a missing
credential fails with an error instead of waiting for a prompt. Network steps
time out after two minutes. Only one push runs per workspace at a time, across
every open tab.

## Security

Both routes sit behind the same `connection` Host/Origin check and browser
login the built-in routes use. The browser names a workspace by id only. The
path comes from the host's workspace registry, so a request cannot run git
anywhere else.

## How it works

ui-workspace has no slot in the workspace header's action strip, only in
Session rows. The browser half finds each `[data-row-key="workspace:<id>"]`
header, inserts its own element right after the row's "..." trigger, and
renders the button there in a separate React root. It copies the trigger's
class so size, color, and hover match the built-in buttons. A
`MutationObserver` puts the element back whenever the sidebar re-renders.
The notice renders in the `shell.overlay` slot with the host's `Toast`.

| Route | Purpose |
| --- | --- |
| `GET /push/status` | ahead count or idle reason for every registered workspace |
| `POST /push/run` `{ workspaceId }` | pull, then push |

## Layout

- `src/git.ts`: status and pull-then-push
- `src/index.ts`: node half (the two routes)
- `src/client/`: browser half (store, button, row mounting)
- `tests/`: `pnpm test`, against real git repositories and jsdom
