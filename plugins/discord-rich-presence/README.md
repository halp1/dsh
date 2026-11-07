# dsh-plugin-discord-rich-presence

Discord Rich Presence integration for DeepSeek Harness.

Displays active status, elapsed session duration, and the current file being worked on in Discord via local IPC socket transport.

## Features

- Zero external npm dependencies: connects directly to the local Discord desktop application via Unix domain socket or Windows named pipe.
- Displays agent state (thinking, executing tools, reviewing user messages, or waiting for instructions).
- Shows the current file being edited or inspected when active.
- Configurable application ID, status lines, update throttles, and asset keys.
- Automatic reconnect when Discord starts or restarts.

## Install

```bash
dsh plugin --profile web add file:/Users/halp/code/dsh/plugins/discord-rich-presence
```

After installing, restart `dsh web` or reload the page.

## Configuration

Override configuration in your profile patch file:

```yaml
- id: discord-rich-presence
  config:
    clientId: '1568482142072086657'
    details: 'DeepSeek Harness'
    largeImage: 'https://raw.githubusercontent.com/halp1/dsh/main/plugins/discord-rich-presence/assets/dsh.png'
    largeText: 'DeepSeek Harness'
    showFile: true
    minIntervalMs: 3000
    reconnectMs: 15000
```

## Icon and Assets

The DSH icon is provided in `assets/dsh.png` and `assets/dsh.svg`. By default, the plugin loads `assets/dsh.png` via GitHub raw URL as the large rich presence image. You can also upload `assets/dsh.png` directly in the Discord Developer Portal under General Information as your App Icon.
