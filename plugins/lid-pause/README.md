# dsh-plugin-lid-pause

Hold every running DeepSeek Harness agent while the MacBook lid is closed on
battery or the Mac sleeps. Top-level turns, subagents, and agent-team teammates
are all covered. When the lid opens or AC power returns, the same turns continue
once the Mac is awake and the network carries real traffic.

Nothing is cancelled and nothing needs re-prompting.

## What happens

| Moment | Effect |
| --- | --- |
| Lid closes on AC and the Mac stays awake | Model streams and tool dispatches continue uninterrupted. |
| Lid closes on battery, AC is removed with the lid shut, or the system starts to sleep | New model calls and new tool dispatches are held. Agent streams already in flight are cut off and recorded as a hidden failed attempt. |
| Mac is awake and the lid opens or AC returns, but the network is still down | Calls are still held while waiting for the network. |
| Network reports up | A TCP connection to `cloudflare.com:443` is tried every 2 s until it succeeds, then a 2 s settle delay. |
| Resume | Held calls proceed. Interrupted steps re-run inside the same open turn. |

Transport, timeout, and server failures that hit while paused, or within two
minutes after a wake, are retried after the resume. They never end a turn and
never use up the `dsh-llm-retry` budget, since dead pre-sleep sockets cause
them.

Press Stop while held and the turn stops immediately.

Tool bodies that are already running (a long `bash` command, a background job)
keep running, and the OS freezes them if the Mac sleeps. A running `subagent`
tool simply waits while its child's model calls are held.

This plugin does not prevent macOS from sleeping. Closing the lid on AC does
not interrupt work on its own, but a real system sleep still pauses work by
default. Set `pauseOnLidCloseOnAC` to `true` to pause on lid close even on AC.

## How it detects things

`native/lidwatch.swift` is a small helper that prints JSON lines:

- lid state from `AppleClamshellState` on `IOPMrootDomain` (clamshell
  notification plus a one-second poll)
- power source from IOKit, sampled with the lid state so plugging or unplugging
  can change the pause state even while the lid stays shut
- sleep and wake from `IORegisterForSystemPower`. The helper delays sleep by
  `sleepDelayMs` so streams can be cut off cleanly first.
- network reachability from `NWPathMonitor`

The plugin restarts the helper with backoff if it dies. A watchdog treats a
clock gap over 30 s as a wake, in case a wake message is missed. The helper
exits when DSH does.

## Install

```bash
pnpm --filter dsh-plugin-lid-pause run build   # compiles lib/lidwatch
```

Then add to the `web` profile `package.json`:

```json
"dsh-plugin-lid-pause": "file:/Users/halp/code/dsh/plugins/lid-pause"
```

and add `"dsh-plugin-lid-pause"` to `dsh.profile.bundles`, then run
`pnpm install` in the profile. If the package is installed without
`lib/lidwatch`, the plugin compiles the helper once with `swiftc` into
`~/.dsh/plugins/lid-pause/`.

## Configuration

Override from the profile `cordis.patch.yml`:

```yaml
- id: lid-pause
  config:
    pauseOnNetworkLoss: true
```

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Load without gating anything when `false`. |
| `pauseOnLidClose` | `true` | Pause while the lid is closed and the Mac is on battery or the power source is unknown. |
| `pauseOnLidCloseOnAC` | `false` | Also pause on a closed lid while on AC. Only applies if `pauseOnLidClose` is enabled. |
| `pauseOnSleep` | `true` | Pause on actual system sleep regardless of power source. |
| `pauseOnNetworkLoss` | `false` | Also pause whenever the network drops with the lid open. |
| `interruptInFlight` | `true` | Cut off agent model streams that are mid-response when the pause starts. |
| `holdTools` | `true` | Hold new tool dispatches while paused. |
| `resumeDelayMs` | `2000` | Settle time after connectivity is confirmed. |
| `wakeGraceMs` | `120000` | How long after a wake network failures are retried. |
| `sleepDelayMs` | `1000` | How long the helper delays sleep (max 25000). |
| `probe` | `{host: cloudflare.com, port: 443, timeoutMs: 3000, retryMs: 2000}` | Connectivity check. `false` trusts interface reachability alone. |

## Log

```
lid-pause: paused (lid closed), holding model and tool calls
lid-pause: lid open, waiting for the network
lid-pause: network up, checking connectivity
lid-pause: resumed after 14m, released 3 held call(s), interrupted 2 stream(s)
```

## Tests

```bash
pnpm --filter dsh-plugin-lid-pause test
```
